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

export interface WorkspaceReactivatedData {
  client: IClient;
  invoice?: IInvoice | null;
}

export function workspaceReactivatedTemplate(data: WorkspaceReactivatedData): RenderedEmail {
  const { client, invoice } = data;

  const subject = `Espacio de trabajo reactivado · ${client.name}`;

  const rows = [
    { label: "Cliente", value: escapeHtml(client.name), strong: true },
    {
      label: "Espacio de trabajo",
      value: escapeHtml(client.workspaceName || client.workspaceId || "—"),
      strong: true,
    },
    { label: "ID del workspace", value: escapeHtml(client.workspaceId || "—") },
    { label: "Reactivado el", value: formatDateEs(new Date()) },
  ];

  if (invoice) {
    rows.push(
      { label: "Período regularizado", value: escapeHtml(periodLabelEs(invoice.period)) },
      { label: "Monto de la factura", value: formatMoney(invoice.amount, invoice.currency) },
      { label: "Pagado", value: formatMoney(invoice.paidAmount, invoice.currency), strong: true }
    );
  }

  const bodyHtml = `
    ${renderParagraph(
      `El espacio de trabajo de <strong>${escapeHtml(
        client.name
      )}</strong> volvió a estar <strong>ACTIVO</strong> en la plataforma de métricas de Bakano.`
    )}
    <div style="margin:8px 0 4px;">${renderStatusPill("Workspace activo", env.brand.green)}</div>
    ${renderKeyValueTable(rows)}
    ${renderCallout(
      "El cliente ya puede acceder nuevamente a sus métricas y reportes sin restricciones.",
      env.brand.green
    )}
  `;

  return {
    subject,
    html: renderLayout({
      title: "Espacio de trabajo reactivado",
      preheader: `${client.name} · acceso restablecido en la plataforma de métricas`,
      bodyHtml,
      ctaLabel: "Ver cliente en el panel",
      ctaUrl: `${env.appUrl}/clientes/${client._id.toString()}`,
    }),
  };
}
