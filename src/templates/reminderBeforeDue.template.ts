import { env } from "../config/env";
import { IClient, IInvoice } from "../models";
import { PAYMENT_METHOD_LABELS } from "../types/finance.types";
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

export interface ReminderBeforeDueData {
  invoice: IInvoice;
  client?: IClient | null;
  daysBefore: number;
}

export function reminderBeforeDueTemplate(data: ReminderBeforeDueData): RenderedEmail {
  const { invoice, client, daysBefore } = data;

  const clientName = client?.name || invoice.clientName;
  const pending = Math.max(invoice.amount - invoice.paidAmount, 0);
  const plazo =
    daysBefore === 0
      ? "hoy"
      : daysBefore === 1
        ? "mañana"
        : `en ${daysBefore} días`;

  const subject = `Recordatorio de cobro · ${clientName} · vence ${plazo}`;

  const rows = [
    { label: "Cliente", value: escapeHtml(clientName), strong: true },
    { label: "Período", value: escapeHtml(periodLabelEs(invoice.period)) },
    { label: "Fecha de cobro", value: formatDateEs(invoice.dueDate), strong: true },
    { label: "Monto de la factura", value: formatMoney(invoice.amount, invoice.currency) },
    { label: "Pagado hasta ahora", value: formatMoney(invoice.paidAmount, invoice.currency) },
    { label: "Saldo a cobrar", value: formatMoney(pending, invoice.currency), strong: true },
    {
      label: "Método acordado",
      value: escapeHtml(
        client?.paymentMethod ? PAYMENT_METHOD_LABELS[client.paymentMethod] : "Transferencia"
      ),
    },
    { label: "Contacto", value: escapeHtml(client?.contactName || "—") },
    { label: "Correo del cliente", value: escapeHtml(client?.contactEmail || "—") },
    { label: "Teléfono", value: escapeHtml(client?.contactPhone || "—") },
  ];

  const bodyHtml = `
    ${renderParagraph(
      `Este es un recordatorio de que el cobro de <strong>${escapeHtml(clientName)}</strong> vence <strong>${plazo}</strong>.`
    )}
    <div style="margin:8px 0 4px;">${renderStatusPill("Por cobrar", env.brand.secondary)}</div>
    ${renderKeyValueTable(rows)}
    ${renderCallout(
      `Coordina la gestión de cobro antes del <strong>${formatDateEs(invoice.dueDate)}</strong> para evitar que la factura entre en mora.`,
      env.brand.secondary
    )}
    ${
      client?.collectionDayLabel
        ? renderParagraph(
            `Nota de cobro del cliente: <strong>${escapeHtml(client.collectionDayLabel)}</strong>.`
          )
        : ""
    }
  `;

  return {
    subject,
    html: renderLayout({
      title: "Recordatorio de cobro próximo",
      preheader: `${clientName} · ${formatMoney(pending, invoice.currency)} · vence ${formatDateEs(invoice.dueDate)}`,
      bodyHtml,
      ctaLabel: "Gestionar cobro",
      ctaUrl: `${env.appUrl}/facturas/${invoice._id.toString()}`,
    }),
  };
}
