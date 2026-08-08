import { Client, IClient, Invoice } from "../models";
import { CustomError } from "../errors/customError.error";
import { nameSimilarity } from "../utils/similarity.util";
import { MetricsWorkspace, metricsService, workspaceImageOf } from "./metrics.service";

export interface WorkspaceSuggestion {
  workspaceId: string;
  workspaceName: string;
  isActive: boolean;
  adminName?: string;
  adminEmail?: string;
  imageUrl: string | null;
  score: number;
}

export interface SyncWorkspaceImagesResult {
  updated: number;
  notFound: number;
  total: number;
  configured: boolean;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function findClient(id: string): Promise<IClient> {
  const client = await Client.findById(id);
  if (!client) throw new CustomError("Cliente no encontrado", 404);
  return client;
}

/** Trae el espacio de métricas sin romper el flujo si el backend remoto falla. */
async function safeGetWorkspace(workspaceId: string): Promise<MetricsWorkspace | null> {
  if (!metricsService.isConfigured()) return null;
  try {
    return await metricsService.getWorkspace(workspaceId);
  } catch (error) {
    console.warn(
      `[client] No se pudo leer el espacio ${workspaceId} de métricas: ${(error as Error).message}`
    );
    return null;
  }
}

/**
 * Vincula el espacio y cachea su nombre e imagen. Si métricas no responde el vínculo
 * se guarda igual y la imagen queda en null hasta la próxima sincronización.
 */
async function linkWorkspace(clientId: string, workspaceId: string, workspaceName?: string) {
  const client = await findClient(clientId);

  const taken = await Client.findOne({ workspaceId, _id: { $ne: client._id } });
  if (taken) {
    throw new CustomError(`Ese workspace ya está vinculado al cliente "${taken.name}"`, 409);
  }

  const workspace = await safeGetWorkspace(workspaceId);

  client.workspaceId = workspaceId;
  client.workspaceName =
    workspaceName || readString(workspace?.name) || client.workspaceName || undefined;
  client.workspaceImageUrl = workspaceImageOf(workspace);
  client.workspaceLinkedAt = new Date();
  if (typeof workspace?.isActive === "boolean") {
    client.workspaceIsActive = workspace.isActive;
  }
  await client.save();

  await Invoice.updateMany(
    { clientId: client._id, status: { $in: ["pending", "partial", "overdue"] } },
    { $set: { workspaceId } }
  );

  return client;
}

async function unlinkWorkspace(clientId: string) {
  const client = await findClient(clientId);

  client.workspaceId = undefined;
  client.workspaceName = undefined;
  client.workspaceImageUrl = null;
  client.workspaceLinkedAt = null as unknown as Date;
  client.workspaceIsActive = null;
  await client.save();

  return client;
}

async function suggestWorkspaceMatches(clientId: string): Promise<WorkspaceSuggestion[]> {
  if (!metricsService.isConfigured()) return [];

  const client = await findClient(clientId);
  const workspaces = await metricsService.listWorkspaces().catch(() => []);
  if (!workspaces.length) return [];

  const candidates = [client.name, client.legalName, client.contactName].filter(
    (value): value is string => Boolean(value)
  );

  return workspaces
    .map((workspace) => {
      const workspaceName = readString(workspace.name) || "";
      const adminName = readString(workspace.adminName) || readString(workspace.ownerName);
      const adminEmail = readString(workspace.adminEmail) || readString(workspace.ownerEmail);

      const score = Math.max(
        ...candidates.map((candidate) => nameSimilarity(candidate, workspaceName)),
        adminEmail && client.contactEmail ? nameSimilarity(adminEmail, client.contactEmail) : 0
      );

      return {
        workspaceId: String(workspace._id),
        workspaceName,
        isActive: Boolean(workspace.isActive),
        adminName,
        adminEmail,
        imageUrl: workspaceImageOf(workspace),
        score: Number(score.toFixed(4)),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/**
 * Refresca imagen, nombre y estado del espacio en todos los clientes vinculados
 * con una sola llamada a métricas (nunca una por cliente).
 */
async function syncWorkspaceImages(): Promise<SyncWorkspaceImagesResult> {
  const clients = await Client.find({ workspaceId: { $nin: [null, ""] } })
    .select("workspaceId workspaceName workspaceImageUrl workspaceIsActive")
    .lean();

  if (!metricsService.isConfigured()) {
    return { updated: 0, notFound: clients.length, total: clients.length, configured: false };
  }

  const workspaces = await metricsService.listWorkspaces();
  const byId = new Map(workspaces.map((workspace) => [String(workspace._id), workspace]));

  const operations: Parameters<typeof Client.bulkWrite>[0] = [];
  let notFound = 0;

  for (const client of clients) {
    const workspace = byId.get(String(client.workspaceId));
    if (!workspace) {
      notFound += 1;
      continue;
    }

    const imageUrl = workspaceImageOf(workspace);
    const name = readString(workspace.name) || client.workspaceName || null;
    const isActive =
      typeof workspace.isActive === "boolean" ? workspace.isActive : client.workspaceIsActive;

    const changed =
      (client.workspaceImageUrl || null) !== imageUrl ||
      (client.workspaceName || null) !== name ||
      (client.workspaceIsActive ?? null) !== (isActive ?? null);

    if (!changed) continue;

    operations.push({
      updateOne: {
        filter: { _id: client._id },
        update: {
          $set: {
            workspaceImageUrl: imageUrl,
            workspaceName: name,
            workspaceIsActive: isActive ?? null,
          },
        },
      },
    });
  }

  if (operations.length) await Client.bulkWrite(operations);

  return {
    updated: operations.length,
    notFound,
    total: clients.length,
    configured: true,
  };
}

export const clientWorkspaceService = {
  linkWorkspace,
  unlinkWorkspace,
  suggestWorkspaceMatches,
  syncWorkspaceImages,
};
