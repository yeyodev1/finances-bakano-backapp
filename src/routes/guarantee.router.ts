import { Router } from "express";
import * as guaranteeController from "../controllers/guarantee.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { toHandler } from "../utils/expressHandler.util";
import { requireRole } from "../middlewares/role.middleware";
import { validate } from "../middlewares/validate.middleware";
import { idParamSchema } from "../validators/common.schema";
import { clientIdParamSchema } from "../validators/refund.schema";
import {
  closeGuaranteeSchema,
  extendGuaranteeSchema,
  guaranteeListSchema,
  openGuaranteeSchema,
} from "../validators/guarantee.schema";

const auth = toHandler(authMiddleware);

const guaranteeRouter = Router();
const canWrite = requireRole("superadmin", "admin");

guaranteeRouter.use(auth);

guaranteeRouter.get("/", validate(guaranteeListSchema, "query"), guaranteeController.list);
guaranteeRouter.get("/summary", guaranteeController.summary);
guaranteeRouter.post("/", canWrite, validate(openGuaranteeSchema), guaranteeController.open);
guaranteeRouter.get(
  "/client/:clientId",
  validate(clientIdParamSchema, "params"),
  guaranteeController.listByClient
);
guaranteeRouter.get("/:id", validate(idParamSchema, "params"), guaranteeController.getById);
guaranteeRouter.post(
  "/:id/extend",
  canWrite,
  validate(idParamSchema, "params"),
  validate(extendGuaranteeSchema),
  guaranteeController.extend
);
guaranteeRouter.post(
  "/:id/close",
  canWrite,
  validate(idParamSchema, "params"),
  validate(closeGuaranteeSchema),
  guaranteeController.close
);

export default guaranteeRouter;
