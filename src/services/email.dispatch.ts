import { Resend } from "resend";
import { env } from "../config/env";
import { EmailLog, INotificationSetting } from "../models";
import { EmailType } from "../types/finance.types";
import { settingsService } from "./settings.service";
import { RenderedEmail } from "../templates/baseLayout.template";

export interface SendResult {
  sent: boolean;
  skipped?: boolean;
  reason?: string;
  providerId?: string;
  to?: string[];
}

export type ToggleKey = keyof INotificationSetting["toggles"];

export interface DispatchParams {
  type: EmailType;
  rendered: RenderedEmail;
  toggle?: ToggleKey;
  relatedModel?: string;
  relatedId?: string;
  overrideTo?: string[];
}

let resendClient: Resend | null = null;

function getResend(): Resend | null {
  if (!env.resend.apiKey) return null;
  if (!resendClient) resendClient = new Resend(env.resend.apiKey);
  return resendClient;
}

async function logEmail(params: {
  type: EmailType;
  to: string[];
  cc: string[];
  subject: string;
  status: "sent" | "failed";
  providerId?: string;
  error?: string;
  relatedModel?: string;
  relatedId?: string;
}) {
  try {
    await EmailLog.create({ ...params, sentAt: new Date() });
  } catch (error) {
    console.error("[email] No se pudo registrar el EmailLog:", (error as Error).message);
  }
}

/** Resuelve preferencias, destinatarios y envío. Nunca lanza hacia el controlador. */
export async function dispatch(params: DispatchParams): Promise<SendResult> {
  const { type, rendered, toggle, relatedModel, relatedId, overrideTo } = params;

  let settings: INotificationSetting;
  try {
    settings = await settingsService.getNotificationSettings();
  } catch (error) {
    const message = (error as Error).message;
    console.error("[email] No se pudieron leer las preferencias de notificación:", message);
    await logEmail({
      type,
      to: overrideTo || [],
      cc: [],
      subject: rendered.subject,
      status: "failed",
      error: message,
      relatedModel,
      relatedId,
    });
    return { sent: false, reason: message };
  }

  if (toggle && settings.toggles && settings.toggles[toggle] === false) {
    console.log(`[email] Notificación "${type}" desactivada en configuración; no se envía`);
    return { sent: false, skipped: true, reason: `Notificación ${type} desactivada` };
  }

  const to = overrideTo?.length ? overrideTo : settingsService.resolveRecipients(settings);
  const cc = (settings.ccEmails || []).filter((email) => !to.includes(email));
  const from = settings.fromEmail || env.resend.from;
  const replyTo = settings.replyTo || env.resend.replyTo;

  if (!to.length) {
    const reason = "No hay destinatarios configurados";
    console.warn(`[email] ${reason}`);
    await logEmail({
      type,
      to,
      cc,
      subject: rendered.subject,
      status: "failed",
      error: reason,
      relatedModel,
      relatedId,
    });
    return { sent: false, reason };
  }

  const client = getResend();
  if (!client) {
    console.warn("[email] Resend no configurado");
    await logEmail({
      type,
      to,
      cc,
      subject: rendered.subject,
      status: "failed",
      error: "Resend no configurado",
      relatedModel,
      relatedId,
    });
    return { sent: false, reason: "Resend no configurado", to };
  }

  try {
    const response = await client.emails.send({
      from,
      to,
      cc: cc.length ? cc : undefined,
      replyTo,
      subject: rendered.subject,
      html: rendered.html,
    });

    if (response.error) {
      throw new Error(response.error.message || "Error desconocido de Resend");
    }

    await logEmail({
      type,
      to,
      cc,
      subject: rendered.subject,
      status: "sent",
      providerId: response.data?.id,
      relatedModel,
      relatedId,
    });

    return { sent: true, providerId: response.data?.id, to };
  } catch (error) {
    const message = (error as Error).message;
    console.error(`[email] Falló el envío de "${type}":`, message);
    await logEmail({
      type,
      to,
      cc,
      subject: rendered.subject,
      status: "failed",
      error: message,
      relatedModel,
      relatedId,
    });
    return { sent: false, reason: message, to };
  }
}
