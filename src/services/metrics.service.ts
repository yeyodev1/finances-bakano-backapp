import axios, { AxiosInstance } from "axios";
import { env } from "../config/env";
import { AuditLog } from "../models";
import { CustomError } from "../errors/customError.error";

/** Imagen del espacio tal como la devuelve métricas (logo, foto de la página, etc.). */
export interface MetricsWorkspaceImage {
  name?: string;
  url?: string;
  categoria?: string;
  tipo?: string;
}

export interface MetricsWorkspace {
  _id: string;
  name?: string;
  isActive?: boolean;
  ownerEmail?: string;
  ownerName?: string;
  adminId?: string;
  adminName?: string;
  adminEmail?: string;
  adminPhotoUrl?: string | null;
  imageUrl?: string | null;
  logoUrl?: string | null;
  pictureUrl?: string | null;
  images?: MetricsWorkspaceImage[];
  pageName?: string | null;
  instagramAccountName?: string | null;
  tipoNegocio?: string | null;
  vertical?: string | null;
  createdAt?: string | Date;
  [key: string]: unknown;
}

/** Campos de imagen/identidad que se reexponen tal cual al frontend. */
export const WORKSPACE_IMAGE_FIELDS = [
  "imageUrl",
  "logoUrl",
  "pictureUrl",
  "images",
  "pageName",
  "instagramAccountName",
  "tipoNegocio",
  "vertical",
  "adminPhotoUrl",
  "adminName",
  "adminEmail",
] as const;

function readUrl(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Mejor imagen disponible del espacio: logo propio, foto de la página o la primera del catálogo. */
export function workspaceImageOf(workspace?: MetricsWorkspace | null): string | null {
  if (!workspace) return null;

  const direct =
    readUrl(workspace.imageUrl) || readUrl(workspace.logoUrl) || readUrl(workspace.pictureUrl);
  if (direct) return direct;

  const images = Array.isArray(workspace.images) ? workspace.images : [];
  for (const image of images) {
    const url = readUrl(image?.url);
    if (url) return url;
  }

  return readUrl(workspace.adminPhotoUrl);
}

/** Subconjunto de campos visuales del espacio, listo para mezclar en la respuesta HTTP. */
export function workspaceVisuals(workspace: MetricsWorkspace): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of WORKSPACE_IMAGE_FIELDS) {
    out[field] = workspace[field] ?? (field === "images" ? [] : null);
  }
  out.resolvedImageUrl = workspaceImageOf(workspace);
  return out;
}

const BASE_PATH = "/integrations/finance/workspaces";

let client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (!client) {
    client = axios.create({
      baseURL: env.metrics.apiUrl,
      timeout: 10000,
      headers: {
        "x-finance-key": env.metrics.apiKey,
        "Content-Type": "application/json",
      },
    });
  }
  return client;
}

function isConfigured(): boolean {
  return Boolean(env.metrics.apiUrl && env.metrics.apiKey);
}

function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string } | undefined;
    return data?.message || error.message || "Error de red";
  }
  return error instanceof Error ? error.message : String(error);
}

async function logError(action: string, entityId: string | undefined, error: unknown) {
  try {
    await AuditLog.create({
      action,
      entity: "MetricsWorkspace",
      entityId,
      level: "error",
      meta: {
        message: describeError(error),
        status: axios.isAxiosError(error) ? error.response?.status : undefined,
        url: env.metrics.apiUrl,
      },
    });
  } catch {
    console.error(`[metrics] no se pudo registrar el AuditLog de ${action}`);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (first) {
    await delay(600);
    return fn();
  }
}

/**
 * Métricas envuelve las respuestas: `{ message, workspaces }` en los listados y
 * `{ message, workspace }` en el detalle y en el PATCH de estado.
 */
function unwrap<T>(payload: unknown): T {
  const body = payload as {
    data?: unknown;
    workspaces?: unknown;
    workspace?: unknown;
    items?: unknown;
  };
  if (body && typeof body === "object") {
    if (body.data !== undefined) return body.data as T;
    if (body.workspaces !== undefined) return body.workspaces as T;
    if (body.workspace !== undefined) return body.workspace as T;
    if (body.items !== undefined) return body.items as T;
  }
  return payload as T;
}

async function listWorkspaces(): Promise<MetricsWorkspace[]> {
  if (!isConfigured()) {
    console.warn("[metrics] Backend de métricas no configurado; se devuelve lista vacía");
    return [];
  }

  try {
    const res = await request(() => getClient().get(BASE_PATH));
    const data = unwrap<MetricsWorkspace[]>(res.data);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("[metrics] Error listando workspaces:", describeError(error));
    await logError("metrics.listWorkspaces", undefined, error);
    return [];
  }
}

async function getWorkspace(id: string): Promise<MetricsWorkspace> {
  if (!isConfigured()) {
    throw new CustomError("El backend de métricas no está configurado", 503);
  }

  try {
    const res = await request(() => getClient().get(`${BASE_PATH}/${id}`));
    return unwrap<MetricsWorkspace>(res.data);
  } catch (error) {
    await logError("metrics.getWorkspace", id, error);
    throw new CustomError(
      `No se pudo obtener el espacio de trabajo ${id} desde el backend de métricas: ${describeError(error)}`,
      502
    );
  }
}

async function setWorkspaceActive(
  id: string,
  isActive: boolean,
  reason?: string
): Promise<MetricsWorkspace> {
  if (!isConfigured()) {
    throw new CustomError("El backend de métricas no está configurado", 503);
  }

  try {
    const res = await request(() =>
      getClient().patch(`${BASE_PATH}/${id}/active`, { isActive, reason })
    );

    await AuditLog.create({
      action: isActive ? "metrics.workspaceActivated" : "metrics.workspaceDeactivated",
      entity: "MetricsWorkspace",
      entityId: id,
      level: "info",
      meta: { isActive, reason },
    });

    return unwrap<MetricsWorkspace>(res.data);
  } catch (error) {
    await logError("metrics.setWorkspaceActive", id, error);
    throw new CustomError(
      `No se pudo ${isActive ? "activar" : "desactivar"} el espacio de trabajo ${id}: ${describeError(error)}`,
      502
    );
  }
}

async function health(): Promise<{ configured: boolean; reachable: boolean; message: string }> {
  if (!isConfigured()) {
    return {
      configured: false,
      reachable: false,
      message: "Falta configurar METRICS_API_URL o FINANCE_API_KEY",
    };
  }

  try {
    await getClient().get(BASE_PATH, { timeout: 5000 });
    return { configured: true, reachable: true, message: "Conexión con métricas correcta" };
  } catch (error) {
    return { configured: true, reachable: false, message: describeError(error) };
  }
}

export const metricsService = {
  isConfigured,
  listWorkspaces,
  getWorkspace,
  setWorkspaceActive,
  health,
  workspaceImageOf,
  workspaceVisuals,
};
