import { env } from "../config/env";
import { IPaymentSubmission } from "../models";
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

export interface PaymentSubmissionReceivedData {
  submission: IPaymentSubmission;
}

/** Aviso a la empresa: un cliente subió un comprobante y espera verificación. */
export function paymentSubmissionReceivedTemplate(
  data: PaymentSubmissionReceivedData
): RenderedEmail {
  const { submission } = data;

  const subject = `Comprobante por verificar · ${submission.clientName} · ${formatMoney(
    submission.netAmount,
    submission.currency
  )}`;

  const rows = [
    { label: "Cliente", value: escapeHtml(submission.clientName), strong: true },
    { label: "Monto enviado", value: formatMoney(submission.grossAmount, submission.currency) },
    { label: "Fee bancario", value: formatMoney(submission.feeAmount, submission.currency) },
    {
      label: "Neto a acreditar",
      value: formatMoney(submission.netAmount, submission.currency),
      strong: true,
    },
    { label: "Subido por", value: escapeHtml(submission.submittedByName || "Cliente") },
    { label: "Fecha de subida", value: formatDateEs(submission.createdAt) },
    { label: "Límite de revisión (48h laborables)", value: formatDateEs(submission.reviewDueAt) },
  ];

  const bodyHtml = `
    ${renderParagraph(
      `Un cliente subió un <strong>comprobante de transferencia</strong> desde el portal y quedó <strong>en verificación</strong>.`
    )}
    <div style="margin:8px 0 4px;">${renderStatusPill("En verificación", env.brand.warning)}</div>
    ${renderKeyValueTable(rows)}
    ${renderParagraph(
      `Comprobante: <a href="${escapeHtml(submission.receiptUrl)}" target="_blank">ver archivo</a>.`
    )}
    ${renderCallout(
      `El compromiso con el cliente es responder en <strong>48 horas laborables</strong>. Sus sistemas siguen igual hasta que alguien apruebe o rechace este comprobante.`,
      env.brand.warning
    )}
  `;

  return {
    subject,
    html: renderLayout({
      title: "Comprobante por verificar",
      preheader: `${submission.clientName} · ${formatMoney(submission.netAmount, submission.currency)}`,
      bodyHtml,
      ctaLabel: "Revisar en el panel",
      ctaUrl: `${env.appUrl}/comprobantes`,
    }),
  };
}
