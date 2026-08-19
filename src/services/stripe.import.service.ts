import { AuditLog, Client, Invoice, Payment } from "../models";
import { CustomError } from "../errors/customError.error";
import { JwtPayload } from "../types/AuthRequest";
import { nameSimilarity } from "../utils/similarity.util";
import { paymentService } from "./payment.service";
import { stripeService, StripeChargeSummary } from "./stripe.service";

/** Debajo de esto la sugerencia es ruido y no se muestra. */
const MIN_SUGGESTION_SCORE = 0.45;
const OPEN_STATUSES = ["pending", "partial", "overdue"];

/** Todos los cus_ de un cliente: el principal más los perfiles duplicados. */
function customerIdsOf(client: { stripeCustomerId?: string | null; stripeCustomerIds?: string[] }) {
  const ids = new Set<string>(client.stripeCustomerIds || []);
  if (client.stripeCustomerId) ids.add(client.stripeCustomerId);
  return [...ids];
}

/**
 * Customers de Stripe con sugerencias de cliente por similitud de nombre.
 * Mismo criterio que la vinculación de workspaces: la máquina sugiere, el
 * humano confirma. Un cliente puede tener VARIOS perfiles de Stripe (hay
 * negocios con customers duplicados), así que se sigue sugiriendo aunque
 * el cliente ya tenga otro perfil vinculado.
 */
async function listCustomersWithSuggestions() {
  const [customers, clients] = await Promise.all([
    stripeService.listCustomers(),
    Client.find({ isArchived: false })
      .select("name stripeCustomerId stripeCustomerIds")
      .sort({ name: 1 }),
  ]);

  const linkedByCustomer = new Map<string, (typeof clients)[number]>();
  for (const client of clients) {
    for (const id of customerIdsOf(client)) linkedByCustomer.set(id, client);
  }

  return customers.map((customer) => {
    const linkedClient = linkedByCustomer.get(customer.stripeCustomerId);

    const suggestions = linkedClient
      ? []
      : clients
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

/** Vincula un perfil de Stripe. Un cliente puede acumular varios; el primero queda de principal. */
async function linkCustomer(input: { clientId: string; stripeCustomerId: string }, user?: JwtPayload) {
  const client = await Client.findById(input.clientId);
  if (!client) throw new CustomError("Cliente no encontrado", 404);

  const taken = await Client.findOne({
    _id: { $ne: client._id },
    $or: [
      { stripeCustomerId: input.stripeCustomerId },
      { stripeCustomerIds: input.stripeCustomerId },
    ],
  });
  if (taken) {
    throw new CustomError(`Ese customer de Stripe ya está vinculado a ${taken.name}`, 409);
  }

  if (customerIdsOf(client).includes(input.stripeCustomerId)) {
    throw new CustomError(`${client.name} ya tiene vinculado ese perfil`, 409);
  }

  client.stripeCustomerIds = [...(client.stripeCustomerIds || []), input.stripeCustomerId];
  if (!client.stripeCustomerId) client.stripeCustomerId = input.stripeCustomerId;
  await client.save();

  await AuditLog.create({
    action: "stripe.customer_linked",
    entity: "Client",
    entityId: client._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: { stripeCustomerId: input.stripeCustomerId, allProfiles: customerIdsOf(client) },
  });

  return {
    message: `${client.name} vinculado a ${input.stripeCustomerId} (${customerIdsOf(client).length} perfil(es))`,
    client,
  };
}

/** Desvincula UN perfil (stripeCustomerId) o todos si no se indica. */
async function unlinkCustomer(clientId: string, stripeCustomerId?: string, user?: JwtPayload) {
  const client = await Client.findById(clientId);
  if (!client) throw new CustomError("Cliente no encontrado", 404);

  const current = customerIdsOf(client);
  if (!current.length) throw new CustomError("El cliente no tiene Stripe vinculado", 400);
  if (stripeCustomerId && !current.includes(stripeCustomerId)) {
    throw new CustomError("El cliente no tiene vinculado ese perfil", 400);
  }

  const removed = stripeCustomerId ? [stripeCustomerId] : current;
  const remaining = current.filter((id) => !removed.includes(id));

  client.stripeCustomerIds = remaining;
  client.stripeCustomerId = remaining[0] || null;
  await client.save();

  await AuditLog.create({
    action: "stripe.customer_unlinked",
    entity: "Client",
    entityId: client._id.toString(),
    userId: user?._id,
    userName: user?.name,
    level: "warn",
    meta: { removed, remaining },
  });

  return {
    message: remaining.length
      ? `${client.name}: perfil quitado, quedan ${remaining.length}`
      : `${client.name} desvinculado de Stripe`,
    client,
  };
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

  const profileIds = customerIdsOf(client);
  if (!profileIds.length) {
    throw new CustomError("El cliente no tiene un customer de Stripe vinculado", 400);
  }

  // Cargos de TODOS los perfiles del cliente, en orden cronológico.
  const charges = (await Promise.all(profileIds.map((id) => stripeService.listCharges(id))))
    .flat()
    .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());

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
      profiles: profileIds,
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
