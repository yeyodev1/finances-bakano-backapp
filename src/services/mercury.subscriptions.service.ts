import { MercuryTransaction, mercuryService } from "./mercury.service";
import { transactionDate } from "./mercury.insights.service";

/**
 * Detección de suscripciones (cargos recurrentes) a partir de los movimientos del banco.
 *
 * Mercury no expone "suscripciones" como concepto: se infieren agrupando los cargos de salida
 * por comercio **y monto exacto**. Un cobro de suscripción siempre repite el mismo monto; un
 * gasto normal (Uber, comida) varía. Los intentos rechazados se conservan porque son la señal
 * más útil: una suscripción que rebota sigue activa y va a cortar el servicio.
 *
 * Todo el cálculo es local y de solo lectura.
 */

/** Movimientos entre cuentas propias: nunca son suscripciones. */
const IGNORED_KINDS = new Set(["internalTransfer", "treasuryTransfer", "wireFee"]);

/** Contrapartes que son la propia Mercury (pago de tarjeta, ahorro): no son suscripciones. */
const IGNORED_MERCHANTS = [/^mercury /];

/** Un cobro cuenta como cobrado si está en estos estados. */
const CHARGED_STATUSES = new Set(["sent", "pending"]);

/**
 * Un cobro rechazado se reintenta varias veces en días seguidos. Los intentos del mismo monto
 * dentro de esta ventana son **el mismo cobro**, no cobros distintos.
 */
const RETRY_WINDOW_DAYS = 4;

/**
 * Qué porcentaje de los cobros del comercio tiene que compartir el mismo monto para
 * considerarlo suscripción. Un SaaS cobra siempre igual; un restaurante no.
 */
const DOMINANCE_STRICT = 0.5;
const DOMINANCE_LOOSE = 0.34;

const DAYS_PER_MONTH = 30.44;

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "irregular";

const CADENCES: Array<{ cadence: Cadence; label: string; min: number; max: number; days: number }> = [
  { cadence: "weekly", label: "Semanal", min: 5, max: 9, days: 7 },
  { cadence: "biweekly", label: "Quincenal", min: 12, max: 18, days: 15 },
  { cadence: "monthly", label: "Mensual", min: 24, max: 38, days: DAYS_PER_MONTH },
  { cadence: "quarterly", label: "Trimestral", min: 80, max: 100, days: 91 },
  { cadence: "yearly", label: "Anual", min: 330, max: 400, days: 365 },
];

export interface SubscriptionCharge {
  id: string;
  date: string;
  amount: number;
  /** `sent` | `pending` | `failed` … tal como lo reporta Mercury. */
  status: string;
  failed: boolean;
  /** Intentos que hizo el comercio para este mismo cobro (1 = salió a la primera). */
  attempts: number;
  accountId?: string;
  cardId?: string | null;
}

export type SubscriptionStatus = "active" | "failing" | "due" | "stale";

export interface Subscription {
  /** `comercio|monto`: identifica el plan, no solo el comercio. */
  key: string;
  name: string;
  amount: number;
  cadence: Cadence;
  cadenceLabel: string;
  /** Días entre cobros (mediana). 0 si no hay suficientes cobros para medirlo. */
  intervalDays: number;
  /** Costo mensual equivalente. Si la cadencia es irregular o estimada, ver `estimated`. */
  monthlyCost: number;
  yearlyCost: number;
  /** true cuando la cadencia se asumió mensual por falta de historial. */
  estimated: boolean;
  /** Cobros efectivos (sent/pending), con reintentos ya colapsados. */
  charges: number;
  /** Cobros que nunca lograron pasar. */
  failedCharges: number;
  /** Intentos rechazados en total (un cobro puede reintentarse decenas de veces). */
  failedAttempts: number;
  totalPaid: number;
  /** Plata que quedó sin cobrarse por los rechazos. */
  failedAmount: number;
  firstChargeAt: string | null;
  lastChargeAt: string | null;
  /** Último intento, haya salido o no. */
  lastAttemptAt: string;
  lastAttemptFailed: boolean;
  nextChargeAt: string | null;
  daysSinceLast: number | null;
  status: SubscriptionStatus;
  accountIds: string[];
  cardIds: string[];
  recentCharges: SubscriptionCharge[];
}

export interface SubscriptionsReport {
  window: { start: string; end: string; days: number };
  /** Rango de fechas realmente cubierto por los movimientos leídos. */
  history: { from: string | null; to: string | null; days: number; transactions: number };
  totals: {
    subscriptions: number;
    active: number;
    failing: number;
    monthlyCost: number;
    yearlyCost: number;
    paidInWindow: number;
    failedAmount: number;
  };
  items: Subscription[];
  /** Comercios con gasto repetido pero montos variables: gasto recurrente, no suscripción. */
  candidates: Array<{ name: string; charges: number; totalPaid: number; lastChargeAt: string }>;
}

