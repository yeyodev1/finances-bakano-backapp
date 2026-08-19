import { FilterQuery } from "mongoose";
import { AuditLog, Client, Invoice, IPaymentSubmission, PaymentSubmission } from "../models";
import { SubmissionStatus } from "../models/paymentSubmission.model";
import { CustomError } from "../errors/customError.error";
import { PaginatedResult } from "../types/finance.types";
import { JwtPayload } from "../types/AuthRequest";
import { addBusinessHours } from "../utils/date.util";
import { cloudinaryService } from "./cloudinary.service";
import { emailService } from "./email.service";
import { paymentService } from "./payment.service";

const RECEIPT_FOLDER = "bakano-finanzas/comprobantes-portal";
/** SLA prometido al cliente en el portal: 48 horas laborables. */
const REVIEW_SLA_BUSINESS_HOURS = 48;
const OPEN_STATUSES = ["pending", "partial", "overdue"];

export interface SubmitInput {
  workspaceId: string;
  invoiceId?: string;
  grossAmount: number;
  feeAmount?: number;
  receipt: Buffer;
  submittedByName?: string;
  submittedByEmail?: string;
}

/** El cliente sube su comprobante desde el portal (vía proxy de metrics). */
async function submit(input: SubmitInput) {
  const client = await Client.findOne({ workspaceId: input.workspaceId, isArchived: false });
  if (!client) {
    throw new CustomError("Este espacio no tiene un cliente de facturación vinculado", 404);
  }

  const grossAmount = Number(input.grossAmount);
  const feeAmount = Number(input.feeAmount || 0);
  if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
    throw new CustomError("El monto enviado debe ser mayor a cero", 400);
  }
  if (!Number.isFinite(feeAmount) || feeAmount < 0) {
    throw new CustomError("El fee bancario no puede ser negativo", 400);
  }
  const netAmount = Number((grossAmount - feeAmount).toFixed(2));
  if (netAmount <= 0) {
    throw new CustomError("El neto (monto enviado menos fee) debe ser mayor a cero", 400);
  }

  if (input.invoiceId) {
    const invoice = await Invoice.findById(input.invoiceId);
    if (!invoice || invoice.clientId.toString() !== client._id.toString()) {
      throw new CustomError("La factura indicada no pertenece a este cliente", 400);
    }
  }

  const uploaded = await cloudinaryService.uploadBuffer(input.receipt, RECEIPT_FOLDER);

  const submission = await PaymentSubmission.create({
    clientId: client._id,
    clientName: client.name,
    workspaceId: input.workspaceId,
    invoiceId: input.invoiceId || null,
    grossAmount,
    feeAmount,
    netAmount,
    currency: "USD",
    receiptUrl: uploaded.url,
    receiptPublicId: uploaded.publicId,
    reviewDueAt: addBusinessHours(new Date(), REVIEW_SLA_BUSINESS_HOURS),
    submittedByName: input.submittedByName,
    submittedByEmail: input.submittedByEmail,
  });

  try {
    await emailService.sendPaymentSubmissionReceived({ submission });
  } catch (error) {
    console.error("[submission] Falló el email de comprobante recibido:", error);
  }

  await AuditLog.create({
    action: "submission.create",
    entity: "PaymentSubmission",
    entityId: submission._id.toString(),
    userName: input.submittedByName || "Cliente (portal)",
    meta: {
      clientId: client._id.toString(),
      workspaceId: input.workspaceId,
      grossAmount,
      feeAmount,
      netAmount,
    },
  });

  return submission;
}

/**
 * Aprueba el comprobante: crea el Payment real por el NETO recibido (el fee lo
 * asume el cliente) y hereda todos los efectos de un pago: recálculo de la
 * factura, reactivación del workspace, correo a la empresa y auditoría.
 */
