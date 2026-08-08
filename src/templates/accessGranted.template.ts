import { env } from "../config/env";
import { IClient } from "../models";
import { formatDateEs, formatMoney } from "../utils/date.util";
import {
  RenderedEmail,
  escapeHtml,
  renderCallout,
  renderKeyValueTable,
  renderLayout,
  renderParagraph,
  renderStatusPill,
} from "./baseLayout.template";

export interface AccessGrantedData {
  client: IClient;
  reason: string;
  until?: Date | null;
  overdueAmount: number;
  daysOverdue: number;
  grantedByName: string;
}

export function accessGrantedTemplate(data: AccessGrantedData): RenderedEmail {
  const { client, reason, until, overdueAmount, daysOverdue, grantedByName } = data;

  const vigencia = until
    ? `hasta el ${formatDateEs(until)}`
    : "por tiempo indefinido (hay que revocarla a mano)";

  const subject = `Acceso abierto por excepción · ${client.name}`;

  const rows = [
    { label: "Cliente", value: escapeHtml(client.name), strong: true },
    {
      label: "Espacio de trabajo",
      value: escapeHtml(client.workspaceName || client.workspaceId || "—"),
      strong: true,
    },
    { label: "ID del workspace", value: escapeHtml(client.workspaceId || "—") },
    {
      label: "Monto adeudado",
      value: formatMoney(overdueAmount, client.currency),
      strong: true,
    },
    { label: "Días de mora", value: `${daysOverdue}`, strong: true },
    { label: "Motivo de la excepción", value: escapeHtml(reason) },
    { label: "Autorizado por", value: escapeHtml(grantedByName), strong: true },
    { label: "Abierto el", value: formatDateEs(new Date()) },
    { label: "Vigencia", value: until ? formatDateEs(until) : "Indefinida", strong: true },
    { label: "Contacto", value: escapeHtml(client.contactName || "—") },
    { label: "Correo del cliente", value: escapeHtml(client.contactEmail || "—") },
  ];

  const bodyHtml = `
    ${renderParagraph(
      `El espacio de trabajo de <strong>${escapeHtml(
        client.name
      )}</strong> <strong>DEBERÍA ESTAR CERRADO</strong> por mora, pero se abrió <strong>a propósito</strong> como excepción autorizada.`
    )}
    <div style="margin:8px 0 4px;">${renderStatusPill(
      "Debería estar cerrado · abierto por excepción",
      env.brand.error
    )}</div>
    ${renderKeyValueTable(rows)}
    ${renderCallout(
      `Este cliente adeuda <strong>${formatMoney(
        overdueAmount,
        client.currency
      )}</strong> con <strong>${daysOverdue} día(s)</strong> de mora. La excepción está vigente <strong>${escapeHtml(
        vigencia
      )}</strong>: mientras dure, el proceso diario de cobranzas <strong>no</strong> volverá a cerrar el espacio.`,
      env.brand.error
    )}
    ${renderParagraph(
      until
        ? `Al vencer la excepción, el ${escapeHtml(
            formatDateEs(until)
          )}, el sistema cerrará el espacio automáticamente si el cliente sigue en mora.`
        : "Al no tener fecha de vencimiento, el espacio seguirá abierto hasta que alguien revoque la excepción desde el panel."
    )}
  `;

  return {
    subject,
    html: renderLayout({
      title: "Acceso abierto por excepción",
      preheader: `${client.name} · ${formatMoney(
        overdueAmount,
        client.currency
      )} adeudados · ${daysOverdue} días de mora · autorizó ${grantedByName}`,
      bodyHtml,
      ctaLabel: "Ver cliente en el panel",
      ctaUrl: `${env.appUrl}/clientes/${client._id.toString()}`,
      footerNote: "Excepción registrada manualmente desde el panel de finanzas.",
    }),
  };
}
