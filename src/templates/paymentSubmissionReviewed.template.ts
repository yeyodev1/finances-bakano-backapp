import { env } from "../config/env";
import { IPaymentSubmission } from "../models";
import { formatDateEs, formatMoney } from "../utils/date.util";
import {
  RenderedEmail,
  escapeHtml,
  renderKeyValueTable,
  renderLayout,
  renderParagraph,
  renderStatusPill,
} from "./baseLayout.template";

export interface PaymentSubmissionReviewedData {
  submission: IPaymentSubmission;
}

/** Aviso a la empresa: un comprobante fue aprobado (ya es Payment) o rechazado. */
export function paymentSubmissionReviewedTemplate(
  data: PaymentSubmissionReviewedData
): RenderedEmail {
  const { submission } = data;
  const approved = submission.status === "approved";

  const subject = approved
    ? `Comprobante aprobado · ${submission.clientName} · ${formatMoney(submission.netAmount, submission.currency)}`
    : `Comprobante rechazado · ${submission.clientName}`;

  const rows = [
    { label: "Cliente", value: escapeHtml(submission.clientName), strong: true },
    { label: "Monto enviado", value: formatMoney(submission.grossAmount, submission.currency) },
    { label: "Fee bancario", value: formatMoney(submission.feeAmount, submission.currency) },
    {
      label: "Neto acreditado",
      value: formatMoney(submission.netAmount, submission.currency),
      strong: true,
    },
    { label: "Revisado por", value: escapeHtml(submission.reviewedByName || "—") },
    { label: "Fecha de revisión", value: formatDateEs(submission.reviewedAt || new Date()) },
    { label: "Nota", value: escapeHtml(submission.reviewNote || "—") },
  ];

  const bodyHtml = `
    ${renderParagraph(
      approved
        ? `El comprobante de <strong>${escapeHtml(submission.clientName)}</strong> fue <strong>aprobado</strong> y el pago quedó registrado por el neto recibido.`
        : `El comprobante de <strong>${escapeHtml(submission.clientName)}</strong> fue <strong>rechazado</strong>. El cliente lo ve reflejado en su portal.`
    )}
    <div style="margin:8px 0 4px;">${renderStatusPill(
      approved ? "Aprobado" : "Rechazado",
      approved ? env.brand.green : env.brand.error
    )}</div>
    ${renderKeyValueTable(rows)}
    ${renderParagraph(
      `Comprobante: <a href="${escapeHtml(submission.receiptUrl)}" target="_blank">ver archivo</a>.`
    )}
  `;

  return {
    subject,
    html: renderLayout({
      title: approved ? "Comprobante aprobado" : "Comprobante rechazado",
      preheader: `${submission.clientName} · ${approved ? "aprobado" : "rechazado"}`,
      bodyHtml,
      ctaLabel: "Ver en el panel",
      ctaUrl: `${env.appUrl}/comprobantes`,
    }),
  };
}
