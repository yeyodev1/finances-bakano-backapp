import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { toHandler } from "../utils/expressHandler.util";
import { requireRole } from "../middlewares/role.middleware";
import { uploadImage } from "../middlewares/upload.middleware";
import {
  getAppSettings,
  getNotificationSettings,
  sendTestEmail,
  updateAppSettings,
  updateNotificationSettings,
  uploadAppLogo,
} from "../controllers/settings.controller";

const settingsRouter = Router();

settingsRouter.use(toHandler(authMiddleware));

const canWrite = requireRole("superadmin", "admin");

settingsRouter.get("/notifications", getNotificationSettings);
settingsRouter.put("/notifications", canWrite, updateNotificationSettings);
settingsRouter.post("/notifications/test", canWrite, sendTestEmail);

settingsRouter.get("/app", getAppSettings);
settingsRouter.put("/app", canWrite, updateAppSettings);
settingsRouter.post("/app/logo", canWrite, uploadImage.single("logo"), uploadAppLogo);

export default settingsRouter;
