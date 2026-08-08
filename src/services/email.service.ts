import { env } from "../config/env";
import { IClient, IInvoice, IPayment } from "../models";
import { ArchiveReason } from "../types/finance.types";
import { formatDateEs, toPeriod } from "../utils/date.util";
import { settingsService } from "./settings.service";
import { dashboardService } from "./dashboard.service";
import { listAccessOverrides } from "./access.status.service";
import { SendResult, dispatch } from "./email.dispatch";
import {
  RenderedEmail,
  renderKeyValueTable,
  renderLayout,
  renderParagraph,
} from "../templates/baseLayout.template";
import { paymentRegisteredTemplate } from "../templates/paymentRegistered.template";
import { reminderBeforeDueTemplate } from "../templates/reminderBeforeDue.template";
import { overdueAlertTemplate } from "../templates/overdueAlert.template";
import { workspaceDeactivatedTemplate } from "../templates/workspaceDeactivated.template";
import { workspaceReactivatedTemplate } from "../templates/workspaceReactivated.template";
import { monthlySummaryTemplate } from "../templates/monthlySummary.template";
import { paymentDeferredTemplate } from "../templates/paymentDeferred.template";
import { clientArchivedTemplate } from "../templates/clientArchived.template";
import { accessGrantedTemplate } from "../templates/accessGranted.template";
import { accessRevokedTemplate } from "../templates/accessRevoked.template";

async function sendPaymentRegistered(params: {
  invoice: IInvoice;
  payment: IPayment;
  client?: IClient | null;
}): Promise<SendResult> {
  return dispatch({
    type: "payment_registered",
    toggle: "paymentRegistered",
    rendered: paymentRegisteredTemplate(params),
    relatedModel: "Payment",
    relatedId: params.payment._id?.toString(),
  });
}

async function sendReminderBeforeDue(params: {
  invoice: IInvoice;
  client?: IClient | null;
  daysBefore: number;
}): Promise<SendResult> {
  return dispatch({
    type: "reminder_before_due",
    toggle: "reminderBefore",
    rendered: reminderBeforeDueTemplate(params),
    relatedModel: "Invoice",
    relatedId: params.invoice._id?.toString(),
  });
}

async function sendOverdueAlert(params: {
  invoice: IInvoice;
  client?: IClient | null;
  daysOverdue: number;
  deactivationInDays?: number | null;
}): Promise<SendResult> {
  const isWarning = typeof params.deactivationInDays === "number";
  return dispatch({
    type: "overdue_alert",
    toggle: isWarning ? "deactivation" : "overdue",
    rendered: overdueAlertTemplate(params),
    relatedModel: "Invoice",
    relatedId: params.invoice._id?.toString(),
  });
}

/**
 * Acuerdo de prórroga. `notificationSetting` no tiene un toggle propio para esto:
 * reutiliza `paymentRegistered` porque es un evento del mismo flujo de cobro.
 */
async function sendPaymentDeferred(params: {
  invoice: IInvoice;
  client?: IClient | null;
  previousDueDate: Date;
  newDueDate: Date;
  reason?: string;
}): Promise<SendResult> {
  return dispatch({
    type: "payment_deferred",
    toggle: "paymentRegistered",
    rendered: paymentDeferredTemplate(params),
    relatedModel: "Invoice",
    relatedId: params.invoice._id?.toString(),
  });
}

/** Baja de cliente. Sin toggle propio: reutiliza `overdue`. */
async function sendClientArchived(params: {
  client: IClient;
  reason?: ArchiveReason | string | null;
  notes?: string;
}): Promise<SendResult> {
  return dispatch({
    type: "client_archived",
    toggle: "overdue",
    rendered: clientArchivedTemplate(params),
    relatedModel: "Client",
    relatedId: params.client._id?.toString(),
  });
}

async function sendWorkspaceDeactivated(params: {
  client: IClient;
  invoice?: IInvoice | null;
  reason?: string;
}): Promise<SendResult> {
  return dispatch({
    type: "workspace_deactivated",
    toggle: "deactivation",
    rendered: workspaceDeactivatedTemplate(params),
    relatedModel: "Client",
    relatedId: params.client._id?.toString(),
  });
}

