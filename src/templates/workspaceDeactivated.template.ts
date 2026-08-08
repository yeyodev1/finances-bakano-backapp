import { env } from "../config/env";
import { IClient, IInvoice } from "../models";
import { diffInDays, formatDateEs, formatMoney, periodLabelEs } from "../utils/date.util";
import {
  RenderedEmail,
  escapeHtml,
  renderCallout,
  renderKeyValueTable,
  renderLayout,
  renderParagraph,
  renderStatusPill,
} from "./baseLayout.template";

export interface WorkspaceDeactivatedData {
  client: IClient;
  invoice?: IInvoice | null;
  reason?: string;
}

export function workspaceDeactivatedTemplate(data: WorkspaceDeactivatedData): RenderedEmail {
  const { client, invoice, reason } = data;

  const pending = invoice ? Math.max(invoice.amount - invoice.paidAmount, 0) : client.amount;
  const daysOverdue = invoice ? Math.max(diffInDays(invoice.dueDate, new Date()), 0) : 0;
  const period = invoice ? periodLabelEs(invoice.period) : "—";

  const subject = `Espacio de trabajo DESACTIVADO · ${client.name} · ${daysOverdue} días de mora`;

  const rows = [
    { label: "Cliente", value: escapeHtml(client.name), strong: true },
    {
      label: "Espacio de trabajo",
      value: escapeHtml(client.workspaceName || client.workspaceId || "—"),
      strong: true,
    },
    { label: "ID del workspace", value: escapeHtml(client.workspaceId || "—") },
    { label: "Período impago", value: escapeHtml(period) },
    { label: "Monto adeudado", value: formatMoney(pending, client.currency), strong: true },
    { label: "Fecha de cobro", value: invoice ? formatDateEs(invoice.dueDate) : "—" },
    { label: "Días de mora", value: `${daysOverdue}`, strong: true },
    { label: "Desactivado el", value: formatDateEs(new Date()) },
    { label: "Motivo", value: escapeHtml(reason || "Falta de pago") },
    { label: "Contacto", value: escapeHtml(client.contactName || "—") },
    { label: "Correo del cliente", value: escapeHtml(client.contactEmail || "—") },
  ];

  const bodyHtml = `
    ${renderParagraph(
      `El espacio de trabajo del cliente <strong>${escapeHtml(
        client.name
      )}</strong> quedó <strong>DESACTIVADO</strong> en la plataforma de métricas de Bakano por <strong>falta de pago</strong>.`
    )}
    <div style="margin:8px 0 4px;">${renderStatusPill("Workspace desactivado", env.brand.error)}</div>
    ${renderKeyValueTable(rows)}
    ${renderCallout(
      `Se adeudan <strong>${formatMoney(pending, client.currency)}</strong> del período <strong>${escapeHtml(
        period
      )}</strong>, con <strong>${daysOverdue} día(s)</strong> de mora acumulados. El cliente ya no puede acceder a sus métricas hasta que se registre el pago.`,
      env.brand.error
    )}
    ${renderParagraph(
      "Al registrar el pago en el panel se podrá reactivar el espacio de trabajo desde la sección de Workspaces."
    )}
  `;

  return {
    subject,
    html: renderLayout({
      title: "Espacio de trabajo desactivado por falta de pago",
      preheader: `${client.name} · ${formatMoney(pending, client.currency)} adeudados · ${daysOverdue} días de mora`,
      bodyHtml,
      ctaLabel: "Ver cliente en el panel",
      ctaUrl: `${env.appUrl}/clientes/${client._id.toString()}`,
      footerNote: "Acción ejecutada automáticamente por el proceso diario de cobranzas.",
    }),
  };
}
