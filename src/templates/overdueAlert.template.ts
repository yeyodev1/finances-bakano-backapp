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

export interface OverdueAlertData {
  invoice: IInvoice;
  client?: IClient | null;
  daysOverdue: number;
  /** Si viene, el correo se envía como aviso previo a la desactivación del workspace. */
  deactivationInDays?: number | null;
}

export function overdueAlertTemplate(data: OverdueAlertData): RenderedEmail {
  const { invoice, client, daysOverdue, deactivationInDays } = data;

  const clientName = client?.name || invoice.clientName;
  const pending = Math.max(invoice.amount - invoice.paidAmount, 0);
  const isWarning = typeof deactivationInDays === "number";
  const lastDeferral = invoice.deferrals?.[invoice.deferrals.length - 1];

  const subject = isWarning
    ? `Aviso previo de desactivación · ${clientName} · ${daysOverdue} días de mora`
    : `Factura vencida · ${clientName} · ${daysOverdue} días de mora`;

  const rows = [
    { label: "Cliente", value: escapeHtml(clientName), strong: true },
    { label: "Período", value: escapeHtml(periodLabelEs(invoice.period)) },
    { label: "Fecha de cobro", value: formatDateEs(invoice.dueDate) },
    ...(lastDeferral
      ? [
          {
            label: "Vencimiento prorrogado",
            value: `${formatDateEs(lastDeferral.previousDueDate)} → ${formatDateEs(lastDeferral.newDueDate)}`,
            strong: true,
          },
          { label: "Motivo del acuerdo", value: escapeHtml(lastDeferral.reason || "—") },
        ]
      : []),
    { label: "Días de mora", value: `${daysOverdue}`, strong: true },
    { label: "Monto de la factura", value: formatMoney(invoice.amount, invoice.currency) },
    { label: "Pagado", value: formatMoney(invoice.paidAmount, invoice.currency) },
    { label: "Saldo vencido", value: formatMoney(pending, invoice.currency), strong: true },
    { label: "Contacto", value: escapeHtml(client?.contactName || "—") },
    { label: "Correo del cliente", value: escapeHtml(client?.contactEmail || "—") },
    { label: "Teléfono", value: escapeHtml(client?.contactPhone || "—") },
    {
      label: "Espacio de trabajo",
      value: escapeHtml(client?.workspaceName || client?.workspaceId || "Sin vincular"),
    },
  ];

  const callout = isWarning
    ? renderCallout(
        `<strong>Atención:</strong> si no se registra el pago en los próximos <strong>${deactivationInDays} día(s)</strong>, el espacio de trabajo de <strong>${escapeHtml(
          clientName
        )}</strong> se desactivará automáticamente en la plataforma de métricas.`,
        env.brand.error
      )
    : renderCallout(
        `La factura lleva <strong>${daysOverdue} día(s)</strong> vencida. Gestiona el cobro o registra el pago para detener las alertas automáticas.`,
        env.brand.error
      );

  const bodyHtml = `
    ${renderParagraph(
      isWarning
        ? `El cobro de <strong>${escapeHtml(clientName)}</strong> sigue pendiente y está por cumplirse el plazo de gracia.`
        : `El cobro de <strong>${escapeHtml(clientName)}</strong> se encuentra <strong>vencido</strong>.`
    )}
    <div style="margin:8px 0 4px;">${renderStatusPill(
      isWarning ? "Aviso previo" : "Vencida",
      env.brand.error
    )}</div>
    ${renderKeyValueTable(rows)}
    ${
      lastDeferral
        ? renderCallout(
            `Esta factura tiene un <strong>acuerdo de pago vigente</strong>: el vencimiento se prorrogó del <strong>${formatDateEs(
              lastDeferral.previousDueDate
            )}</strong> al <strong>${formatDateEs(
              lastDeferral.newDueDate
            )}</strong>. La mora se cuenta desde la fecha acordada.`,
            env.brand.secondary
          )
        : ""
    }
    ${callout}
    ${invoice.notes ? renderParagraph(`Notas de la factura: ${escapeHtml(invoice.notes)}`) : ""}
  `;

  return {
    subject,
    html: renderLayout({
      title: isWarning ? "Aviso previo de desactivación" : "Factura vencida",
      preheader: `${clientName} · ${formatMoney(pending, invoice.currency)} · ${daysOverdue} días de mora`,
      bodyHtml,
      ctaLabel: "Revisar factura",
      ctaUrl: `${env.appUrl}/facturas/${invoice._id.toString()}`,
    }),
  };
}
