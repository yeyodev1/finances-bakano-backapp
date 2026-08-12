import { Router } from "express";
import * as clientController from "../controllers/client.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { toHandler } from "../utils/expressHandler.util";
import { requireRole } from "../middlewares/role.middleware";
import { validate } from "../middlewares/validate.middleware";
import { uploadDocument } from "../middlewares/upload.middleware";
import { idParamSchema } from "../validators/common.schema";
import {
  archiveClientSchema,
  backfillSchema,
  clientCategorySchema,
  clientListSchema,
  createClientSchema,
  grantAccessSchema,
  lifecycleDatesSchema,
  linkWorkspaceSchema,
  reactivateClientSchema,
  revokeAccessSchema,
  toggleClientActiveSchema,
  updateClientSchema,
} from "../validators/client.schema";

const auth = toHandler(authMiddleware);

const clientRouter = Router();
const canWrite = requireRole("superadmin", "admin");

clientRouter.use(auth);

clientRouter.get("/", validate(clientListSchema, "query"), clientController.list);
clientRouter.get("/stats", clientController.stats);
clientRouter.get("/archived", clientController.listArchived);
clientRouter.get("/access-overrides", clientController.listAccessOverrides);
clientRouter.post("/", canWrite, validate(createClientSchema), clientController.create);
clientRouter.post("/sync-workspace-images", canWrite, clientController.syncWorkspaceImages);

// Las rutas de categoría van ANTES de "/:id" o Express tomaría "categories" como id.
clientRouter.get("/categories", clientController.listCategories);
clientRouter.post(
  "/categories",
  canWrite,
  validate(clientCategorySchema),
  clientController.createCategory
);
clientRouter.put(
  "/categories/:id",
  canWrite,
  validate(idParamSchema, "params"),
  validate(clientCategorySchema.partial()),
  clientController.updateCategory
);
clientRouter.delete(
  "/categories/:id",
  canWrite,
  validate(idParamSchema, "params"),
  clientController.removeCategory
);

clientRouter.get("/:id", validate(idParamSchema, "params"), clientController.getById);
clientRouter.put(
  "/:id",
  canWrite,
  validate(idParamSchema, "params"),
  validate(updateClientSchema),
  clientController.update
);
clientRouter.delete(
  "/:id",
  requireRole("superadmin"),
  validate(idParamSchema, "params"),
  clientController.remove
);
clientRouter.patch(
  "/:id/active",
  canWrite,
  validate(idParamSchema, "params"),
  validate(toggleClientActiveSchema),
  clientController.toggleActive
);
clientRouter.post(
  "/:id/link-workspace",
  canWrite,
  validate(idParamSchema, "params"),
  validate(linkWorkspaceSchema),
  clientController.linkWorkspace
);
clientRouter.delete(
  "/:id/link-workspace",
  canWrite,
  validate(idParamSchema, "params"),
  clientController.unlinkWorkspace
);
clientRouter.get(
  "/:id/workspace-suggestions",
  validate(idParamSchema, "params"),
  clientController.workspaceSuggestions
);
clientRouter.post(
  "/:id/grant-access",
  canWrite,
  validate(idParamSchema, "params"),
  validate(grantAccessSchema),
  clientController.grantAccess
);
clientRouter.delete(
  "/:id/grant-access",
  canWrite,
  validate(idParamSchema, "params"),
  validate(revokeAccessSchema),
  clientController.revokeAccess
);
clientRouter.post(
  "/:id/archive",
  canWrite,
  validate(idParamSchema, "params"),
  toHandler(uploadDocument.array("attachments", 10)),
  validate(archiveClientSchema),
  clientController.archive
);
clientRouter.patch(
  "/:id/lifecycle-dates",
  canWrite,
  validate(idParamSchema, "params"),
  validate(lifecycleDatesSchema),
  clientController.updateLifecycleDates
);
clientRouter.post(
  "/:id/reactivate",
  canWrite,
  validate(idParamSchema, "params"),
  validate(reactivateClientSchema),
  clientController.reactivate
);
clientRouter.post(
  "/:id/attachments",
  canWrite,
  validate(idParamSchema, "params"),
  toHandler(uploadDocument.array("attachments", 10)),
  clientController.addAttachments
);
clientRouter.delete(
  "/:id/purge",
  requireRole("superadmin"),
  validate(idParamSchema, "params"),
  clientController.purge
);
clientRouter.post(
  "/:id/backfill",
  canWrite,
  validate(idParamSchema, "params"),
  validate(backfillSchema),
  clientController.backfill
);

export default clientRouter;
