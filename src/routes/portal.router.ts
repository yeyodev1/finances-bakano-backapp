import { Router } from "express";
import * as portalController from "../controllers/portal.controller";
import { metricsKeyMiddleware } from "../middlewares/metricsKey.middleware";
import { uploadDocument } from "../middlewares/upload.middleware";
import { validate } from "../middlewares/validate.middleware";
import { portalCheckoutSchema, portalSubmitSchema } from "../validators/paymentSubmission.schema";

/**
 * Portal del cliente. metrics-backapp ya validó el JWT del usuario y su
 * pertenencia al workspace; acá solo entra tráfico servidor-a-servidor
 * autenticado con x-metrics-key.
 */
const portalRouter = Router();
portalRouter.use(metricsKeyMiddleware);

portalRouter.get("/workspaces/:workspaceId/billing", portalController.billing);
portalRouter.post(
  "/workspaces/:workspaceId/checkout-session",
  validate(portalCheckoutSchema),
  portalController.checkout
);
portalRouter.post(
  "/workspaces/:workspaceId/submissions",
  uploadDocument.single("receipt"),
  validate(portalSubmitSchema),
  portalController.submit
);

export default portalRouter;
