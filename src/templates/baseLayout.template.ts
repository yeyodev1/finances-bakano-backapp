import { env } from "../config/env";

export interface LayoutOptions {
  title: string;
  preheader: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
}

export interface KeyValueRow {
  label: string;
  value: string;
  strong?: boolean;
}

const FONT_STACK =
  "'Montserrat', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderStatusPill(label: string, color: string): string {
  return `<span style="display:inline-block;padding:6px 14px;border-radius:999px;background-color:${color};color:#ffffff;font-family:${FONT_STACK};font-size:12px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;">${escapeHtml(
    label
  )}</span>`;
}

export function renderKeyValueTable(rows: KeyValueRow[]): string {
  const body = rows
    .map((row, index) => {
      const bg = index % 2 === 0 ? "#ffffff" : "#faf8f5";
      const weight = row.strong ? "700" : "500";
      const valueColor = row.strong ? env.brand.primaryDark : "#3f3a4a";
      return `<tr>
        <td style="padding:11px 14px;background-color:${bg};border-bottom:1px solid #eeeaf2;font-family:${FONT_STACK};font-size:13px;color:#6b6478;">${escapeHtml(
          row.label
        )}</td>
        <td style="padding:11px 14px;background-color:${bg};border-bottom:1px solid #eeeaf2;font-family:${FONT_STACK};font-size:14px;font-weight:${weight};color:${valueColor};text-align:right;">${row.value}</td>
      </tr>`;
    })
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border:1px solid #eeeaf2;border-radius:10px;overflow:hidden;margin:18px 0;">
    <tbody>${body}</tbody>
  </table>`;
}

export function renderTable(headers: string[], rows: string[][]): string {
  const head = headers
    .map(
      (h, i) =>
        `<th style="padding:10px 12px;background-color:${env.brand.primaryDark};color:#ffffff;font-family:${FONT_STACK};font-size:12px;font-weight:700;text-align:${
          i === 0 ? "left" : "right"
        };text-transform:uppercase;letter-spacing:0.3px;">${escapeHtml(h)}</th>`
    )
    .join("");

  const body = rows
    .map((cells, rowIndex) => {
      const bg = rowIndex % 2 === 0 ? "#ffffff" : "#faf8f5";
      const tds = cells
        .map(
          (cell, i) =>
            `<td style="padding:10px 12px;background-color:${bg};border-bottom:1px solid #eeeaf2;font-family:${FONT_STACK};font-size:13px;color:#3f3a4a;text-align:${
              i === 0 ? "left" : "right"
            };">${cell}</td>`
        )
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border:1px solid #eeeaf2;border-radius:10px;overflow:hidden;margin:18px 0;">
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

export function renderParagraph(text: string): string {
  return `<p style="margin:0 0 14px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:#3f3a4a;">${text}</p>`;
}

export function renderCallout(text: string, color = env.brand.warning): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:18px 0;">
    <tr>
      <td style="padding:14px 16px;background-color:#fdf7ef;border-left:4px solid ${color};border-radius:6px;font-family:${FONT_STACK};font-size:14px;line-height:1.6;color:#3f3a4a;">${text}</td>
    </tr>
  </table>`;
}

export function renderLayout(options: LayoutOptions): string {
  const { title, preheader, bodyHtml, ctaLabel, ctaUrl, footerNote } = options;

  const cta =
    ctaLabel && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 6px;">
          <tr>
            <td align="center" style="border-radius:8px;background-color:${env.brand.primary};">
              <a href="${escapeHtml(ctaUrl)}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${FONT_STACK};font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(
                ctaLabel
              )}</a>
            </td>
          </tr>
        </table>`
      : "";

  const note = footerNote
    ? `<p style="margin:14px 0 0;font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:#8b8496;">${footerNote}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${escapeHtml(title)}</title>
<style>
  body { margin:0; padding:0; background-color:${env.brand.primaryLight}; -webkit-font-smoothing:antialiased; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  table { border-collapse:collapse !important; }
  a { color:${env.brand.primary}; }
  @media only screen and (max-width:620px) {
    .wrapper { width:100% !important; }
    .px { padding-left:20px !important; padding-right:20px !important; }
    .h1 { font-size:20px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${env.brand.primaryLight};">
<div style="display:none;font-size:1px;color:${env.brand.primaryLight};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(
    preheader
  )}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:${env.brand.primaryLight};">
  <tr>
    <td align="center" style="padding:28px 12px;">
      <table role="presentation" class="wrapper" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(25,20,35,0.06);">
        <tr>
          <td style="height:6px;background-color:${env.brand.primary};line-height:6px;font-size:0;">&nbsp;</td>
        </tr>
        <tr>
          <td class="px" style="padding:26px 36px 6px;background-color:#ffffff;">
            <img src="${escapeHtml(env.brand.logoUrl)}" alt="${escapeHtml(
              env.brand.appName
            )}" width="150" style="width:150px;max-width:60%;height:auto;display:block;" />
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:12px 36px 4px;background-color:#ffffff;">
            <h1 class="h1" style="margin:0 0 6px;font-family:${FONT_STACK};font-size:23px;line-height:1.3;font-weight:700;color:${env.brand.primaryDark};">${escapeHtml(
              title
            )}</h1>
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:10px 36px 30px;background-color:#ffffff;">
            ${bodyHtml}
            ${cta}
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:22px 36px 26px;background-color:${env.brand.primaryDark};">
            <p style="margin:0;font-family:${FONT_STACK};font-size:13px;font-weight:700;color:#ffffff;">Bakano Finanzas · financiero@bakano.ec</p>
            <p style="margin:6px 0 0;font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:#b9b2c6;">Notificación automática del sistema de cobranzas. No respondas a este correo si no requieres asistencia.</p>
            ${note}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
