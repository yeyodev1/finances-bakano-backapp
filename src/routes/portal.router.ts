import { Router } from "express";
import * as portalController from "../controllers/portal.controller";
import { metricsKeyMiddleware } from "../middlewares/metricsKey.middleware";
import { uploadDocument } from "../middlewares/upload.middleware";
import { validate } from "../middlewares/validate.middleware";
import { portalCardUpdateSchema, portalCheckoutSchema, portalSubmitSchema } from "../validators/paymentSubmission.schema";

/**
 * Portal del cliente. metrics-backapp ya validó el JWT del usuario y su
 * pertenencia al workspace; acá solo entra tráfico servidor-a-servidor
 * autenticado con x-metrics-key.
 */
const portalRouter = Router();
portalRouter.use(metricsKeyMiddleware);

portalRouter.get("/estado-pagos", portalController.estadoPagos);

// MCP del equipo (mcp.bakano.ec): la persona va en x-actor-email.
portalRouter.get("/mcp/clientes", portalController.mcpClientes);
portalRouter.get("/mcp/cliente", portalController.mcpCliente);
portalRouter.get("/mcp/resumen", portalController.mcpResumen);
portalRouter.post("/mcp/pagos", portalController.mcpRegistrarPago);
portalRouter.get("/mcp/bloqueos", portalController.mcpBloqueos);
portalRouter.post("/mcp/vincular", portalController.mcpVincular);
portalRouter.post("/mcp/acceso", portalController.mcpAcceso);
portalRouter.post("/mcp/plazo", portalController.mcpPlazo);
portalRouter.get("/workspaces/:workspaceId/billing", portalController.billing);
portalRouter.post(
  "/workspaces/:workspaceId/checkout-session",
  validate(portalCheckoutSchema),
  portalController.checkout
);
portalRouter.post(
  "/workspaces/:workspaceId/card-update-session",
  validate(portalCardUpdateSchema),
  portalController.cardUpdate
);
portalRouter.post(
  "/workspaces/:workspaceId/submissions",
  uploadDocument.single("receipt"),
  validate(portalSubmitSchema),
  portalController.submit
);

export default portalRouter;
