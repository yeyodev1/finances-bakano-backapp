import Stripe from "stripe";
import { AuditLog, Client, Invoice, Payment, StripeEvent } from "../models";
import { StripeEventOutcome } from "../models/stripeEvent.model";
import { paymentService } from "./payment.service";
import { stripeService } from "./stripe.service";

const OPEN_STATUSES = ["pending", "partial", "overdue"];

interface ChargeContext {
  stripeChargeId: string | null;
  stripeCustomerId: string | null;
  invoiceIdHint?: string;
  clientIdHint?: string;
  amount: number;
  currency: string;
  paidAt: Date;
}

/**
 * El resultado siempre se persiste en StripeEvent SALVO cuando el procesamiento
 * revienta: ahí no se guarda nada y se responde 5xx para que Stripe reintente.
 */
async function record(
  event: Stripe.Event,
  outcome: StripeEventOutcome,
  detail?: string,
  extra?: { stripeChargeId?: string; paymentId?: unknown }
) {
  try {
    await StripeEvent.create({
      eventId: event.id,
      type: event.type,
      outcome,
      detail,
      stripeChargeId: extra?.stripeChargeId,
      paymentId: extra?.paymentId,
      processedAt: new Date(),
    });
  } catch (error) {
    // Índice único: otro worker ya registró este evento. No es un error.
    console.error("[stripe] No se pudo registrar el evento:", error);
  }
  return { eventId: event.id, outcome, detail };
}

async function contextFromCheckoutSession(session: Stripe.Checkout.Session): Promise<ChargeContext | null> {
  if (session.payment_status !== "paid") return null;

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;

  return {
    stripeChargeId: paymentIntentId
      ? await stripeService.getChargeIdFromPaymentIntent(paymentIntentId)
      : null,
    stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id || null,
    invoiceIdHint: session.metadata?.invoiceId,
    clientIdHint: session.metadata?.clientId,
    amount: (session.amount_total || 0) / 100,
    currency: (session.currency || "usd").toUpperCase(),
    paidAt: new Date(session.created * 1000),
  };
}

function contextFromCharge(charge: Stripe.Charge): ChargeContext | null {
  if (!charge.paid || charge.refunded) return null;

  return {
    stripeChargeId: charge.id,
    stripeCustomerId: typeof charge.customer === "string" ? charge.customer : charge.customer?.id || null,
    invoiceIdHint: charge.metadata?.invoiceId,
    clientIdHint: charge.metadata?.clientId,
    amount: charge.amount / 100,
    currency: charge.currency.toUpperCase(),
    paidAt: new Date(charge.created * 1000),
  };
}

async function resolveClient(ctx: ChargeContext) {
  if (ctx.clientIdHint) {
    const byId = await Client.findById(ctx.clientIdHint);
    if (byId) return byId;
  }
  if (ctx.stripeCustomerId) {
    return Client.findOne({ stripeCustomerId: ctx.stripeCustomerId });
  }
  return null;
}

async function applyCharge(event: Stripe.Event, ctx: ChargeContext) {
  if (ctx.amount <= 0) {
    return record(event, "skipped", "Monto cero");
  }

  if (ctx.stripeChargeId) {
    const existing = await Payment.findOne({ stripeChargeId: ctx.stripeChargeId });
    if (existing) {
      return record(event, "skipped", "El cargo ya tenía un pago registrado", {
        stripeChargeId: ctx.stripeChargeId,
        paymentId: existing._id,
      });
    }
  }

  const client = await resolveClient(ctx);
  if (!client) {
    await AuditLog.create({
      action: "stripe.charge_unmatched",
      entity: "StripeEvent",
      entityId: event.id,
      level: "warn",
      meta: {
        stripeCustomerId: ctx.stripeCustomerId,
        stripeChargeId: ctx.stripeChargeId,
        amount: ctx.amount,
        currency: ctx.currency,
      },
    });
    return record(
      event,
      "unmatched",
      `Cliente de Stripe sin vincular (${ctx.stripeCustomerId || "sin customer"}). Vincúlalo y reimporta.`,
      { stripeChargeId: ctx.stripeChargeId || undefined }
    );
  }

  let invoice = ctx.invoiceIdHint ? await Invoice.findById(ctx.invoiceIdHint) : null;
  if (!invoice || !OPEN_STATUSES.includes(invoice.status)) {
    invoice = await Invoice.findOne({ clientId: client._id, status: { $in: OPEN_STATUSES } }).sort({
      dueDate: 1,
      splitIndex: 1,
    });
  }

  if (!invoice) {
    return record(
      event,
      "unmatched",
      `${client.name} pagó ${ctx.amount} ${ctx.currency} pero no tiene cobros abiertos`,
      { stripeChargeId: ctx.stripeChargeId || undefined }
    );
  }

  const { payment } = await paymentService.register({
    invoiceId: invoice._id.toString(),
    amount: ctx.amount,
    paidAt: ctx.paidAt,
    method: "stripe",
    reference: ctx.stripeChargeId || event.id,
    stripeChargeId: ctx.stripeChargeId || undefined,
    source: "stripe",
    registeredByName: "Stripe",
  });

  return record(event, "processed", undefined, {
    stripeChargeId: ctx.stripeChargeId || undefined,
    paymentId: payment._id,
  });
}

async function handleEvent(event: Stripe.Event) {
  const already = await StripeEvent.findOne({ eventId: event.id });
  if (already) {
    return { eventId: event.id, outcome: already.outcome, detail: "Evento ya procesado" };
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const ctx = await contextFromCheckoutSession(event.data.object);
      if (!ctx) return record(event, "skipped", "Checkout sin pago confirmado");
      return applyCharge(event, ctx);
    }
    case "charge.succeeded": {
      const ctx = contextFromCharge(event.data.object);
      if (!ctx) return record(event, "skipped", "Cargo no pagado o reembolsado");
      return applyCharge(event, ctx);
    }
    default:
      return record(event, "skipped", "Tipo de evento no manejado");
  }
}

export const stripeWebhookService = { handleEvent };