async function sendWorkspaceReactivated(params: {
  client: IClient;
  invoice?: IInvoice | null;
}): Promise<SendResult> {
  return dispatch({
    type: "workspace_reactivated",
    toggle: "deactivation",
    rendered: workspaceReactivatedTemplate(params),
    relatedModel: "Client",
    relatedId: params.client._id?.toString(),
  });
}

/**
 * Aviso de acceso abierto por excepción. Sin toggle propio: reutiliza `deactivation`
 * porque es el mismo canal por el que se avisan los cierres de espacio.
 */
async function sendAccessGranted(params: {
  client: IClient;
  reason: string;
  until?: Date | null;
  overdueAmount: number;
  daysOverdue: number;
  grantedByName: string;
}): Promise<SendResult> {
  return dispatch({
    type: "access_granted",
    toggle: "deactivation",
    rendered: accessGrantedTemplate(params),
    relatedModel: "Client",
    relatedId: params.client._id?.toString(),
  });
}

async function sendAccessRevoked(params: {
  client: IClient;
  closedWorkspace: boolean;
}): Promise<SendResult> {
  return dispatch({
    type: "access_revoked",
    toggle: "deactivation",
    rendered: accessRevokedTemplate(params),
    relatedModel: "Client",
    relatedId: params.client._id?.toString(),
  });
}

async function sendMonthlySummary(params: { period?: string }): Promise<SendResult> {
  const period = params.period || toPeriod();

  const [summary, overdueClients, accessOverrides] = await Promise.all([
    dashboardService.summary(period),
    dashboardService.overdueClientsForPeriod(period),
    listAccessOverrides().catch(() => []),
  ]);

  const rendered = monthlySummaryTemplate({
    period,
    expectedAmount: summary.expectedAmount,
    collectedAmount: summary.collectedAmount,
    pendingAmount: summary.pendingAmount,
    overdueAmount: summary.overdueAmount,
    collectionRate: summary.collectionRate,
    invoicesTotal: summary.invoicesTotal,
    invoicesPaid: summary.invoicesPaid,
    invoicesPending: summary.invoicesPending,
    invoicesOverdue: summary.invoicesOverdue,
    clientsActive: summary.clientsActive,
    workspacesDeactivated: summary.workspacesDeactivated,
    overdueClients,
    accessOverrides: accessOverrides.map((row) => ({
      clientName: row.name,
      reason: row.reason || "—",
      grantedByName: row.grantedByName || "—",
      until: row.until,
      overdueAmount: row.overdueAmount,
      maxDaysOverdue: row.maxDaysOverdue,
    })),
  });

  return dispatch({
    type: "monthly_summary",
    toggle: "monthlySummary",
    rendered,
    relatedModel: "Period",
    relatedId: period,
  });
}

async function sendTest(to?: string): Promise<SendResult> {
  const settings = await settingsService.getNotificationSettings();
  const recipients = to ? [to.trim().toLowerCase()] : settingsService.resolveRecipients(settings);

  const rendered: RenderedEmail = {
    subject: "Correo de prueba · Bakano Finanzas",
    html: renderLayout({
      title: "Correo de prueba",
      preheader: "Verificación de la configuración de notificaciones",
      bodyHtml: `
        ${renderParagraph(
          "Si estás leyendo este mensaje, la configuración de correos de <strong>Bakano Finanzas</strong> funciona correctamente."
        )}
        ${renderKeyValueTable([
          { label: "Remitente", value: settings.fromEmail || env.resend.from },
          { label: "Responder a", value: settings.replyTo || env.resend.replyTo },
          { label: "Destinatarios", value: recipients.join(", ") },
          { label: "Enviado el", value: formatDateEs(new Date()), strong: true },
        ])}
      `,
      ctaLabel: "Abrir el panel",
      ctaUrl: `${env.appUrl}/dashboard`,
    }),
  };

  return dispatch({
    type: "test",
    rendered,
    overrideTo: recipients,
    relatedModel: "Test",
  });
}

export type { SendResult };

export const emailService = {
  sendPaymentRegistered,
  sendReminderBeforeDue,
  sendOverdueAlert,
  sendPaymentDeferred,
  sendClientArchived,
  sendWorkspaceDeactivated,
  sendWorkspaceReactivated,
  sendAccessGranted,
  sendAccessRevoked,
  sendMonthlySummary,
  sendTest,
};
