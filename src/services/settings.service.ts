import mongoose from "mongoose";
import { AppSetting, IAppSetting, INotificationSetting, NotificationSetting } from "../models";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";
import { cloudinaryService } from "./cloudinary.service";

const BRAND_FOLDER = "bakano-finanzas/brand";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const EMAIL_LIST_FIELDS = ["recipients", "alwaysTo", "ccEmails"] as const;

const TOGGLE_KEYS = [
  "paymentRegistered",
  "reminderBefore",
  "overdue",
  "deactivation",
  "monthlySummary",
] as const;

function normalizeEmails(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new CustomError(`El campo ${field} debe ser una lista de correos`, 400);
  }

  const cleaned = value
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => item.length > 0);

  for (const email of cleaned) {
    if (!EMAIL_REGEX.test(email)) {
      throw new CustomError(`Correo inválido en ${field}: ${email}`, 400);
    }
  }

  return Array.from(new Set(cleaned));
}

function validateSingleEmail(value: unknown, field: string): string {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new CustomError(`El campo ${field} no puede estar vacío`, 400);
  }

  const match = raw.match(/<([^>]+)>/);
  const email = (match ? match[1] : raw).trim().toLowerCase();

  if (!EMAIL_REGEX.test(email)) {
    throw new CustomError(`Correo inválido en ${field}: ${raw}`, 400);
  }

  return raw;
}

async function getNotificationSettings(): Promise<INotificationSetting> {
  const existing = await NotificationSetting.findOne({ key: "global" });
  if (existing) return existing;

  return NotificationSetting.create({
    key: "global",
    fromEmail: env.resend.from,
    replyTo: env.resend.replyTo,
    recipients: ["financiero@bakano.ec"],
    alwaysTo: [env.resend.defaultTo],
  });
}

async function updateNotificationSettings(
  patch: Record<string, unknown>,
  userId?: string
): Promise<INotificationSetting> {
  const settings = await getNotificationSettings();

  for (const field of EMAIL_LIST_FIELDS) {
    if (patch[field] !== undefined) {
      settings.set(field, normalizeEmails(patch[field], field));
    }
  }

  if (patch.fromEmail !== undefined) {
    settings.fromEmail = validateSingleEmail(patch.fromEmail, "fromEmail");
  }

  if (patch.replyTo !== undefined) {
    settings.replyTo = validateSingleEmail(patch.replyTo, "replyTo");
  }

  if (patch.toggles !== undefined && typeof patch.toggles === "object" && patch.toggles !== null) {
    const incoming = patch.toggles as Record<string, unknown>;
    for (const key of TOGGLE_KEYS) {
      if (incoming[key] !== undefined) {
        settings.toggles[key] = Boolean(incoming[key]);
      }
    }
    settings.markModified("toggles");
  }

  const numericFields = [
    "reminderDaysBefore",
    "graceDays",
    "warnBeforeDeactivationDays",
    "sendHour",
  ] as const;

  for (const field of numericFields) {
    if (patch[field] !== undefined) {
      const parsed = Number(patch[field]);
      if (Number.isNaN(parsed) || parsed < 0) {
        throw new CustomError(`El campo ${field} debe ser un número válido`, 400);
      }
      settings[field] = parsed;
    }
  }

  if (patch.autoDeactivateEnabled !== undefined) {
    settings.autoDeactivateEnabled = Boolean(patch.autoDeactivateEnabled);
  }

  if (userId) {
    settings.updatedBy = new mongoose.Types.ObjectId(userId);
  }

  await settings.save();
  return settings;
}

async function getAppSettings(): Promise<IAppSetting> {
  const existing = await AppSetting.findOne({ key: "global" });
  if (existing) return existing;

  return AppSetting.create({
    key: "global",
    appName: env.brand.appName,
    logoUrl: env.brand.logoUrl,
    iconUrl: env.brand.iconUrl,
    brandColors: {
      primary: env.brand.primary,
      primaryDark: env.brand.primaryDark,
      primaryLight: env.brand.primaryLight,
      secondary: env.brand.secondary,
      green: env.brand.green,
      warning: env.brand.warning,
      error: env.brand.error,
    },
    currency: "USD",
    timezone: env.timezone,
  });
}

async function updateAppSettings(
  patch: Record<string, unknown>,
  userId?: string
): Promise<IAppSetting> {
  const settings = await getAppSettings();

  if (patch.appName !== undefined) {
    const name = String(patch.appName).trim();
    if (!name) throw new CustomError("El nombre de la aplicación no puede estar vacío", 400);
    settings.appName = name;
  }

  if (patch.logoUrl !== undefined) settings.logoUrl = String(patch.logoUrl).trim();
  if (patch.iconUrl !== undefined) settings.iconUrl = String(patch.iconUrl).trim();
  if (patch.currency !== undefined) settings.currency = String(patch.currency).trim() || "USD";
  if (patch.timezone !== undefined) settings.timezone = String(patch.timezone).trim();

  if (patch.brandColors !== undefined) {
    if (typeof patch.brandColors !== "object" || patch.brandColors === null) {
      throw new CustomError("brandColors debe ser un objeto de colores", 400);
    }
    settings.brandColors = {
      ...settings.brandColors,
      ...(patch.brandColors as Record<string, string>),
    };
    settings.markModified("brandColors");
  }

  if (userId) {
    settings.updatedBy = new mongoose.Types.ObjectId(userId);
  }

  await settings.save();
  return settings;
}

async function uploadLogo(buffer: Buffer, userId?: string): Promise<IAppSetting> {
  if (!buffer || !buffer.length) {
    throw new CustomError("No se recibió ningún archivo de logo", 400);
  }

  const settings = await getAppSettings();
  const previousPublicId = settings.logoPublicId;

  const uploaded = await cloudinaryService.uploadBuffer(buffer, BRAND_FOLDER);

  settings.logoUrl = uploaded.url;
  settings.logoPublicId = uploaded.publicId;
  if (userId) settings.updatedBy = new mongoose.Types.ObjectId(userId);
  await settings.save();

  if (previousPublicId && previousPublicId !== uploaded.publicId) {
    await cloudinaryService.destroy(previousPublicId);
  }

  return settings;
}

function resolveRecipients(settings: INotificationSetting): string[] {
  const all = [...(settings.recipients || []), ...(settings.alwaysTo || [])]
    .map((email) => String(email || "").trim().toLowerCase())
    .filter((email) => email.length > 0);

  if (!all.includes(env.resend.defaultTo.toLowerCase())) {
    all.push(env.resend.defaultTo.toLowerCase());
  }

  return Array.from(new Set(all));
}

export const settingsService = {
  getNotificationSettings,
  updateNotificationSettings,
  getAppSettings,
  updateAppSettings,
  uploadLogo,
  resolveRecipients,
};
