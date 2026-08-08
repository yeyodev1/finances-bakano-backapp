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
  otro: "Otro",
};

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

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}
