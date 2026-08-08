import { env } from "../config/env";
import { IClient, IClientAttachment } from "../models/client.model";
import { ARCHIVE_REASON_LABELS, ArchiveReason } from "../types/finance.types";
import { diffInDays, formatDateEs, formatMoney } from "../utils/date.util";
import {
  RenderedEmail,
  escapeHtml,
  renderCallout,
  renderKeyValueTable,
  renderLayout,
  renderParagraph,
  renderStatusPill,
} from "./baseLayout.template";

export interface ClientArchivedData {
  client: IClient;
  reason?: ArchiveReason | string | null;
  notes?: string;
}

function reasonLabel(reason?: ArchiveReason | string | null): string {
  if (!reason) return "Sin especificar";
  return ARCHIVE_REASON_LABELS[reason as ArchiveReason] || String(reason);
}

function durationLabel(days: number): string {
  const months = Math.floor(days / 30.44);
  if (months <= 0) return `${days} día(s)`;
  return `${days} día(s) · ${months} mes(es)`;
}

function renderAttachments(attachments: IClientAttachment[]): string {
  if (!attachments.length) return renderParagraph("No se adjuntaron respaldos de la baja.");

  const items = attachments
    .map(
      (file) =>
        `<li style="margin:0 0 6px;"><a href="${escapeHtml(file.url)}" target="_blank">${escapeHtml(
          file.name
        )}</a></li>`
    )
    .join("");

  return `<p style="margin:0 0 8px;font-family:system-ui,Arial,sans-serif;font-size:15px;color:#3f3a4a;"><strong>Respaldos adjuntos</strong></p>
    <ul style="margin:0 0 16px;padding-left:20px;font-family:system-ui,Arial,sans-serif;font-size:14px;line-height:1.6;color:#3f3a4a;">${items}</ul>`;
}

export function clientArchivedTemplate(data: ClientArchivedData): RenderedEmail {
  const { client } = data;

  const archivedAt = client.archivedAt || new Date();
  const reason = data.reason ?? client.archiveReason;
  const notes = data.notes ?? client.archiveNotes;
  const attachments = client.archiveAttachments || [];

  const days =
    typeof client.lifetimeDays === "number" && client.lifetimeDays !== null
      ? client.lifetimeDays
      : Math.max(diffInDays(client.startDate, archivedAt), 0);

  const revenue = client.lifetimeRevenue ?? 0;
  const monthlyLoss =
    client.splits?.length > 0
      ? client.splits.reduce((acc, split) => acc + (split.amount || 0), 0)
      : client.amount;

  const subject = `Baja de cliente · ${client.name}`;

  const rows = [
    { label: "Cliente", value: escapeHtml(client.name), strong: true },
    { label: "Motivo", value: escapeHtml(reasonLabel(reason)), strong: true },
    { label: "Fecha de alta", value: formatDateEs(client.startDate) },
    { label: "Fecha de baja", value: formatDateEs(archivedAt) },
    { label: "Duración", value: escapeHtml(durationLabel(days)), strong: true },
    { label: "Total cobrado histórico", value: formatMoney(revenue, client.currency) },
    {
      label: "Monto mensual que se pierde",
      value: formatMoney(monthlyLoss, client.currency),
      strong: true,
    },
    { label: "Contacto", value: escapeHtml(client.contactName || "—") },
    { label: "Correo del cliente", value: escapeHtml(client.contactEmail || "—") },
    {
      label: "Espacio de trabajo",
      value: escapeHtml(client.workspaceName || client.workspaceId || "Sin vincular"),
    },
  ];

  const bodyHtml = `
    ${renderParagraph(
      `Se dio de baja a <strong>${escapeHtml(client.name)}</strong> en el sistema de cobranzas. El cliente queda archivado: no se le generarán nuevas facturas ni se le enviarán recordatorios.`
    )}
    <div style="margin:8px 0 4px;">${renderStatusPill("Cliente dado de baja", env.brand.error)}</div>
    ${renderKeyValueTable(rows)}
    ${notes ? renderCallout(`<strong>Notas:</strong> ${escapeHtml(notes)}`, env.brand.warning) : ""}
    ${renderAttachments(attachments)}
  `;

  return {
    subject,
    html: renderLayout({
      title: "Baja de cliente",
      preheader: `${client.name} · ${reasonLabel(reason)} · ${formatMoney(monthlyLoss, client.currency)} mensuales`,
      bodyHtml,
      ctaLabel: "Ver el cliente",
      ctaUrl: `${env.appUrl}/clientes/${client._id.toString()}`,
    }),
  };
}
