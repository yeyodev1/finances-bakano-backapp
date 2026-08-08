import { env } from "../config/env";
import { IClient, IInvoice } from "../models";
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

export interface PaymentDeferredData {
  invoice: IInvoice;
  client?: IClient | null;
  previousDueDate: Date;
  newDueDate: Date;
  reason?: string;
}

export function paymentDeferredTemplate(data: PaymentDeferredData): RenderedEmail {
  const { invoice, client, previousDueDate, newDueDate, reason } = data;

  const clientName = client?.name || invoice.clientName;
  const pending = Math.max(invoice.amount - invoice.paidAmount, 0);
  const last = invoice.deferrals?.[invoice.deferrals.length - 1];
  const agreedByName = last?.agreedByName || "Sistema";
  const deferralCount = invoice.deferrals?.length || 1;

  const subject = `Acuerdo de pago · ${clientName} · nueva fecha ${formatDateEs(newDueDate)}`;

  const rows = [
    { label: "Cliente", value: escapeHtml(clientName), strong: true },
    { label: "Período", value: escapeHtml(periodLabelEs(invoice.period)) },
    { label: "Monto de la factura", value: formatMoney(invoice.amount, invoice.currency) },
    { label: "Saldo pendiente", value: formatMoney(pending, invoice.currency), strong: true },
    { label: "Fecha original", value: formatDateEs(invoice.originalDueDate || previousDueDate) },
    { label: "Fecha anterior", value: formatDateEs(previousDueDate) },
    { label: "Nueva fecha acordada", value: formatDateEs(newDueDate), strong: true },
    { label: "Motivo", value: escapeHtml(reason || last?.reason || "—") },
    { label: "Notas", value: escapeHtml(last?.notes || "—") },
    { label: "Registrado por", value: escapeHtml(agreedByName) },
    { label: "Prórrogas acumuladas", value: `${deferralCount}` },
  ];

  const bodyHtml = `
    ${renderParagraph(
      `Se registró un <strong>acuerdo de pago</strong> con <strong>${escapeHtml(clientName)}</strong>: el cobro de este período se mueve a una fecha posterior.`
    )}
    <div style="margin:8px 0 4px;">${renderStatusPill("Prórroga", env.brand.secondary)}</div>
    ${renderKeyValueTable(rows)}
    ${renderCallout(
      `El día de cobro habitual del cliente <strong>no cambia</strong>. Esta prórroga afecta únicamente a la factura de ${escapeHtml(
        periodLabelEs(invoice.period)
      )}; el período siguiente vuelve a su fecha de siempre. La mora y los avisos automáticos se calcularán desde el <strong>${formatDateEs(
        newDueDate
      )}</strong>.`,
      env.brand.secondary
    )}
  `;

  return {
    subject,
    html: renderLayout({
      title: "Acuerdo de pago registrado",
      preheader: `${clientName} · nueva fecha ${formatDateEs(newDueDate)} · ${formatMoney(pending, invoice.currency)}`,
      bodyHtml,
      ctaLabel: "Revisar factura",
      ctaUrl: `${env.appUrl}/facturas/${invoice._id.toString()}`,
    }),
  };
}
