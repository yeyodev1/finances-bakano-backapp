import { Router } from "express";
import * as userController from "../controllers/user.controller";
import * as authController from "../controllers/auth.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { toHandler } from "../utils/expressHandler.util";
import { requireSuperadmin } from "../middlewares/role.middleware";
import { validate } from "../middlewares/validate.middleware";
import { idParamSchema } from "../validators/common.schema";
import {
  createUserSchema,
  toggleActiveSchema,
  updateUserSchema,
  userListSchema,
} from "../validators/user.schema";

const auth = toHandler(authMiddleware);

const userRouter = Router();

userRouter.use(auth);

userRouter.get("/me", authController.me);
// Cualquier autenticado: para elegir vendedor / responsable de cobro.
userRouter.get("/directory", userController.directory);

userRouter.get("/", requireSuperadmin, validate(userListSchema, "query"), userController.list);
userRouter.post("/", requireSuperadmin, validate(createUserSchema), userController.create);

userRouter.get(
  "/:id",
  requireSuperadmin,
  validate(idParamSchema, "params"),
  userController.getById
);
userRouter.put(
  "/:id",
  requireSuperadmin,
  validate(idParamSchema, "params"),
  validate(updateUserSchema),
  userController.update
);
userRouter.patch(
  "/:id/active",
  requireSuperadmin,
  validate(idParamSchema, "params"),
  validate(toggleActiveSchema),
  userController.toggleActive
);
userRouter.delete(
  "/:id",
  requireSuperadmin,
  validate(idParamSchema, "params"),
  userController.remove
);

export default userRouter;
