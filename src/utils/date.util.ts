/**
 * Utilidades de fechas para períodos de cobro "YYYY-MM".
 * Todo se maneja en hora local del servidor (TZ=America/Guayaquil).
 */

export function toPeriod(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function parsePeriod(period: string): { year: number; month: number } {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) {
    throw new Error(`Período inválido: ${period}. Formato esperado YYYY-MM.`);
  }
  return { year: y, month: m };
}

export function isValidPeriod(period: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Convierte un día del mes (1-31) a una fecha real del período, recortando al último día. */
export function dayToDate(period: string, day: number | null | undefined, fallbackDay = 1): Date {
  const { year, month } = parsePeriod(period);
  const max = daysInMonth(year, month);
  const target = Math.min(Math.max(day ?? fallbackDay, 1), max);
  return new Date(year, month - 1, target, 12, 0, 0, 0);
}

/** Último día del período. */
export function endOfPeriod(period: string): Date {
  const { year, month } = parsePeriod(period);
  return new Date(year, month - 1, daysInMonth(year, month), 23, 59, 59, 999);
}

export function startOfPeriod(period: string): Date {
  const { year, month } = parsePeriod(period);
  return new Date(year, month - 1, 1, 0, 0, 0, 0);
}

export function addMonthsToPeriod(period: string, months: number): string {
  const { year, month } = parsePeriod(period);
  const d = new Date(year, month - 1 + months, 1);
  return toPeriod(d);
}

/** Lista de períodos inclusivos entre dos fechas. */
export function periodRange(from: Date, to: Date): string[] {
  const out: string[] = [];
  let cursor = toPeriod(from);
  const last = toPeriod(to);
  let guard = 0;
  while (guard < 600) {
    out.push(cursor);
    if (cursor === last) break;
    cursor = addMonthsToPeriod(cursor, 1);
    guard += 1;
  }
  return out;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Días completos transcurridos entre dos fechas (b - a). */
export function diffInDays(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86400000);
}

/** Último viernes laborable del período (soporta el caso de Anderson Boscán). */
export function lastWeekdayOfPeriod(period: string, weekday = 5): Date {
  const { year, month } = parsePeriod(period);
  const d = new Date(year, month - 1, daysInMonth(year, month), 12, 0, 0, 0);
  while (d.getDay() !== weekday) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

export function formatMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount || 0);
}

export function formatDateEs(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("es-EC", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(date));
}

export function periodLabelEs(period: string): string {
  const { year, month } = parsePeriod(period);
  const label = new Intl.DateTimeFormat("es-EC", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1)
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}