/** "GOOGLE *Workspace_bak 8829" y "Google *Workspace" caen en la misma clave. */
export function merchantKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\b(inc|llc|ltd|corp|sa|srl)\b/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join(" ");
}

function merchantName(tx: MercuryTransaction): string {
  return String(
    tx.counterpartyNickname || tx.counterpartyName || tx.bankDescription || tx.externalMemo || ""
  ).trim();
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function classify(intervalDays: number) {
  return CADENCES.find((c) => intervalDays >= c.min && intervalDays <= c.max) || null;
}

interface Attempt {
  tx: MercuryTransaction;
  date: Date;
  amount: number;
  failed: boolean;
}

/** Un cobro real, con todos sus reintentos colapsados. */
interface ChargeEvent {
  date: Date;
  attempts: Attempt[];
  /** El cobro terminó saliendo (algún intento no falló). */
  paid: boolean;
}

/**
 * Colapsa los reintentos: intentos del mismo monto separados por menos de
 * `RETRY_WINDOW_DAYS` son el mismo cobro rebotando, no cobros distintos.
 */
function collapseRetries(attempts: Attempt[]): ChargeEvent[] {
  const sorted = [...attempts].sort((a, b) => a.date.getTime() - b.date.getTime());
  const events: ChargeEvent[] = [];

  for (const attempt of sorted) {
    const current = events.at(-1);
    const gapDays = current
      ? (attempt.date.getTime() - current.attempts.at(-1)!.date.getTime()) / 86_400_000
      : Infinity;

    if (current && gapDays <= RETRY_WINDOW_DAYS) {
      current.attempts.push(attempt);
      current.date = attempt.date;
      current.paid = current.paid || !attempt.failed;
    } else {
      events.push({ date: attempt.date, attempts: [attempt], paid: !attempt.failed });
    }
  }

  return events;
}

/**
 * Agrupa por comercio + monto exacto y decide qué grupo es una suscripción.
 *
 * Un cobro de suscripción repite el mismo monto y domina el gasto de ese comercio; un gasto
 * normal varía. Por eso califica cuando el monto concentra buena parte de los cobros del
 * comercio, o cuando hay un cobro que lleva varios rechazos seguidos (suscripción rebotando).
 *
 * @param historyDays días de historial disponibles; se usa para estimar el costo mensual de
 *        las suscripciones con cadencia irregular.
 */
export function detectSubscriptions(
  transactions: MercuryTransaction[],
  historyDays = 0
): Pick<SubscriptionsReport, "items" | "candidates"> {
  const byMerchant = new Map<string, Attempt[]>();

  for (const tx of transactions) {
    const amount = Number(tx.amount || 0);
    if (amount >= 0) continue; // solo salidas
    if (IGNORED_KINDS.has(String(tx.kind || ""))) continue;

    const name = merchantName(tx);
    const key = name ? merchantKey(name) : "";
    const date = transactionDate(tx);
    if (!key || !date) continue;
    if (IGNORED_MERCHANTS.some((pattern) => pattern.test(key))) continue;

    const status = String(tx.status || "").toLowerCase();
    const failed = !CHARGED_STATUSES.has(status);

    const bucket = byMerchant.get(key) || [];
    bucket.push({ tx, date, amount: Math.abs(amount), failed });
    byMerchant.set(key, bucket);
  }

  const items: Subscription[] = [];
  const candidates: SubscriptionsReport["candidates"] = [];
  const now = Date.now();

  for (const [merchant, attempts] of byMerchant) {
    // Dentro del comercio, cada monto distinto es un plan distinto ($25 y $497 de HighLevel).
    const byAmount = new Map<string, Attempt[]>();
    for (const attempt of attempts) {
      const amountKey = attempt.amount.toFixed(2);
      byAmount.set(amountKey, [...(byAmount.get(amountKey) || []), attempt]);
    }

    const eventsByAmount = new Map<string, ChargeEvent[]>();
    for (const [amountKey, group] of byAmount) {
      eventsByAmount.set(amountKey, collapseRetries(group));
    }

    const merchantEvents = [...eventsByAmount.values()].reduce((sum, e) => sum + e.length, 0);
    let matched = false;

    for (const [amountKey, events] of eventsByAmount) {
      const paidEvents = events.filter((e) => e.paid);
      const failedEvents = events.filter((e) => !e.paid);
      const dominance = merchantEvents ? events.length / merchantEvents : 0;
      const attemptsInGroup = byAmount.get(amountKey)!;

      const failedAttempts = attemptsInGroup.filter((a) => a.failed);

      // La cadencia se mide entre cobros reales, ya sin reintentos.
      const gaps: number[] = [];
      for (let i = 1; i < paidEvents.length; i += 1) {
        gaps.push((paidEvents[i].date.getTime() - paidEvents[i - 1].date.getTime()) / 86_400_000);
      }
      const intervalDays = median(gaps);
      const matchedCadence = intervalDays ? classify(intervalDays) : null;

      const qualifies =
        // Tres o más cobros iguales: recurrencia clara aunque el comercio venda otras cosas.
        (paidEvents.length >= 3 && dominance >= DOMINANCE_LOOSE) ||
        // Solo dos cobros: se exige que el monto domine y que la cadencia calce.
        (paidEvents.length === 2 &&
          dominance >= 0.6 &&
          (!!matchedCadence || dominance >= DOMINANCE_STRICT + 0.3)) ||
        // Cobro rebotando: 3+ rechazos y es lo que más cobra ese comercio. Sigue activa.
        (paidEvents.length <= 1 && failedAttempts.length >= 3 && dominance >= DOMINANCE_STRICT);

      if (!qualifies) continue;
      matched = true;

      const amount = Number(amountKey);
      const name = merchantName(attemptsInGroup.at(-1)!.tx) || merchant;
      const estimated = !matchedCadence;
      const cadence: Cadence = matchedCadence?.cadence ?? (intervalDays ? "irregular" : "monthly");
      const cadenceLabel =
        matchedCadence?.label ?? (intervalDays ? "Irregular (estimado)" : "Mensual (estimado)");
      const cycleDays = matchedCadence?.days ?? DAYS_PER_MONTH;

      // Con cadencia clara el costo mensual sale del ciclo; si es irregular se prorratea lo
      // realmente cobrado sobre el historial disponible, que es más honesto que inventar ciclo.
      const paidTotal = paidEvents.reduce(
        (sum, event) => sum + (event.attempts.find((a) => !a.failed)?.amount ?? 0),
        0
      );
      const monthlyCost =
        matchedCadence || !intervalDays || !historyDays
          ? (amount * DAYS_PER_MONTH) / cycleDays
          : (paidTotal / historyDays) * DAYS_PER_MONTH;

      const lastPaid = paidEvents.at(-1) ?? null;
      const lastEvent = events.at(-1)!;
      const daysSinceLast = lastPaid
        ? Math.floor((now - lastPaid.date.getTime()) / 86_400_000)
        : null;

      let status: SubscriptionStatus = "active";
      if (!lastEvent.paid || daysSinceLast === null) status = "failing";
      else if (daysSinceLast > cycleDays * 2) status = "stale";
      else if (daysSinceLast > cycleDays * 1.15) status = "due";

      items.push({
        key: `${merchant}|${amountKey}`,
        name,
        amount,
        cadence,
        cadenceLabel,
        intervalDays: Math.round(intervalDays),
        monthlyCost,
        yearlyCost: monthlyCost * 12,
        estimated,
        charges: paidEvents.length,
        failedCharges: failedEvents.length,
        failedAttempts: failedAttempts.length,
        totalPaid: paidTotal,
        failedAmount: failedEvents.length * amount,
        firstChargeAt: paidEvents[0]?.date.toISOString() ?? null,
        lastChargeAt: lastPaid?.date.toISOString() ?? null,
        lastAttemptAt: lastEvent.date.toISOString(),
        lastAttemptFailed: !lastEvent.paid,
        nextChargeAt: lastPaid
          ? new Date(lastPaid.date.getTime() + cycleDays * 86_400_000).toISOString()
          : null,
        daysSinceLast,
        status,
        accountIds: [
          ...new Set(attemptsInGroup.map((a) => String(a.tx.accountId || "")).filter(Boolean)),
        ],
        cardIds: [...new Set(attemptsInGroup.map((a) => String(a.tx.cardId || "")).filter(Boolean))],
        recentCharges: events
          .slice(-8)
          .reverse()
          .map((event) => {
            const representative = event.attempts.find((a) => !a.failed) ?? event.attempts.at(-1)!;
            return {
              id: String(representative.tx.id),
              date: event.date.toISOString(),
              amount: representative.amount,
              status: String(representative.tx.status || ""),
              failed: !event.paid,
              attempts: event.attempts.length,
              accountId: representative.tx.accountId,
              cardId: representative.tx.cardId ?? null,
            };
          }),
      });
    }

    // Comercio con gasto repetido pero sin monto fijo: gasto recurrente, no suscripción.
    if (!matched) {
      const paid = attempts.filter((a) => !a.failed);
      if (paid.length >= 3) {
        candidates.push({
          name: merchantName(paid.at(-1)!.tx) || merchant,
          charges: paid.length,
          totalPaid: paid.reduce((sum, a) => sum + a.amount, 0),
          lastChargeAt: paid.at(-1)!.date.toISOString(),
        });
      }
    }
  }

  items.sort((a, b) => b.monthlyCost - a.monthlyCost);
  candidates.sort((a, b) => b.totalPaid - a.totalPaid);

  return { items, candidates: candidates.slice(0, 10) };
}

/** Datos mínimos para marcar un movimiento como parte de una suscripción. */
export interface SubscriptionTag {
  key: string;
  name: string;
  cadenceLabel: string;
  status: SubscriptionStatus;
  monthlyCost: number;
}

/**
 * Índice `merchantKey|monto` → suscripción, para etiquetar movimientos sueltos sin recalcular
 * la detección en cada request. Se memoiza aparte porque la lista de movimientos se pide mucho
 * más seguido que el reporte completo.
 */
let indexCache: { at: number; index: Map<string, SubscriptionTag> } | null = null;
const INDEX_TTL_MS = 60_000;

export async function subscriptionIndex(force = false): Promise<Map<string, SubscriptionTag>> {
  const now = Date.now();
  if (!force && indexCache && now - indexCache.at < INDEX_TTL_MS) return indexCache.index;

  const report = await buildSubscriptions(365);
  const index = new Map<string, SubscriptionTag>(
    report.items.map((item) => [
      item.key,
      {
        key: item.key,
        name: item.name,
        cadenceLabel: item.cadenceLabel,
        status: item.status,
        monthlyCost: item.monthlyCost,
      },
    ])
  );

  indexCache = { at: now, index };
  return index;
}

export function clearSubscriptionIndex(): void {
  indexCache = null;
}

/** Clave con la que un movimiento entra al índice de suscripciones. */
export function transactionSubscriptionKey(tx: MercuryTransaction): string | null {
  const amount = Number(tx.amount || 0);
  if (amount >= 0) return null;
  if (IGNORED_KINDS.has(String(tx.kind || ""))) return null;

  const name = merchantName(tx);
  if (!name) return null;
  const merchant = merchantKey(name);
  if (!merchant) return null;

  return `${merchant}|${Math.abs(amount).toFixed(2)}`;
}

/** Agrega `subscription` a los movimientos que corresponden a una suscripción detectada. */
export function annotateTransactions<T extends MercuryTransaction>(
  transactions: T[],
  index: Map<string, SubscriptionTag>
): Array<T & { subscription: SubscriptionTag | null }> {
  return transactions.map((tx) => {
    const key = transactionSubscriptionKey(tx);
    return { ...tx, subscription: (key && index.get(key)) || null };
  });
}

/**
 * Reporte de suscripciones leyendo los movimientos de todas las cuentas.
 * @param days ventana solicitada; el historial real puede ser menor si la cuenta es nueva.
 */
export async function buildSubscriptions(days = 365): Promise<SubscriptionsReport> {
  const accounts = await mercuryService.listAccounts();

  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const startISO = start.toISOString().slice(0, 10);
  const endISO = end.toISOString().slice(0, 10);

  const pages = await Promise.all(
    accounts.map((account) =>
      mercuryService
        .listTransactions(account.id, { limit: 500, start: startISO, end: endISO, order: "desc" })
        .catch(() => ({ total: 0, transactions: [] as MercuryTransaction[] }))
    )
  );

  const transactions = pages.flatMap((page) => page.transactions);
  const dates = transactions
    .map((tx) => transactionDate(tx))
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime());

  const from = dates[0] ?? null;
  const to = dates.at(-1) ?? null;
  const historyDays =
    from && to ? Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000)) : 0;

  const { items, candidates } = detectSubscriptions(transactions, historyDays);
  const live = items.filter((item) => item.status !== "stale");

  return {
    window: { start: startISO, end: endISO, days },
    history: {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
      days: historyDays,
      transactions: transactions.length,
    },
    totals: {
      subscriptions: items.length,
      active: live.length,
      failing: items.filter((item) => item.status === "failing").length,
      monthlyCost: live.reduce((sum, item) => sum + item.monthlyCost, 0),
      yearlyCost: live.reduce((sum, item) => sum + item.yearlyCost, 0),
      paidInWindow: items.reduce((sum, item) => sum + item.totalPaid, 0),
      failedAmount: items.reduce((sum, item) => sum + item.failedAmount, 0),
    },
    items,
    candidates,
  };
}
