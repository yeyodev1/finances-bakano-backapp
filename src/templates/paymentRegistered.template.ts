import { env } from "../config/env";
import { IClient, IInvoice, IPayment } from "../models";
import { PAYMENT_METHOD_LABELS, INVOICE_STATUS_LABELS } from "../types/finance.types";
import { formatDateEs, formatMoney, periodLabelEs } from "../utils/date.util";
import {
  RenderedEmail,
  escapeHtml,
  renderCallout,
  renderKeyValueTable,
  renderLayout,
  renderParagraph,
  renderStatusPill,
} from "./baseLayout.template";

export interface PaymentRegisteredData {
  invoice: IInvoice;
  payment: IPayment;
  client?: IClient | null;
}

export function paymentRegisteredTemplate(data: PaymentRegisteredData): RenderedEmail {
  const { invoice, payment, client } = data;

  const clientName = client?.name || invoice.clientName;
  const pending = Math.max(invoice.amount - invoice.paidAmount, 0);
  const isPaid = invoice.status === "paid";
  const isAdvance = Boolean(invoice.isAdvance);
  const pillColor = isPaid ? env.brand.green : env.brand.warning;
  const periodLabel = periodLabelEs(invoice.period);

  const subject = isAdvance
    ? `Cobro anticipado registrado · ${clientName} · ${periodLabel} · ${formatMoney(payment.amount, payment.currency)}`
    : `Pago registrado · ${clientName} · ${formatMoney(payment.amount, payment.currency)}`;

  const rows = [
    { label: "Cliente", value: escapeHtml(clientName), strong: true },
    { label: "Período", value: escapeHtml(periodLabelEs(invoice.period)) },
    { label: "Monto del pago", value: formatMoney(payment.amount, payment.currency), strong: true },
    { label: "Fecha de pago", value: formatDateEs(payment.paidAt) },
    { label: "Método", value: escapeHtml(PAYMENT_METHOD_LABELS[payment.method] || payment.method) },
    { label: "Referencia", value: escapeHtml(payment.reference || "—") },
    { label: "Total de la factura", value: formatMoney(invoice.amount, invoice.currency) },
    { label: "Acumulado pagado", value: formatMoney(invoice.paidAmount, invoice.currency) },
    { label: "Saldo pendiente", value: formatMoney(pending, invoice.currency), strong: !isPaid },
    { label: "Registrado por", value: escapeHtml(payment.registeredByName || "Sistema") },
  ];

  const receipt = payment.receiptUrl
    ? renderParagraph(
        `Comprobante adjunto: <a href="${escapeHtml(payment.receiptUrl)}" target="_blank">ver comprobante</a>.`
      )
    : "";

  const closing = isPaid
    ? renderParagraph(
        `La factura de <strong>${escapeHtml(clientName)}</strong> quedó <strong>totalmente cancelada</strong>. No se enviarán más recordatorios por este período.`
      )
    : renderParagraph(
        `Aún queda un saldo pendiente de <strong>${formatMoney(pending, invoice.currency)}</strong>. Se seguirán enviando los recordatorios configurados hasta completar el cobro.`
      );

  const advanceNote = isAdvance
    ? renderCallout(
        `Es un <strong>cobro anticipado</strong> del período <strong>${escapeHtml(periodLabel)}</strong>: el cliente paga antes de que arranque el período que cubre. El vencimiento acordado es el <strong>${formatDateEs(invoice.dueDate)}</strong>.`,
        env.brand.secondary
      )
    : "";

  const bodyHtml = `
    ${renderParagraph(
      isAdvance
        ? `Se registró un <strong>cobro anticipado</strong> en el sistema de cobranzas de <strong>${escapeHtml(env.brand.appName)}</strong>.`
        : `Se registró un nuevo pago en el sistema de cobranzas de <strong>${escapeHtml(env.brand.appName)}</strong>.`
    )}
    <div style="margin:8px 0 4px;">${renderStatusPill(
      isAdvance
        ? "Cobro anticipado"
        : INVOICE_STATUS_LABELS[invoice.status] || invoice.status,
      isAdvance ? env.brand.secondary : pillColor
    )}</div>
    ${advanceNote}
    ${renderKeyValueTable(rows)}
    ${receipt}
    ${closing}
  `;

  return {
    subject,
    html: renderLayout({
      title: isAdvance ? "Cobro anticipado registrado" : "Pago registrado",
      preheader: `${clientName} · ${formatMoney(payment.amount, payment.currency)} · ${periodLabel}`,
      bodyHtml,
      ctaLabel: "Ver en el panel",
      ctaUrl: `${env.appUrl}/facturas/${invoice._id.toString()}`,
    }),
  };
}
