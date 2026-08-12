import { MercuryAccount, MercuryTransaction, mercuryService } from "./mercury.service";

/**
 * Derivados de lectura sobre los movimientos del banco: totales, flujo mensual y
 * contrapartes. Todo se calcula en memoria a partir de los GET de Mercury.
 */

/** Transacciones que no mueven plata y no deben contar en los totales. */
const DEAD_STATUSES = new Set(["failed", "cancelled", "blocked", "reversed"]);

export interface CashflowPoint {
  /** `YYYY-MM` */
  period: string;
  inflow: number;
  outflow: number;
  net: number;
  count: number;
}

export interface CounterpartyPoint {
  name: string;
  outflow: number;
  inflow: number;
  count: number;
  lastAt: string | null;
}

export interface MercuryOverview {
  accounts: MercuryAccount[];
  totals: {
    accounts: number;
    currentBalance: number;
    availableBalance: number;
    pendingCount: number;
    /** Movimientos considerados en las métricas (ventana analizada). */
    analyzedTransactions: number;
  };
  window: { start: string; end: string; days: number };
  cashflow: CashflowPoint[];
  topCounterparties: CounterpartyPoint[];
  recentTransactions: MercuryTransaction[];
}

function isDead(tx: MercuryTransaction): boolean {
  return DEAD_STATUSES.has(String(tx.status || "").toLowerCase());
}

/** Fecha efectiva del movimiento: la de posteo si existe, si no la de creación. */
export function transactionDate(tx: MercuryTransaction): Date | null {
  const raw = tx.postedAt || tx.createdAt;
  if (!raw) return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function counterpartyOf(tx: MercuryTransaction): string {
  return (
    tx.counterpartyNickname ||
    tx.counterpartyName ||
    tx.bankDescription ||
    tx.externalMemo ||
    "Sin contraparte"
  ).toString();
}

/** Serie mensual continua (sin huecos) para los últimos `months` meses. */
export function buildCashflow(transactions: MercuryTransaction[], months: number): CashflowPoint[] {
  const byPeriod = new Map<string, CashflowPoint>();
  const now = new Date();

  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const period = periodOf(d);
    byPeriod.set(period, { period, inflow: 0, outflow: 0, net: 0, count: 0 });
  }

  for (const tx of transactions) {
    if (isDead(tx)) continue;
    const date = transactionDate(tx);
    if (!date) continue;
    const point = byPeriod.get(periodOf(date));
    if (!point) continue;

    const amount = Number(tx.amount || 0);
    if (amount >= 0) point.inflow += amount;
    else point.outflow += Math.abs(amount);
    point.net += amount;
    point.count += 1;
  }

  return Array.from(byPeriod.values());
}

export function buildCounterparties(
  transactions: MercuryTransaction[],
  limit = 8
): CounterpartyPoint[] {
  const map = new Map<string, CounterpartyPoint>();

  for (const tx of transactions) {
    if (isDead(tx)) continue;
    const name = counterpartyOf(tx);
    const current = map.get(name) || { name, outflow: 0, inflow: 0, count: 0, lastAt: null };
    const amount = Number(tx.amount || 0);

    if (amount >= 0) current.inflow += amount;
    else current.outflow += Math.abs(amount);
    current.count += 1;

    const date = transactionDate(tx);
    if (date && (!current.lastAt || date > new Date(current.lastAt))) {
      current.lastAt = date.toISOString();
    }

    map.set(name, current);
  }

  return Array.from(map.values())
    .sort((a, b) => b.outflow + b.inflow - (a.outflow + a.inflow))
    .slice(0, limit);
}

/**
 * Foto general del banco: cuentas, saldos, flujo mensual y últimos movimientos.
 * @param days ventana de movimientos a analizar (por defecto 180 días ≈ 6 meses).
 */
export async function buildOverview(days = 180, months = 6): Promise<MercuryOverview> {
  const accounts = await mercuryService.listAccounts();

  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const startISO = start.toISOString().slice(0, 10);
  const endISO = end.toISOString().slice(0, 10);

  const pages = await Promise.all(
    accounts.map((account) =>
      mercuryService
        .listTransactions(account.id, { limit: 500, start: startISO, end: endISO, order: "desc" })
        .catch((error) => {
          console.error(`[mercury] overview: cuenta ${account.id} sin movimientos (${(error as Error).message})`);
          return { total: 0, transactions: [] as MercuryTransaction[] };
        })
    )
  );

  const transactions = pages.flatMap((page) => page.transactions);

  const recentTransactions = [...transactions]
    .sort((a, b) => {
      const da = transactionDate(a)?.getTime() ?? 0;
      const db = transactionDate(b)?.getTime() ?? 0;
      return db - da;
    })
    .slice(0, 15);

  return {
    accounts,
    totals: {
      accounts: accounts.length,
      currentBalance: accounts.reduce((sum, a) => sum + Number(a.currentBalance || 0), 0),
      availableBalance: accounts.reduce((sum, a) => sum + Number(a.availableBalance || 0), 0),
      pendingCount: transactions.filter((tx) => String(tx.status).toLowerCase() === "pending").length,
      analyzedTransactions: transactions.length,
    },
    window: { start: startISO, end: endISO, days },
    cashflow: buildCashflow(transactions, months),
    topCounterparties: buildCounterparties(transactions),
    recentTransactions,
  };
}
