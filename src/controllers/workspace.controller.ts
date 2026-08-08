import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../types/AuthRequest";
import { asyncHandler } from "../utils/asyncHandler.util";
import { metricsService, workspaceVisuals } from "../services/metrics.service";
import { AuditLog, Client } from "../models";
import { CustomError } from "../errors/customError.error";
import { param } from "../utils/expressHandler.util";
import {
  EMPTY_ACCESS_STATUS,
  accessStatusFor,
  accessStatusMap,
  isOverrideActive,
} from "../services/access.status.service";

const CLIENT_FIELDS =
  "name amount currency isActive workspaceId workspaceName workspaceImageUrl workspaceIsActive accessOverride graceDays autoDeactivate deactivatedAt deactivationReason contactEmail contactName paymentMethod";

export const listWorkspaces = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const workspaces = await metricsService.listWorkspaces();
  const clients = await Client.find({ workspaceId: { $nin: [null, ""] } })
    .select(CLIENT_FIELDS)
    .lean();

  const statuses = await accessStatusMap(clients.map((client) => client._id));
  const now = new Date();
  const byWorkspace = new Map(clients.map((client) => [String(client.workspaceId), client]));

  const items = workspaces.map((workspace) => {
    const client = byWorkspace.get(String(workspace._id)) || null;
    const status = client
      ? statuses.get(String(client._id)) || EMPTY_ACCESS_STATUS
      : EMPTY_ACCESS_STATUS;

    return {
      ...workspace,
      ...workspaceVisuals(workspace),
      client,
      ...status,
      accessOverride: client?.accessOverride || null,
      accessOverrideActive: client ? isOverrideActive(client, now) : false,
    };
  });

  const linkedIds = new Set(items.map((item) => String(item._id)));
  const orphanClients = clients
    .filter((client) => !linkedIds.has(String(client.workspaceId)))
    .map((client) => ({
      ...client,
      ...(statuses.get(String(client._id)) || EMPTY_ACCESS_STATUS),
      accessOverrideActive: isOverrideActive(client, now),
    }));

  res.json({
    configured: metricsService.isConfigured(),
    total: items.length,
    items,
    orphanClients,
  });
});

export const getWorkspace = asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = param(req, "id");
  const workspace = await metricsService.getWorkspace(id);
  const client = await Client.findOne({ workspaceId: id }).select(CLIENT_FIELDS).lean();
  const status = client ? await accessStatusFor(client._id) : EMPTY_ACCESS_STATUS;

  res.json({
    ...workspace,
    ...workspaceVisuals(workspace),
    client: client || null,
    ...status,
    accessOverride: client?.accessOverride || null,
    accessOverrideActive: client ? isOverrideActive(client) : false,
  });
});

export const setWorkspaceActive = asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = param(req, "id");
  const { isActive, reason } = req.body as { isActive?: unknown; reason?: string };

  if (typeof isActive !== "boolean") {
    throw new CustomError("El campo 'isActive' es obligatorio y debe ser booleano", 400);
  }

  const finalReason = reason?.trim() || (isActive ? "Reactivación manual" : "Desactivación manual");
  const workspace = await metricsService.setWorkspaceActive(id, isActive, finalReason);

  const client = await Client.findOne({ workspaceId: id });
  if (client) {
    client.workspaceIsActive = isActive;
    client.deactivatedAt = isActive ? null : new Date();
    client.deactivationReason = isActive ? undefined : finalReason;
    await client.save();
  }

  await AuditLog.create({
    action: isActive ? "workspace.manualActivate" : "workspace.manualDeactivate",
    entity: "Client",
    entityId: client?._id.toString() || id,
    userId: req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : undefined,
    userName: req.user?.name || req.user?.email,
    level: "info",
    meta: { workspaceId: id, isActive, reason: finalReason },
  });

  res.json({
    message: isActive
      ? "Espacio de trabajo activado correctamente"
      : "Espacio de trabajo desactivado correctamente",
    workspace,
    client: client || null,
  });
});

export const workspacesHealth = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const health = await metricsService.health();
  res.status(health.reachable ? 200 : 503).json(health);
});
