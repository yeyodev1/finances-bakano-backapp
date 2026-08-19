import { AuditLog, Client, Invoice, Payment } from "../models";
import { CustomError } from "../errors/customError.error";
import { JwtPayload } from "../types/AuthRequest";
import { nameSimilarity } from "../utils/similarity.util";
import { paymentService } from "./payment.service";
import { stripeService, StripeChargeSummary } from "./stripe.service";

/** Debajo de esto la sugerencia es ruido y no se muestra. */
const MIN_SUGGESTION_SCORE = 0.45;
const OPEN_STATUSES = ["pending", "partial", "overdue"];

/**
 * Customers de Stripe con sugerencias de cliente por similitud de nombre.
 * Mismo criterio que la vinculación de workspaces: la máquina sugiere, el
 * humano confirma 1 a 1.
 */
async function listCustomersWithSuggestions() {
  const [customers, clients, linked] = await Promise.all([
    stripeService.listCustomers(),
    Client.find({ isArchived: false }).select("name stripeCustomerId").sort({ name: 1 }),
    Client.find({ stripeCustomerId: { $nin: [null, ""] } }).select("name stripeCustomerId"),
  ]);

  const linkedByCustomer = new Map(linked.map((c) => [c.stripeCustomerId as string, c]));
  const unlinkedClients = clients.filter((c) => !c.stripeCustomerId);

  return customers.map((customer) => {
    const linkedClient = linkedByCustomer.get(customer.stripeCustomerId);

    const suggestions = linkedClient
      ? []
      : unlinkedClients
          .map((client) => ({
            clientId: client._id.toString(),
            clientName: client.name,
            score: Number(nameSimilarity(customer.name, client.name).toFixed(2)),
          }))
          .filter((s) => s.score >= MIN_SUGGESTION_SCORE)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);

    return {
      ...customer,
      linkedClientId: linkedClient?._id.toString() || null,
      linkedClientName: linkedClient?.name || null,
      suggestions,
    };
  });
}

async function linkCustomer(input: { clientId: string; stripeCustomerId: string }, user?: JwtPayload) {
  const client = await Client.findById(input.clientId);
  if (!client) throw new CustomError("Cliente no encontrado", 404);

  const taken = await Client.findOne({
    stripeCustomerId: input.stripeCustomerId,
    _id: { $ne: client._id },
  });
  if (taken) {
    throw new CustomError(`Ese customer de Stripe ya está vinculado a ${taken.name}`, 409);
  }

  const previous = client.stripeCustomerId || null;
  client.stripeCustomerId = input.stripeCustomerId;
  await client.save();

  await AuditLog.create({
    action: "stripe.customer_linked",
    entity: "Client",
    entityId: client._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: { stripeCustomerId: input.stripeCustomerId, previous },
  });

  return { message: `${client.name} vinculado a ${input.stripeCustomerId}`, client };
}

async function unlinkCustomer(clientId: string, user?: JwtPayload) {
  const client = await Client.findById(clientId);
  if (!client) throw new CustomError("Cliente no encontrado", 404);
  if (!client.stripeCustomerId) throw new CustomError("El cliente no tiene Stripe vinculado", 400);

  const previous = client.stripeCustomerId;
  client.stripeCustomerId = null as unknown as string | undefined;
  await client.save();

  await AuditLog.create({
    action: "stripe.customer_unlinked",
    entity: "Client",
    entityId: client._id.toString(),
    userId: user?._id,
    userName: user?.name,
    level: "warn",
    meta: { previous },
  });

  return { message: `${client.name} desvinculado de Stripe`, client };
}

/**
 * Backfill de cargos históricos de un cliente ya vinculado. Cada cargo se aplica
 * al cobro abierto más viejo cuando no hay match exacto de período/monto. Los
 * cargos que no calzan en ninguna factura se devuelven para revisión manual, y
 * los ya importados se saltan por `stripeChargeId`.
 */
async function importCharges(clientId: string, user?: JwtPayload) {
  const client = await Client.findById(clientId);
  if (!client) throw new CustomError("Cliente no encontrado", 404);
  if (!client.stripeCustomerId) {
    throw new CustomError("El cliente no tiene un customer de Stripe vinculado", 400);
  }

  const charges = await stripeService.listCharges(client.stripeCustomerId);

  const imported: Array<{ stripeChargeId: string; amount: number; period: string }> = [];
  const skipped: Array<{ stripeChargeId: string; reason: string }> = [];
  const unmatched: Array<{ stripeChargeId: string; amount: number; paidAt: Date; reason: string }> = [];

  for (const charge of charges) {
    const exists = await Payment.findOne({ stripeChargeId: charge.stripeChargeId });
    if (exists) {
      skipped.push({ stripeChargeId: charge.stripeChargeId, reason: "Ya importado" });
      continue;
    }

    const invoice = await findInvoiceForCharge(client._id, charge);
    if (!invoice) {
      unmatched.push({
        stripeChargeId: charge.stripeChargeId,
        amount: charge.amount,
        paidAt: charge.paidAt,
        reason: "Sin factura abierta que calce por período o monto",
      });
      continue;
    }

    await paymentService.register(
      {
        invoiceId: invoice._id.toString(),
        amount: charge.amount,
        paidAt: charge.paidAt,
        method: "stripe",
        reference: charge.stripeChargeId,
        notes: charge.description,
        stripeChargeId: charge.stripeChargeId,
        source: "stripe",
        registeredByName: "Importación Stripe",
        skipEmail: true,
      },
      user
    );

    imported.push({
      stripeChargeId: charge.stripeChargeId,
      amount: charge.amount,
      period: invoice.period,
    });
  }

  await AuditLog.create({
    action: "stripe.charges_imported",
    entity: "Client",
    entityId: client._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: {
      stripeCustomerId: client.stripeCustomerId,
      imported: imported.length,
      skipped: skipped.length,
      unmatched: unmatched.length,
    },
  });

  return {
    clientId: client._id.toString(),
    clientName: client.name,
    totalCharges: charges.length,
    imported,
    skipped,
    unmatched,
    message: `${imported.length} cargo(s) importados, ${skipped.length} ya existían, ${unmatched.length} sin factura`,
  };
}

/**
 * Match de factura para un cargo histórico: primero el período del mes del cobro
 * con el mismo monto, después cualquier abierta con el mismo saldo, y como último
 * recurso la abierta más vieja.
 */
async function findInvoiceForCharge(clientId: unknown, charge: StripeChargeSummary) {
  const period = `${charge.paidAt.getFullYear()}-${String(charge.paidAt.getMonth() + 1).padStart(2, "0")}`;

  const samePeriod = await Invoice.findOne({
    clientId,
    period,
    status: { $in: OPEN_STATUSES },
  }).sort({ splitIndex: 1 });
  if (samePeriod) return samePeriod;

  const open = await Invoice.find({ clientId, status: { $in: OPEN_STATUSES } }).sort({
    dueDate: 1,
    splitIndex: 1,
  });

  const sameBalance = open.find(
    (inv) => Math.abs(inv.amount - (inv.paidAmount || 0) - charge.amount) < 0.01
  );

  return sameBalance || open[0] || null;
}

export const stripeImportService = {
  listCustomersWithSuggestions,
  linkCustomer,
  unlinkCustomer,
  importCharges,
};
