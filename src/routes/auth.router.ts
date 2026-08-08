import { Router } from "express";
import * as authController from "../controllers/auth.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { toHandler } from "../utils/expressHandler.util";
import { validate } from "../middlewares/validate.middleware";
import { changePasswordSchema, loginSchema } from "../validators/auth.schema";

const auth = toHandler(authMiddleware);

const authRouter = Router();

authRouter.post("/login", validate(loginSchema), authController.login);
authRouter.get("/me", auth, authController.me);
authRouter.post(
  "/change-password",
  auth,
  validate(changePasswordSchema),
  authController.changePassword
);

export default authRouter;
