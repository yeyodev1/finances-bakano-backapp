import { Types } from "mongoose";
import { AuditLog, Client, IClient, Invoice, Payment } from "../models";
import { IClientAttachment } from "../models/client.model";
import { CustomError } from "../errors/customError.error";
import {
  ARCHIVE_REASONS,
  ARCHIVE_REASON_LABELS,
  ArchiveReason,
} from "../types/finance.types";
import { JwtPayload } from "../types/AuthRequest";
import { cloudinaryService } from "./cloudinary.service";
import { emailService } from "./email.service";
import { diffInDays } from "../utils/date.util";

const ARCHIVE_FOLDER = "bakano-finanzas/bajas";
const CANCEL_NOTE = "Cliente dado de baja";
const OPEN_STATUSES = ["pending", "partial", "overdue"];

export interface ArchiveInput {
  reason?: string;
  notes?: string;
  attachments?: Express.Multer.File[];
}

export interface ReactivateInput {
  notes?: string;
}

/**
 * Expresión de Mongo con el cobro mensual real de un cliente:
 * si tiene splits suma los splits, si no usa `amount`.
 */
export const MONTHLY_AMOUNT_EXPR = {
  $cond: [
    { $gt: [{ $size: { $ifNull: ["$splits", []] } }, 0] },
    { $sum: "$splits.amount" },
    { $ifNull: ["$amount", 0] },
  ],
};

/** Filtro de los clientes que deberían aportar al ideal mensual. */
export const IDEAL_MONTHLY_MATCH = {
  isArchived: { $ne: true },
  isActive: true,
  billingType: "monthly",
  paymentMethod: { $ne: "no_paga" },
};

export function monthlyAmountOf(client: {
  splits?: { amount: number }[] | null;
  amount?: number | null;
}): number {
  const splits = client.splits || [];
  if (splits.length > 0) {
    return splits.reduce((total, split) => total + (Number(split.amount) || 0), 0);
  }
  return Number(client.amount) || 0;
}

/** Cuánto debería ingresar Bakano cada mes si todos los clientes activos pagaran. */
export async function idealMonthlyAmount(): Promise<number> {
  const [row] = await Client.aggregate<{ total: number }>([
    { $match: IDEAL_MONTHLY_MATCH },
    { $group: { _id: null, total: { $sum: MONTHLY_AMOUNT_EXPR } } },
  ]);
  return Math.round((row?.total || 0) * 100) / 100;
}

