import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";

/**
 * Integración con el banco (Mercury). **Solo lectura**: este módulo únicamente expone
 * peticiones GET. No hay ningún camino de código que pueda mover dinero.
 */

// ── Tipos que devuelve Mercury (v1) ──────────────────────────────────────────
export interface MercuryAccount {
  id: string;
  name?: string;
  nickname?: string | null;
  legalBusinessName?: string | null;
  status?: string;
  type?: string;
  kind?: string;
  currentBalance?: number;
  availableBalance?: number;
  accountNumber?: string;
  routingNumber?: string;
  dashboardLink?: string;
  canReceiveTransactions?: boolean | null;
  createdAt?: string;
  [key: string]: unknown;
}

export interface MercuryTransaction {
  id: string;
  accountId?: string;
  amount?: number;
  status?: string;
  kind?: string;
  note?: string | null;
  externalMemo?: string | null;
  bankDescription?: string | null;
  counterpartyId?: string | null;
  counterpartyName?: string | null;
  counterpartyNickname?: string | null;
  cardId?: string | null;
  mercuryCategory?: string | null;
  createdAt?: string;
  postedAt?: string | null;
  failedAt?: string | null;
  estimatedDeliveryDate?: string | null;
  reasonForFailure?: string | null;
  dashboardLink?: string;
  [key: string]: unknown;
}

export interface MercuryCard {
  cardId: string;
  nameOnCard?: string;
  lastFourDigits?: string;
  status?: string;
  physicalCardStatus?: string | null;
  network?: string;
  type?: string;
  spendLimit?: unknown;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface MercuryStatement {
  id: string;
  startDate?: string;
  endDate?: string;
  endingBalance?: number;
  downloadUrl?: string;
  accountNumber?: string;
  companyLegalName?: string;
  [key: string]: unknown;
}

export interface MercuryTreasuryAccount {
  id: string;
  status?: string;
  currentBalance?: number;
  availableBalance?: number;
  netReturns?: number;
  createdAt?: string;
  [key: string]: unknown;
}

export interface MercuryHealth {
  configured: boolean;
  reachable: boolean;
  /** Motivo legible cuando `reachable` es false. */
  message: string;
  /** Código de Mercury (`ipNotWhitelisted`, `noTokenInDBButMaybeMalformed`, …). */
  errorCode?: string;
  /** IP saliente vista por Mercury; útil para pedir el whitelist correcto. */
  ip?: string;
  checkedAt: string;
}

export type MercuryQuery = Record<string, string | number | undefined>;

// ── Cliente HTTP ─────────────────────────────────────────────────────────────
let client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (!client) {
    client = axios.create({
      baseURL: env.mercury.apiUrl,
      timeout: env.mercury.timeout,
      headers: {
        Authorization: `Bearer ${env.mercury.token}`,
        accept: "application/json",
      },
    });
  }
  return client;
}

function isConfigured(): boolean {
  return Boolean(env.mercury.apiUrl && env.mercury.token);
}

/** Token enmascarado para logs y diagnóstico (`…RG3cT_yrucrem`). */
function maskedToken(): string {
  const token = env.mercury.token;
  if (!token) return "";
  return `${token.slice(0, 22)}…${token.slice(-8)}`;
}

interface MercuryApiError {
  errors?: { message?: string; errorCode?: string; ip?: string; documentationUrl?: string };
  message?: string;
}

function readApiError(error: unknown): {
  status?: number;
  message: string;
  errorCode?: string;
  ip?: string;
} {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const body = error.response?.data as MercuryApiError | undefined;
    const inner = body?.errors;

    if (inner?.errorCode === "ipNotWhitelisted") {
      return {
        status,
        errorCode: inner.errorCode,
        ip: inner.ip,
        message: `La IP ${inner.ip || "de este servidor"} no está autorizada en el token de Mercury. Agrégala en Settings → Tokens → IP whitelist.`,
      };
    }

    if (status === 401 || status === 403) {
      return {
        status,
        errorCode: inner?.errorCode,
        message:
          inner?.message ||
          "Mercury rechazó el token. Verifica MERCURY_API_TOKEN (debe incluir el prefijo 'secret-token:').",
      };
    }

    if (status === 429) {
      return { status, errorCode: "rateLimited", message: "Mercury está limitando las peticiones (429). Intenta en unos segundos." };
    }

    return {
      status,
      errorCode: inner?.errorCode,
      message: inner?.message || body?.message || error.message || "Error de red con Mercury",
    };
  }

  return { message: error instanceof Error ? error.message : String(error) };
}

