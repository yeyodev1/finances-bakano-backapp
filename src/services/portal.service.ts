import { Client, CrmConsumption, Invoice, Payment } from "../models";
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

  const [invoices, payments, submissions, crmItems] = await Promise.all([
    Invoice.find({ clientId: client._id, status: { $ne: "cancelled" } })
      .sort({ period: -1, splitIndex: 1 })
      .limit(36)
      .select("period splitLabel amount currency paidAmount status dueDate paidAt isAdvance"),
    Payment.find({ clientId: client._id })
      .sort({ paidAt: -1 })
      .limit(50)
      .select("amount currency paidAt method reference receiptUrl grossAmount feeAmount source period"),
    paymentSubmissionService.listByWorkspace(workspaceId),
    CrmConsumption.find({ clientId: client._id })
      .sort({ paidAt: -1 })
      .limit(100)
      .select("amount currency paidAt description stripeChargeId"),
  ]);

  // Consumo del CRM (GoHighLevel) acumulado por mes, para que el cliente vea
  // claro qué está consumiendo. Son cargos ya cobrados por Stripe.
  const byMonth = new Map<string, { period: string; total: number; count: number }>();
  for (const item of crmItems) {
    const period = `${item.paidAt.getFullYear()}-${String(item.paidAt.getMonth() + 1).padStart(2, "0")}`;
    const bucket = byMonth.get(period) || { period, total: 0, count: 0 };
    bucket.total = Number((bucket.total + item.amount).toFixed(2));
    bucket.count += 1;
    byMonth.set(period, bucket);
  }
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const crmConsumption = {
    items: crmItems,
    totals: {
      total: Number(crmItems.reduce((acc, i) => acc + i.amount, 0).toFixed(2)),
      currentMonth: byMonth.get(currentPeriod)?.total || 0,
      byMonth: [...byMonth.values()].sort((a, b) => b.period.localeCompare(a.period)),
    },
  };

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
      // El boton "Cambiar tarjeta" solo aparece si el cliente ya paga por
      // Stripe: sin customer no hay metodo de pago que actualizar.
      canUpdateCard: stripeService.isConfigured() && Boolean(client.stripeCustomerId),
    },
    invoices,
    payments,
    submissions,
    crmConsumption,
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

/**
 * Sesion del Billing Portal (restringido) para que el cliente cambie la
 * tarjeta de su suscripcion de Bakano sin pedirla por WhatsApp.
 */
async function createCardUpdateSession(input: { workspaceId: string; returnUrl: string }) {
  const client = await getClientForWorkspace(input.workspaceId);
  if (!client.stripeCustomerId) {
    throw new CustomError("Este cliente aun no paga con tarjeta por Stripe", 409);
  }
  return stripeService.createCardUpdateSession(client.stripeCustomerId, input.returnUrl);
}

export interface EstadoPagoWorkspace {
  workspaceId: string;
  cliente: string;
  /** Sin facturas vencidas por cobrar (o con excepción / sin cobro). */
  alDia: boolean;
  /** Saldo de las facturas ya vencidas. */
  deuda: number;
  facturasVencidas: number;
  /** La factura del mes en curso está pagada completa. */
  pagadoMesActual: boolean;
  ultimoPago: Date | null;
  /** Acceso abierto a propósito pese a la mora, o cliente que no paga. */
  excepcion: string | null;
}

/**
 * Quién está al día, para todos los espacios vinculados de una vez. Metrics lo
 * usa para no mostrar los guiones a quien debe y para que el equipo sepa a
 * quién planificarle sin venir a preguntar.
 *
 * "Al día" = ninguna factura abierta con la fecha de pago ya pasada. La factura
 * del mes que todavía no vence no bloquea.
 */
async function getEstadoPagos(): Promise<EstadoPagoWorkspace[]> {
  const clients = await Client.find({ isArchived: false, workspaceId: { $nin: [null, ""] } })
    .select("name workspaceId paymentMethod accessOverride")
    .lean();
  const ids = clients.map((c) => c._id);
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [invoices, payments] = await Promise.all([
    Invoice.find({
      clientId: { $in: ids },
      status: { $ne: "cancelled" },
      $or: [{ status: { $in: OPEN_STATUSES } }, { period: currentPeriod }],
    })
      .select("clientId period amount paidAmount status dueDate")
      .lean(),
    Payment.aggregate<{ _id: unknown; ultimo: Date }>([
      { $match: { clientId: { $in: ids } } },
      { $group: { _id: "$clientId", ultimo: { $max: "$paidAt" } } },
    ]),
  ]);

  const ultimoPor = new Map(payments.map((p) => [String(p._id), p.ultimo]));
  const facturasPor = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    const key = String(inv.clientId);
    facturasPor.set(key, [...(facturasPor.get(key) || []), inv]);
  }

  return clients.map((c) => {
    const facturas = facturasPor.get(String(c._id)) || [];
    const vencidas = facturas.filter((f) => OPEN_STATUSES.includes(f.status) && new Date(f.dueDate) <= now);
    const deuda = Number(vencidas.reduce((acc, f) => acc + Math.max(f.amount - (f.paidAmount || 0), 0), 0).toFixed(2));
    const delMes = facturas.filter((f) => f.period === currentPeriod);
    const excepcion =
      c.paymentMethod === "no_paga"
        ? "No paga"
        : c.accessOverride?.enabled
          ? c.accessOverride.reason || "Acceso abierto pese a la mora"
          : null;
    return {
      workspaceId: String(c.workspaceId),
      cliente: c.name,
      alDia: Boolean(excepcion) || vencidas.length === 0,
      deuda,
      facturasVencidas: vencidas.length,
      pagadoMesActual: delMes.length > 0 && delMes.every((f) => f.status === "paid"),
      ultimoPago: ultimoPor.get(String(c._id)) || null,
      excepcion,
    };
  });
}

export const portalService = {
  getEstadoPagos,
  getBilling,
  createCheckoutSession,
  createCardUpdateSession,
  getClientForWorkspace,
};
