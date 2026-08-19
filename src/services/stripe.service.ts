import Stripe from "stripe";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";

/**
 * Cliente de Stripe. Mismo patrón que mercury/metrics: singleton perezoso que
 * solo se instancia si la clave está configurada, para que el resto de la app
 * funcione igual sin Stripe.
 *
 * La clave puede ser sk_ o rk_ (restricted). Con una restricted hacen falta al
 * menos: Customers (read), Charges (read) y Checkout Sessions (write).
 */

let client: Stripe | null = null;

function isConfigured(): boolean {
  return Boolean(env.stripe.secretKey);
}

function getClient(): Stripe {
  if (!isConfigured()) {
    throw new CustomError("Stripe no está configurado en el servidor", 503);
  }
  if (!client) {
    client = new Stripe(env.stripe.secretKey);
  }
  return client;
}

export interface StripeCustomerSummary {
  stripeCustomerId: string;
  name: string;
  email?: string;
  created: Date;
}

async function listCustomers(): Promise<StripeCustomerSummary[]> {
  const stripe = getClient();
  const customers: StripeCustomerSummary[] = [];

  for await (const customer of stripe.customers.list({ limit: 100 })) {
    customers.push({
      stripeCustomerId: customer.id,
      name: customer.name || customer.email || customer.id,
      email: customer.email || undefined,
      created: new Date(customer.created * 1000),
    });
  }

  return customers;
}

export interface StripeChargeSummary {
  stripeChargeId: string;
  amount: number;
  currency: string;
  paidAt: Date;
  description?: string;
  receiptUrl?: string;
}

/** Solo cargos cobrados de verdad: pagados y no reembolsados. */
async function listCharges(stripeCustomerId: string): Promise<StripeChargeSummary[]> {
  const stripe = getClient();
  const charges: StripeChargeSummary[] = [];

  for await (const charge of stripe.charges.list({ customer: stripeCustomerId, limit: 100 })) {
    if (!charge.paid || charge.refunded) continue;
    charges.push({
      stripeChargeId: charge.id,
      amount: charge.amount / 100,
      currency: charge.currency.toUpperCase(),
      paidAt: new Date(charge.created * 1000),
      description: charge.description || undefined,
      receiptUrl: charge.receipt_url || undefined,
    });
  }

  return charges.sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
}

export interface CheckoutSessionInput {
  invoiceId: string;
  clientId: string;
  stripeCustomerId?: string | null;
  amount: number;
  currency: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
}

async function createCheckoutSession(input: CheckoutSessionInput): Promise<{ url: string; sessionId: string }> {
  const stripe = getClient();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: input.stripeCustomerId || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: Math.round(input.amount * 100),
          product_data: { name: input.description },
        },
      },
    ],
    metadata: { invoiceId: input.invoiceId, clientId: input.clientId },
    payment_intent_data: {
      metadata: { invoiceId: input.invoiceId, clientId: input.clientId },
    },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });

  if (!session.url) {
    throw new CustomError("Stripe no devolvió la URL de pago", 502);
  }

  return { url: session.url, sessionId: session.id };
}

/** Verifica la firma del webhook y devuelve el evento. El body debe ser el raw Buffer. */
function constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
  if (!env.stripe.webhookSecret) {
    throw new CustomError("STRIPE_WEBHOOK_SECRET no está configurado", 503);
  }
  try {
    return getClient().webhooks.constructEvent(rawBody, signature, env.stripe.webhookSecret);
  } catch (error) {
    throw new CustomError("Firma de webhook de Stripe inválida", 400, error);
  }
}

/** Resuelve el charge (ch_...) detrás de un PaymentIntent, para deduplicar. */
async function getChargeIdFromPaymentIntent(paymentIntentId: string): Promise<string | null> {
  const stripe = getClient();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const latest = intent.latest_charge;
  if (!latest) return null;
  return typeof latest === "string" ? latest : latest.id;
}

export const stripeService = {
  isConfigured,
  listCustomers,
  listCharges,
  createCheckoutSession,
  constructWebhookEvent,
  getChargeIdFromPaymentIntent,
};