/** Reintenta una vez ante errores transitorios (red, 429, 5xx). Nunca ante 4xx de autorización. */
function isRetryable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  if (status === undefined) return true;
  return status === 429 || status >= 500;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Caché en memoria ─────────────────────────────────────────────────────────
interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(path: string, params?: MercuryQuery): string {
  const clean = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return clean ? `${path}?${clean}` : path;
}

/** Limpia toda la caché de Mercury (lo usa el botón "Actualizar" del frontend). */
function clearCache(): void {
  cache.clear();
}

/**
 * Única puerta de salida hacia Mercury. Solo GET, con caché y reintento.
 * @param ttlSeconds 0 desactiva la caché para esta llamada.
 */
async function get<T>(path: string, params?: MercuryQuery, ttlSeconds = env.mercury.cacheTtl): Promise<T> {
  if (!isConfigured()) {
    throw new CustomError(
      "La integración con Mercury no está configurada: falta MERCURY_API_TOKEN en el servidor",
      503
    );
  }

  const key = cacheKey(path, params);
  const now = Date.now();

  if (ttlSeconds > 0) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.value as T;
  }

  const config: AxiosRequestConfig = { params };

  try {
    let response;
    try {
      response = await getClient().get<T>(path, config);
    } catch (first) {
      if (!isRetryable(first)) throw first;
      await delay(800);
      response = await getClient().get<T>(path, config);
    }

    if (ttlSeconds > 0) {
      cache.set(key, { value: response.data, expiresAt: now + ttlSeconds * 1000 });
    }
    return response.data;
  } catch (error) {
    const parsed = readApiError(error);
    console.error(`[mercury] GET ${path} → ${parsed.status || "ERR"}: ${parsed.message}`);
    const status = parsed.status === 404 ? 404 : parsed.status === 503 ? 503 : 502;
    throw new CustomError(parsed.message, status);
  }
}

// ── Lecturas de negocio ──────────────────────────────────────────────────────
async function listAccounts(): Promise<MercuryAccount[]> {
  const data = await get<{ accounts?: MercuryAccount[] }>("/accounts", { limit: 100 });
  return Array.isArray(data?.accounts) ? data.accounts : [];
}

async function getAccount(accountId: string): Promise<MercuryAccount> {
  return get<MercuryAccount>(`/account/${accountId}`);
}

export interface TransactionsPage {
  total: number;
  transactions: MercuryTransaction[];
}

async function listTransactions(accountId: string, query: MercuryQuery = {}): Promise<TransactionsPage> {
  const data = await get<TransactionsPage>(`/account/${accountId}/transactions`, {
    limit: 50,
    order: "desc",
    ...query,
  });
  return {
    total: Number(data?.total || 0),
    transactions: Array.isArray(data?.transactions) ? data.transactions : [],
  };
}

async function listCards(accountId: string): Promise<MercuryCard[]> {
  const data = await get<{ cards?: MercuryCard[] }>(`/account/${accountId}/cards`);
  return Array.isArray(data?.cards) ? data.cards : [];
}

async function listStatements(accountId: string, query: MercuryQuery = {}): Promise<MercuryStatement[]> {
  const data = await get<{ statements?: MercuryStatement[] }>(`/account/${accountId}/statements`, {
    limit: 24,
    order: "desc",
    ...query,
  });
  return Array.isArray(data?.statements) ? data.statements : [];
}

async function listTreasury(): Promise<MercuryTreasuryAccount[]> {
  const data = await get<{ accounts?: MercuryTreasuryAccount[] }>("/treasury", { limit: 50 });
  return Array.isArray(data?.accounts) ? data.accounts : [];
}

async function health(): Promise<MercuryHealth> {
  const checkedAt = new Date().toISOString();

  if (!isConfigured()) {
    return {
      configured: false,
      reachable: false,
      message: "Falta configurar MERCURY_API_TOKEN en el servidor",
      checkedAt,
    };
  }

  try {
    await getClient().get("/accounts", { params: { limit: 1 }, timeout: 8000 });
    return { configured: true, reachable: true, message: "Conexión con Mercury correcta", checkedAt };
  } catch (error) {
    const parsed = readApiError(error);
    return {
      configured: true,
      reachable: false,
      message: parsed.message,
      errorCode: parsed.errorCode,
      ip: parsed.ip,
      checkedAt,
    };
  }
}

export const mercuryService = {
  isConfigured,
  maskedToken,
  clearCache,
  listAccounts,
  getAccount,
  listTransactions,
  listCards,
  listStatements,
  listTreasury,
  health,
};
