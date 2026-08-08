import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { asyncHandler } from "../utils/asyncHandler.util";
import { settingsService } from "../services/settings.service";
import { emailService } from "../services/email.service";
import { CustomError } from "../errors/customError.error";

export const getNotificationSettings = asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json(await settingsService.getNotificationSettings());
});

export const updateNotificationSettings = asyncHandler(async (req: AuthRequest, res: Response) => {
  const updated = await settingsService.updateNotificationSettings(
    req.body as Record<string, unknown>,
    req.user?._id
  );
  res.json(updated);
});

export const getAppSettings = asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json(await settingsService.getAppSettings());
});

export const updateAppSettings = asyncHandler(async (req: AuthRequest, res: Response) => {
  const updated = await settingsService.updateAppSettings(
    req.body as Record<string, unknown>,
    req.user?._id
  );
  res.json(updated);
});

export const uploadAppLogo = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file?.buffer) {
    throw new CustomError("Debes adjuntar una imagen en el campo 'logo'", 400);
  }

  const updated = await settingsService.uploadLogo(req.file.buffer, req.user?._id);
  res.json(updated);
});

export const sendTestEmail = asyncHandler(async (req: AuthRequest, res: Response) => {
  const to = typeof req.body?.to === "string" ? req.body.to : undefined;
  const result = await emailService.sendTest(to);

  res.status(result.sent ? 200 : 502).json({
    message: result.sent
      ? "Correo de prueba enviado correctamente"
      : `No se pudo enviar el correo de prueba: ${result.reason || "error desconocido"}`,
    ...result,
  });
});
