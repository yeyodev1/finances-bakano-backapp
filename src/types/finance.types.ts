export const PAYMENT_METHODS = [
  "transferencia",
  "stripe",
  "cheque",
  "transferencia_o_cheque",
  "efectivo",
  "no_paga",
  "otro",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const BILLING_TYPES = ["monthly", "no_charge", "special"] as const;
export type BillingType = (typeof BILLING_TYPES)[number];

export const INVOICE_STATUSES = [
  "pending",
  "partial",
  "paid",
  "overdue",
  "waived",
  "cancelled",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const EMAIL_TYPES = [
  "payment_registered",
  "reminder_before_due",
  "overdue_alert",
  "workspace_deactivated",
  "workspace_reactivated",
  "monthly_summary",
  "payment_deferred",
  "client_archived",
  "access_granted",
  "access_revoked",
  "test",
] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];

/** Motivos por los que un cliente deja de facturarse. */
export const ARCHIVE_REASONS = [
  "impago",
  "cancelacion_cliente",
  "cierre_negocio",
  "competencia",
  "precio",
  "insatisfaccion_resultados",
  "pausa_temporal",
  "fin_contrato",
  "decision_bakano",
  "reembolso",
  "garantia_fallida",
  "otro",
] as const;
export type ArchiveReason = (typeof ARCHIVE_REASONS)[number];

export const ARCHIVE_REASON_LABELS: Record<ArchiveReason, string> = {
  impago: "Impago / mora",
  cancelacion_cliente: "El cliente canceló el servicio",
  cierre_negocio: "Cerró el negocio",
  competencia: "Se fue con la competencia",
  precio: "Precio",
  insatisfaccion_resultados: "Insatisfecho con los resultados",
  pausa_temporal: "Pausa temporal",
  fin_contrato: "Fin de contrato",
  decision_bakano: "Decisión de Bakano",
  reembolso: "Se le devolvió el dinero",
  garantia_fallida: "Garantía agotada sin resultados",
  otro: "Otro",
};

// ── Reembolsos ───────────────────────────────────────────────────
// Plata que ya entró y vuelve a salir. No se toca el pago original ni el estado
// de la factura: el cobro existió. El reembolso es un asiento aparte que se resta.

export const REFUND_REASONS = [
  "garantia",
  "sin_resultados",
  "servicio_no_prestado",
  "cobro_duplicado",
  "error_de_cobro",
  "acuerdo_comercial",
  "otro",
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const REFUND_REASON_LABELS: Record<RefundReason, string> = {
  garantia: "Garantía: no hubo resultados",
  sin_resultados: "Sin resultados",
  servicio_no_prestado: "Servicio no prestado",
  cobro_duplicado: "Cobro duplicado",
  error_de_cobro: "Error en el cobro",
  acuerdo_comercial: "Acuerdo comercial",
  otro: "Otro",
};

// ── Garantía ─────────────────────────────────────────────────────
// Bakano es agencia: si un cliente antiguo no vio resultados, se le regala el mes
// siguiente. Si aparecen resultados se vuelve a cobrar; si no, se estira un segundo
// mes. Agotados los dos meses sin cambio, la garantía se marca como fracaso.

export const GUARANTEE_STATUSES = [
  "abierta",
  "extendida",
  "cumplida",
  "fallida",
  "cancelada",
] as const;
export type GuaranteeStatus = (typeof GUARANTEE_STATUSES)[number];

export const GUARANTEE_STATUS_LABELS: Record<GuaranteeStatus, string> = {
  abierta: "Primer mes de garantía",
  extendida: "Segundo mes de garantía",
  cumplida: "Hubo resultados: vuelve a cobrarse",
  fallida: "Fracaso: sin resultados en dos meses",
  cancelada: "Garantía cancelada",
};

/** Garantías todavía corriendo: el cliente no paga y el reloj avanza. */
export const GUARANTEE_OPEN_STATUSES: GuaranteeStatus[] = ["abierta", "extendida"];

/** Tope de meses regalados por política. Al superarlo se marca fracaso. */
export const GUARANTEE_MAX_CYCLES = 2;

/** Cómo termina una garantía. `cancelada` es la salida administrativa (se abrió por error). */
export const GUARANTEE_OUTCOMES = ["cumplida", "fallida", "cancelada"] as const;
export type GuaranteeOutcome = (typeof GUARANTEE_OUTCOMES)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  transferencia: "Transferencia",
  stripe: "Stripe",
  cheque: "Cheque",
  transferencia_o_cheque: "Transferencia o Cheque",
  efectivo: "Efectivo",
  no_paga: "No paga",
  otro: "Otro",
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  pending: "Pendiente",
  partial: "Pago parcial",
  paid: "Pagado",
  overdue: "Vencido",
  waived: "Condonado",
  cancelled: "Anulado",
};

// ── Ventas ───────────────────────────────────────────────────────
// Una venta es un acuerdo cerrado hoy que se cobra más adelante: por eso vive
// aparte de las facturas, que solo existen cuando ya hay cliente y período.

/** Cadencia de los cobros pactados. `unico` ignora el número de cuotas. */
export const SALE_FREQUENCIES = ["unico", "semanal", "quincenal", "mensual", "trimestral"] as const;
export type SaleFrequency = (typeof SALE_FREQUENCIES)[number];

export const SALE_FREQUENCY_LABELS: Record<SaleFrequency, string> = {
  unico: "Pago único",
  semanal: "Cada semana",
  quincenal: "Cada quince días",
  mensual: "Cada mes",
  trimestral: "Cada tres meses",
};

/** Días que avanza cada cuota según la cadencia. `unico` no repite. */
export const SALE_FREQUENCY_DAYS: Record<SaleFrequency, number> = {
  unico: 0,
  semanal: 7,
  quincenal: 15,
  mensual: 30,
  trimestral: 90,
};

/**
 * Cada concepto vendido. El vendedor negocia la mensualidad (400, 300, 250…) y
 * suele sumar extras puntuales tipo "página web": si solo se guardara el total
 * no habría forma de saber qué se ofreció ni a qué precio se cerró.
 */
export const SALE_ITEM_KINDS = ["recurrente", "unico"] as const;
export type SaleItemKind = (typeof SALE_ITEM_KINDS)[number];

export const SALE_ITEM_KIND_LABELS: Record<SaleItemKind, string> = {
  recurrente: "Mensualidad / recurrente",
  unico: "Pago único",
};

export const SALE_STATUSES = ["acordada", "cobrando", "cobrada", "perdida"] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  acordada: "Acordada, sin cobrar",
  cobrando: "Cobro en curso",
  cobrada: "Cobrada por completo",
  perdida: "Perdida",
};

export const SALE_INSTALLMENT_STATUSES = ["pendiente", "vencida", "cobrada"] as const;
export type SaleInstallmentStatus = (typeof SALE_INSTALLMENT_STATUSES)[number];

/** Por qué una venta acordada nunca llegó a cobrarse. */
export const SALE_LOST_REASONS = [
  "nunca_pago",
  "se_arrepintio",
  "no_contesta",
  "se_fue_competencia",
  "precio",
  "problema_interno",
  "otro",
] as const;
export type SaleLostReason = (typeof SALE_LOST_REASONS)[number];

export const SALE_LOST_REASON_LABELS: Record<SaleLostReason, string> = {
  nunca_pago: "Nunca pagó",
  se_arrepintio: "Se arrepintió",
  no_contesta: "Dejó de contestar",
  se_fue_competencia: "Se fue con la competencia",
  precio: "Precio",
  problema_interno: "Problema interno de Bakano",
  otro: "Otro",
};

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}