export async function lifetimeRevenueOf(clientId: Types.ObjectId): Promise<number> {
  const [row] = await Payment.aggregate<{ total: number }>([
    { $match: { clientId } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return Math.round((row?.total || 0) * 100) / 100;
}

/** Días de vida del cliente: guardado si está archivado, en vivo si sigue activo. */
export function resolveLifetimeDays(client: {
  isArchived?: boolean;
  lifetimeDays?: number | null;
  startDate?: Date | null;
  createdAt?: Date | null;
}): number | null {
  if (client.isArchived && typeof client.lifetimeDays === "number") return client.lifetimeDays;
  const start = client.startDate || client.createdAt;
  if (!start) return null;
  return Math.max(diffInDays(new Date(start), new Date()), 0);
}

async function findClient(id: string): Promise<IClient> {
  const client = await Client.findById(id);
  if (!client) throw new CustomError("Cliente no encontrado", 404);
  return client;
}

function toObjectId(value?: string): Types.ObjectId | undefined {
  return value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : undefined;
}

async function uploadAttachments(
  files: Express.Multer.File[] = []
): Promise<IClientAttachment[]> {
  if (!files.length) return [];

  return Promise.all(
    files.map(async (file) => {
      const { url, publicId } = await cloudinaryService.uploadBuffer(file.buffer, ARCHIVE_FOLDER);
      return {
        name: file.originalname,
        url,
        publicId,
        mimeType: file.mimetype,
        size: file.size,
        uploadedAt: new Date(),
      };
    })
  );
}

/** Anula las facturas abiertas cuyo vencimiento aún no llegó. La mora histórica se conserva. */
async function cancelFutureInvoices(clientId: Types.ObjectId, from: Date): Promise<number> {
  const result = await Invoice.updateMany(
    { clientId, status: { $in: OPEN_STATUSES }, dueDate: { $gt: from } },
    [
      {
        $set: {
          status: "cancelled",
          notes: {
            $cond: [
              { $ifNull: ["$notes", false] },
              { $concat: ["$notes", " | ", CANCEL_NOTE] },
              CANCEL_NOTE,
            ],
          },
        },
      },
    ]
  );
  return result.modifiedCount || 0;
}

async function notifyArchived(client: IClient, reason: ArchiveReason, notes?: string) {
  const sender = (emailService as Record<string, unknown>).sendClientArchived;
  if (typeof sender !== "function") return;
  try {
    await (sender as (payload: unknown) => Promise<unknown>)({ client, reason, notes });
  } catch (error) {
    console.error("[client] Falló el email de baja de cliente:", error);
  }
}

async function archive(clientId: string, input: ArchiveInput, user?: JwtPayload) {
  const reason = String(input.reason || "").trim() as ArchiveReason;
  if (!reason || !ARCHIVE_REASONS.includes(reason)) {
    throw new CustomError("Debes indicar el motivo de la baja.", 400);
  }

  const client = await findClient(clientId);
  if (client.isArchived) {
    throw new CustomError("Este cliente ya está dado de baja.", 400);
  }

  const archivedAt = new Date();
  const attachments = await uploadAttachments(input.attachments);
  const revenueToDate = await lifetimeRevenueOf(client._id);
  const start = client.startDate || client.createdAt;
  const durationDays = start ? Math.max(diffInDays(new Date(start), archivedAt), 0) : 0;
  const cancelledInvoices = await cancelFutureInvoices(client._id, archivedAt);
  const notes = input.notes?.trim() || undefined;

  client.isArchived = true;
  client.archivedAt = archivedAt;
  client.archiveReason = reason;
  client.archiveNotes = notes;
  client.archiveAttachments = attachments;
  client.archivedBy = toObjectId(user?._id) as Types.ObjectId;
  client.lifetimeDays = durationDays;
  client.lifetimeRevenue = revenueToDate;
  client.endDate = archivedAt;
  client.isActive = false;
  client.autoDeactivate = false;
  client.deactivatedAt = archivedAt;
  client.deactivationReason = `Baja: ${ARCHIVE_REASON_LABELS[reason]}`;
  client.lifecycleHistory.push({
    action: "archived",
    reason,
    notes,
    attachments,
    durationDays,
    revenueToDate,
    at: archivedAt,
    by: toObjectId(user?._id) as Types.ObjectId,
    byName: user?.name,
  });

  await client.save();

  await AuditLog.create({
    action: "client.archive",
    entity: "Client",
    entityId: client._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: {
      reason,
      label: ARCHIVE_REASON_LABELS[reason],
      durationDays,
      revenueToDate,
      cancelledInvoices,
      attachments: attachments.length,
    },
  });

  await notifyArchived(client, reason, notes);

  return {
    client,
    cancelledInvoices,
    lifetimeDays: durationDays,
    lifetimeRevenue: revenueToDate,
    workspaceStillActive: Boolean(client.workspaceId),
    message: "Cliente dado de baja correctamente",
  };
}

async function reactivate(clientId: string, input: ReactivateInput = {}, user?: JwtPayload) {
  const client = await findClient(clientId);
  if (!client.isArchived) {
    throw new CustomError("Este cliente no está dado de baja.", 400);
  }

  const at = new Date();
  const notes = input.notes?.trim() || undefined;

  client.isArchived = false;
  client.archivedAt = null;
  client.archiveReason = null;
  client.archiveNotes = undefined;
  client.archivedBy = undefined;
  client.endDate = null;
  client.isActive = true;
  client.deactivatedAt = null;
  client.deactivationReason = undefined;
  client.lifecycleHistory.push({
    action: "reactivated",
    notes,
    attachments: [],
    at,
    by: toObjectId(user?._id) as Types.ObjectId,
    byName: user?.name,
  });

  await client.save();

  await AuditLog.create({
    action: "client.reactivate",
    entity: "Client",
    entityId: client._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: { notes },
  });

  return { client, message: "Cliente reactivado correctamente" };
}

async function addLifecycleAttachments(
  clientId: string,
  files: Express.Multer.File[] = [],
  user?: JwtPayload
) {
  if (!files.length) {
    throw new CustomError("Debes adjuntar al menos un archivo de respaldo.", 400);
  }

  const client = await findClient(clientId);
  const last = client.lifecycleHistory[client.lifecycleHistory.length - 1];
  if (!last) {
    throw new CustomError(
      "Este cliente no tiene historial de ciclo de vida al que adjuntar respaldos.",
      400
    );
  }

  const attachments = await uploadAttachments(files);
  last.attachments = [...(last.attachments || []), ...attachments];
  if (last.action === "archived") {
    client.archiveAttachments = [...(client.archiveAttachments || []), ...attachments];
  }
  client.markModified("lifecycleHistory");
  await client.save();

  await AuditLog.create({
    action: "client.lifecycle.attachments",
    entity: "Client",
    entityId: client._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: { added: attachments.length, entryAction: last.action },
  });

  return {
    client,
    added: attachments.length,
    attachments: last.attachments,
    message: "Respaldos agregados al historial",
  };
}

/** Borrado real. Solo para clientes creados por error que nunca facturaron un pago. */
async function purge(clientId: string, user?: JwtPayload) {
  const client = await findClient(clientId);

  const payments = await Payment.countDocuments({ clientId: client._id });
  if (payments > 0) {
    throw new CustomError(
      `Este cliente tiene ${payments} pago(s) registrados; no se puede eliminar. Usa la baja para conservar el historial.`,
      400
    );
  }

  const invoices = await Invoice.deleteMany({ clientId: client._id });
  await client.deleteOne();

  await AuditLog.create({
    action: "client.purge",
    entity: "Client",
    entityId: client._id.toString(),
    userId: user?._id,
    userName: user?.name,
    level: "warn",
    meta: {
      name: client.name,
      deletedInvoices: invoices.deletedCount || 0,
      workspaceId: client.workspaceId,
    },
  });

  return {
    message: "Cliente eliminado definitivamente",
    deletedInvoices: invoices.deletedCount || 0,
  };
}

export interface ArchivedClientRow {
  _id: string;
  name: string;
  archivedAt?: Date | null;
  reason?: ArchiveReason | null;
  label: string;
  notes?: string;
  lifetimeDays: number | null;
  lifetimeRevenue: number;
  amount: number;
  attachmentsCount: number;
  workspaceId?: string | null;
  workspaceName?: string | null;
}

async function listArchived(limit = 100): Promise<ArchivedClientRow[]> {
  const max = Math.min(Math.max(Number(limit) || 100, 1), 500);

  const rows = await Client.find({ isArchived: true })
    .sort({ archivedAt: -1 })
    .limit(max)
    .lean();

  return rows.map((row) => ({
    _id: String(row._id),
    name: row.name,
    archivedAt: row.archivedAt,
    reason: row.archiveReason,
    label: row.archiveReason ? ARCHIVE_REASON_LABELS[row.archiveReason] : "Sin motivo",
    notes: row.archiveNotes,
    lifetimeDays: resolveLifetimeDays(row),
    lifetimeRevenue: row.lifetimeRevenue || 0,
    amount: monthlyAmountOf(row),
    attachmentsCount: (row.archiveAttachments || []).length,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
  }));
}

export const clientLifecycleService = {
  archive,
  reactivate,
  addLifecycleAttachments,
  purge,
  listArchived,
  idealMonthlyAmount,
  lifetimeRevenueOf,
  resolveLifetimeDays,
  monthlyAmountOf,
};
