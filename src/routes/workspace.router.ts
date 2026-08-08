import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { toHandler } from "../utils/expressHandler.util";
import { requireRole } from "../middlewares/role.middleware";
import {
  getWorkspace,
  listWorkspaces,
  setWorkspaceActive,
  workspacesHealth,
} from "../controllers/workspace.controller";

const workspaceRouter = Router();

workspaceRouter.use(toHandler(authMiddleware));

workspaceRouter.get("/health", workspacesHealth);
workspaceRouter.get("/", listWorkspaces);
workspaceRouter.get("/:id", getWorkspace);
workspaceRouter.patch("/:id/active", requireRole("superadmin", "admin"), setWorkspaceActive);

export default workspaceRouter;
