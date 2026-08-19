import { Client, Invoice, Payment } from "../models";
import { CustomError } from "../errors/customError.error";
import { periodLabelEs } from "../utils/date.util";
import { paymentSubmissionService } from "./paymentSubmission.service";
import { stripeService } from "./stripe.service";

const OPEN_STATUSES = ["pending", "partial", "overdue"];

/**
 * Datos que ve el CLIENTE en su portal de metrics. Todo pasa por el proxy de
 * metrics-backapp (x-metrics-key), que ya validó que el usuario pertenece al
 * workspace: acá solo se resuelve workspace → cliente y se arma la foto.
 */
async function getClientForWorkspace(workspaceId: string) {
  const client = await Client.findOne({ workspaceId, isArchived: false });
  if (!client) {
    throw new CustomError("Este espacio no tiene facturación vinculada todavía", 404);
  }
  return client;
}

async function getBilling(workspaceId: string) {
  const client = await getClientForWorkspace(workspaceId);

  const [invoices, payments, submissions] = await Promise.all([
    Invoice.find({ clientId: client._id, status: { $ne: "cancelled" } })
      .sort({ period: -1, splitIndex: 1 })
      .limit(36)
      .select("period splitLabel amount currency paidAmount status dueDate paidAt isAdvance"),
    Payment.find({ clientId: client._id })
      .sort({ paidAt: -1 })
      .limit(50)
      .select("amount currency paidAt method reference receiptUrl grossAmount feeAmount source period"),
    paymentSubmissionService.listByWorkspace(workspaceId),
  ]);

  const open = invoices.filter((inv) => OPEN_STATUSES.includes(inv.status));
  const pendingBalance = Number(
    open.reduce((acc, inv) => acc + Math.max(inv.amount - (inv.paidAmount || 0), 0), 0).toFixed(2)
  );
  const totalPaid = Number(payments.reduce((acc, p) => acc + p.amount, 0).toFixed(2));

  return {
    client: { id: client._id.toString(), name: client.name },
    summary: {
      pendingBalance,
      totalPaid,
      openInvoices: open.length,
      stripeEnabled: stripeService.isConfigured(),
    },
    invoices,
    payments,
    submissions,
  };
}

/** Link de pago con tarjeta para una factura abierta. El CTA primario del portal. */
async function createCheckoutSession(input: {
  workspaceId: string;
  invoiceId: string;
  returnUrl: string;
}) {
  const client = await getClientForWorkspace(input.workspaceId);

  const invoice = await Invoice.findById(input.invoiceId);
  if (!invoice || invoice.clientId.toString() !== client._id.toString()) {
    throw new CustomError("La factura no pertenece a este cliente", 400);
  }
  if (!OPEN_STATUSES.includes(invoice.status)) {
    throw new CustomError("Esta factura no tiene saldo pendiente", 409);
  }

  const balance = Number(Math.max(invoice.amount - (invoice.paidAmount || 0), 0).toFixed(2));
  if (balance <= 0) throw new CustomError("Esta factura no tiene saldo pendiente", 409);

  const separator = input.returnUrl.includes("?") ? "&" : "?";

  return stripeService.createCheckoutSession({
    invoiceId: invoice._id.toString(),
    clientId: client._id.toString(),
    stripeCustomerId: client.stripeCustomerId,
    amount: balance,
    currency: invoice.currency,
    description: `Bakano · ${client.name} · ${periodLabelEs(invoice.period)}${invoice.splitLabel ? ` (${invoice.splitLabel})` : ""}`,
    successUrl: `${input.returnUrl}${separator}pago=exitoso`,
    cancelUrl: `${input.returnUrl}${separator}pago=cancelado`,
  });
}

export const portalService = { getBilling, createCheckoutSession, getClientForWorkspace };
