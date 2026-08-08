import { env } from "../config/env";
import { IClient } from "../models";
import { formatDateEs } from "../utils/date.util";
import {
  RenderedEmail,
  escapeHtml,
  renderCallout,
  renderKeyValueTable,
  renderLayout,
  renderParagraph,
  renderStatusPill,
} from "./baseLayout.template";

export interface AccessRevokedData {
  client: IClient;
  closedWorkspace: boolean;
}

export function accessRevokedTemplate(data: AccessRevokedData): RenderedEmail {
  const { client, closedWorkspace } = data;
  const override = client.accessOverride || { enabled: false };

  const subject = `Excepción de acceso revocada · ${client.name}`;

  const rows = [
    { label: "Cliente", value: escapeHtml(client.name), strong: true },
    {
      label: "Espacio de trabajo",
      value: escapeHtml(client.workspaceName || client.workspaceId || "—"),
      strong: true,
    },
    { label: "Motivo original de la excepción", value: escapeHtml(override.reason || "—") },
    { label: "La había autorizado", value: escapeHtml(override.grantedByName || "—") },
    { label: "Revocada por", value: escapeHtml(override.revokedByName || "—"), strong: true },
    { label: "Revocada el", value: formatDateEs(new Date()) },
    {
      label: "Espacio de trabajo",
      value: closedWorkspace ? "Cerrado" : "Sigue abierto",
      strong: true,
    },
  ];

  const bodyHtml = `
    ${renderParagraph(
      `Se revocó la excepción de acceso de <strong>${escapeHtml(client.name)}</strong>.`
    )}
    <div style="margin:8px 0 4px;">${renderStatusPill(
      closedWorkspace ? "Espacio cerrado" : "Excepción revocada",
      closedWorkspace ? env.brand.error : env.brand.warning
    )}</div>
    ${renderKeyValueTable(rows)}
    ${renderCallout(
      closedWorkspace
        ? "El cliente seguía en mora, así que además de apagar la excepción se cerró su espacio de trabajo en la plataforma de métricas."
        : "El espacio de trabajo se dejó como estaba: o el cliente ya no tiene facturas vencidas, o se pidió expresamente no cerrarlo.",
      closedWorkspace ? env.brand.error : env.brand.green
    )}
  `;

  return {
    subject,
    html: renderLayout({
      title: "Excepción de acceso revocada",
      preheader: `${client.name} · ${closedWorkspace ? "espacio cerrado" : "espacio sigue abierto"}`,
      bodyHtml,
      ctaLabel: "Ver cliente en el panel",
      ctaUrl: `${env.appUrl}/clientes/${client._id.toString()}`,
      footerNote: "Acción registrada desde el panel de finanzas.",
    }),
  };
}