async function approve(
  id: string,
  input: { invoiceId?: string; reviewNote?: string },
  user?: JwtPayload
) {
  const submission = await PaymentSubmission.findById(id);
  if (!submission) throw new CustomError("Comprobante no encontrado", 404);
  if (submission.status !== "pending") {
    throw new CustomError("Este comprobante ya fue revisado", 409);
  }

  let invoiceId = input.invoiceId || submission.invoiceId?.toString();
  if (!invoiceId) {
    const oldest = await Invoice.findOne({
      clientId: submission.clientId,
      status: { $in: OPEN_STATUSES },
    }).sort({ dueDate: 1, splitIndex: 1 });
    if (!oldest) {
      throw new CustomError(
        "El cliente no tiene cobros abiertos: indica la factura a la que aplicar el pago",
        400
      );
    }
    invoiceId = oldest._id.toString();
  }

  const { payment, invoice } = await paymentService.register(
    {
      invoiceId,
      amount: submission.netAmount,
      paidAt: submission.createdAt,
      method: "transferencia",
      reference: `Comprobante portal ${submission._id.toString()}`,
      notes: input.reviewNote,
      receiptUrl: submission.receiptUrl,
      receiptPublicId: submission.receiptPublicId,
      source: "client_submission",
      grossAmount: submission.grossAmount,
      feeAmount: submission.feeAmount,
    },
    user
  );

  submission.status = "approved";
  submission.invoiceId = invoice._id;
  submission.paymentId = payment._id;
  submission.reviewedBy = user?._id as IPaymentSubmission["reviewedBy"];
  submission.reviewedByName = user?.name;
  submission.reviewedAt = new Date();
  submission.reviewNote = input.reviewNote;
  await submission.save();

  try {
    await emailService.sendPaymentSubmissionReviewed({ submission });
  } catch (error) {
    console.error("[submission] Falló el email de comprobante revisado:", error);
  }

  await AuditLog.create({
    action: "submission.approve",
    entity: "PaymentSubmission",
    entityId: submission._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: {
      clientId: submission.clientId.toString(),
      paymentId: payment._id.toString(),
      netAmount: submission.netAmount,
      feeAmount: submission.feeAmount,
    },
  });

  return { submission, payment, invoice };
}

async function reject(id: string, input: { reviewNote: string }, user?: JwtPayload) {
  const submission = await PaymentSubmission.findById(id);
  if (!submission) throw new CustomError("Comprobante no encontrado", 404);
  if (submission.status !== "pending") {
    throw new CustomError("Este comprobante ya fue revisado", 409);
  }
  if (!input.reviewNote?.trim()) {
    throw new CustomError("El rechazo necesita un motivo: el cliente lo verá en su portal", 400);
  }

  submission.status = "rejected";
  submission.reviewedBy = user?._id as IPaymentSubmission["reviewedBy"];
  submission.reviewedByName = user?.name;
  submission.reviewedAt = new Date();
  submission.reviewNote = input.reviewNote.trim();
  await submission.save();

  try {
    await emailService.sendPaymentSubmissionReviewed({ submission });
  } catch (error) {
    console.error("[submission] Falló el email de comprobante revisado:", error);
  }

  await AuditLog.create({
    action: "submission.reject",
    entity: "PaymentSubmission",
    entityId: submission._id.toString(),
    userId: user?._id,
    userName: user?.name,
    level: "warn",
    meta: { clientId: submission.clientId.toString(), reviewNote: submission.reviewNote },
  });

  return submission;
}

export interface SubmissionListQuery {
  status?: SubmissionStatus;
  clientId?: string;
  page?: number;
  limit?: number;
}

async function list(query: SubmissionListQuery = {}): Promise<PaginatedResult<IPaymentSubmission>> {
  const page = Math.max(query.page || 1, 1);
  const limit = Math.min(Math.max(query.limit || 50, 1), 200);

  const filter: FilterQuery<IPaymentSubmission> = {};
  if (query.status) filter.status = query.status;
  if (query.clientId) filter.clientId = query.clientId;

  const [items, total] = await Promise.all([
    PaymentSubmission.find(filter)
      .populate("invoiceId", "period amount status dueDate splitIndex")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    PaymentSubmission.countDocuments(filter),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
}

async function listByWorkspace(workspaceId: string) {
  return PaymentSubmission.find({ workspaceId }).sort({ createdAt: -1 }).limit(50);
}

export const paymentSubmissionService = { submit, approve, reject, list, listByWorkspace };
