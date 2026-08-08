import { env } from "../config/env";
import { formatDateEs, formatMoney, periodLabelEs } from "../utils/date.util";
import {
  RenderedEmail,
  escapeHtml,
  renderCallout,
  renderKeyValueTable,
  renderLayout,
  renderParagraph,
  renderStatusPill,
  renderTable,
} from "./baseLayout.template";

export interface MonthlySummaryOverdueRow {
  clientName: string;
  amount: number;
  dueDate: Date | null;
  daysOverdue: number;
}

export interface MonthlySummaryOverrideRow {
  clientName: string;
  reason: string;
  grantedByName: string;
  until?: Date | null;
  overdueAmount: number;
  maxDaysOverdue: number;
}

export interface MonthlySummaryData {
  period: string;
  expectedAmount: number;
  collectedAmount: number;
  pendingAmount: number;
  overdueAmount: number;
  collectionRate: number;
  invoicesTotal: number;
  invoicesPaid: number;
  invoicesPending: number;
  invoicesOverdue: number;
  clientsActive: number;
  workspacesDeactivated: number;
  overdueClients: MonthlySummaryOverdueRow[];
  /** Clientes cuyo espacio debería estar cerrado pero se abrió a propósito. */
  accessOverrides?: MonthlySummaryOverrideRow[];
}

export function monthlySummaryTemplate(data: MonthlySummaryData): RenderedEmail {
  const label = periodLabelEs(data.period);
  const rate = Math.round((data.collectionRate || 0) * 10) / 10;

  const pillColor =
    rate >= 90 ? env.brand.green : rate >= 70 ? env.brand.warning : env.brand.error;

  const subject = `Resumen mensual de cobranzas · ${label} · ${rate}% cobrado`;

  const rows = [
    { label: "Facturado", value: formatMoney(data.expectedAmount), strong: true },
    { label: "Cobrado", value: formatMoney(data.collectedAmount), strong: true },
    { label: "Pendiente", value: formatMoney(data.pendingAmount) },
    { label: "Vencido", value: formatMoney(data.overdueAmount), strong: true },
    { label: "% de cobranza", value: `${rate}%`, strong: true },
    { label: "Facturas emitidas", value: `${data.invoicesTotal}` },
    { label: "Facturas pagadas", value: `${data.invoicesPaid}` },
    { label: "Facturas pendientes", value: `${data.invoicesPending}` },
    { label: "Facturas vencidas", value: `${data.invoicesOverdue}` },
    { label: "Clientes activos", value: `${data.clientsActive}` },
    { label: "Workspaces desactivados", value: `${data.workspacesDeactivated}` },
  ];

  const overdueSection = data.overdueClients.length
    ? renderTable(
        ["Cliente", "Monto vencido", "Cobro", "Días de mora"],
        data.overdueClients.map((item) => [
          escapeHtml(item.clientName),
          formatMoney(item.amount),
          formatDateEs(item.dueDate),
          `${item.daysOverdue}`,
        ])
      )
    : renderCallout("No hay clientes en mora en este período. Excelente gestión.", env.brand.green);

  const overrides = data.accessOverrides || [];
  const overridesSection = overrides.length
    ? `
      <h2 style="margin:26px 0 6px;font-family:'Montserrat',system-ui,sans-serif;font-size:17px;color:${env.brand.error};">Abiertos por excepción</h2>
      ${renderCallout(
        `Estos espacios <strong>deberían estar cerrados</strong> por mora, pero se abrieron a propósito. Revisa si la excepción sigue teniendo sentido.`,
        env.brand.error
      )}
      ${renderTable(
        ["Cliente", "Adeudado", "Días de mora", "Autorizó", "Vence"],
        overrides.map((item) => [
          `${escapeHtml(item.clientName)}<br /><span style="font-size:12px;color:#8b8496;">${escapeHtml(
            item.reason
          )}</span>`,
          formatMoney(item.overdueAmount),
          `${item.maxDaysOverdue}`,
          escapeHtml(item.grantedByName),
          item.until ? formatDateEs(item.until) : "Indefinida",
        ])
      )}
    `
    : "";

  const bodyHtml = `
    ${renderParagraph(
      `Este es el resumen de cobranzas correspondiente a <strong>${escapeHtml(label)}</strong>.`
    )}
    <div style="margin:8px 0 4px;">${renderStatusPill(`${rate}% de cobranza`, pillColor)}</div>
    ${renderKeyValueTable(rows)}
    <h2 style="margin:26px 0 6px;font-family:'Montserrat',system-ui,sans-serif;font-size:17px;color:${env.brand.primaryDark};">Clientes en mora</h2>
    ${overdueSection}
    ${overridesSection}
  `;

  return {
    subject,
    html: renderLayout({
      title: `Resumen mensual · ${label}`,
      preheader: `Facturado ${formatMoney(data.expectedAmount)} · Cobrado ${formatMoney(data.collectedAmount)} · ${rate}%`,
      bodyHtml,
      ctaLabel: "Abrir el dashboard",
      ctaUrl: `${env.appUrl}/dashboard`,
      footerNote: `Generado automáticamente el ${formatDateEs(new Date())}.`,
    }),
  };
}
