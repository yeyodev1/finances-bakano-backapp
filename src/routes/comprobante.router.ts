import { Router } from "express";
import * as comprobanteController from "../controllers/comprobante.controller";
import { uploadDocument } from "../middlewares/upload.middleware";

/**
 * Subida de comprobantes por enlace firmado (lo entrega el MCP del equipo).
 * Público a propósito: el token del enlace es la autorización y vence solo.
 */
const comprobanteRouter = Router();

comprobanteRouter.get("/:token", comprobanteController.ver);
comprobanteRouter.post("/:token", uploadDocument.single("file"), comprobanteController.subir);

export default comprobanteRouter;
