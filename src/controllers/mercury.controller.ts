import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { asyncHandler } from "../utils/asyncHandler.util";
import { param } from "../utils/expressHandler.util";
import { mercuryService, MercuryQuery } from "../services/mercury.service";
import { buildOverview } from "../services/mercury.insights.service";
import {
  annotateTransactions,
  buildSubscriptions,
  clearSubscriptionIndex,
  subscriptionIndex,
} from "../services/mercury.subscriptions.service";

/**
 * Endpoints del banco (Mercury). Todos son GET: la integración es de solo lectura.
 */

const TRANSACTION_FILTERS = [
  "limit",
  "offset",
  "order",
  "start",
  "end",
  "search",
  "status",
  "mercuryCategory",
  "categoryId",
] as const;

/** Toma de `req.query` solo los filtros que Mercury acepta, ya saneados. */
function readQuery(req: AuthRequest, allowed: readonly string[]): MercuryQuery {
  const out: MercuryQuery = {};
  for (const key of allowed) {
    const raw = (req.query as Record<string, unknown>)[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined || value === null || value === "") continue;
    out[key] = String(value);
  }
  if (out.limit) out.limit = Math.min(Math.max(Number(out.limit) || 50, 1), 500);
  if (out.offset) out.offset = Math.max(Number(out.offset) || 0, 0);
  return out;
}

/** `?refresh=true` salta la caché en memoria del servicio. */
function wantsRefresh(req: AuthRequest): boolean {
  return readFlag(req, "refresh");
}

function readFlag(req: AuthRequest, key: string): boolean {
  const raw = (req.query as Record<string, unknown>)[key];
  return String(Array.isArray(raw) ? raw[0] : raw) === "true";
}

export const mercuryHealth = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const health = await mercuryService.health();
  res.status(health.reachable ? 200 : health.configured ? 502 : 503).json(health);
});

export const listAccounts = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (wantsRefresh(req)) mercuryService.clearCache();

  const accounts = await mercuryService.listAccounts();

  res.json({
    configured: mercuryService.isConfigured(),
    total: accounts.length,
    currentBalance: accounts.reduce((sum, a) => sum + Number(a.currentBalance || 0), 0),
    availableBalance: accounts.reduce((sum, a) => sum + Number(a.availableBalance || 0), 0),
    items: accounts,
  });
});

export const getAccount = asyncHandler(async (req: AuthRequest, res: Response) => {
  const account = await mercuryService.getAccount(param(req, "id"));
  res.json(account);
});

export const listTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (wantsRefresh(req)) {
    mercuryService.clearCache();
    clearSubscriptionIndex();
  }

  const accountId = param(req, "id");
  const query = readQuery(req, TRANSACTION_FILTERS);
  const limit = Number(query.limit || 50);
  const offset = Number(query.offset || 0);
  const onlySubscriptions = readFlag(req, "onlySubscriptions");

  const index = await subscriptionIndex();

  // Con el filtro de suscripciones no se puede paginar en Mercury: la marca es nuestra, así
  // que se trae un bloque grande, se filtra y se pagina acá.
  if (onlySubscriptions) {
    const page = await mercuryService.listTransactions(accountId, { ...query, limit: 500, offset: 0 });
    const all = annotateTransactions(page.transactions, index).filter((tx) => tx.subscription);
    const items = all.slice(offset, offset + limit);

    res.json({
      limit,
      offset,
      count: items.length,
      total: all.length,
      hasMore: offset + limit < all.length,
      items,
    });
    return;
  }

  // Mercury devuelve `total` = tamaño de la página, no el total real: pedimos uno de más
  // para saber si existe página siguiente.
  const page = await mercuryService.listTransactions(accountId, { ...query, limit: limit + 1 });
  const items = annotateTransactions(page.transactions.slice(0, limit), index);

  res.json({
    limit,
    offset,
    count: items.length,
    hasMore: page.transactions.length > limit,
    items,
  });
});

export const listCards = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (wantsRefresh(req)) mercuryService.clearCache();

  const cards = await mercuryService.listCards(param(req, "id"));
  res.json({ total: cards.length, items: cards });
});

export const listStatements = asyncHandler(async (req: AuthRequest, res: Response) => {
  const query = readQuery(req, ["limit", "order", "start", "end"]);
  const statements = await mercuryService.listStatements(param(req, "id"), query);
  res.json({ total: statements.length, items: statements });
});

export const listTreasury = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const accounts = await mercuryService.listTreasury();
  res.json({
    total: accounts.length,
    currentBalance: accounts.reduce((sum, a) => sum + Number(a.currentBalance || 0), 0),
    items: accounts,
  });
});

/** Suscripciones inferidas de los cargos recurrentes. Ver `mercury.subscriptions.service`. */
export const getSubscriptions = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (wantsRefresh(req)) {
    mercuryService.clearCache();
    clearSubscriptionIndex();
  }

  const days = Math.min(Math.max(Number((req.query as Record<string, unknown>).days) || 365, 60), 730);
  const report = await buildSubscriptions(days);

  res.json({ configured: mercuryService.isConfigured(), ...report });
});

export const getOverview = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (wantsRefresh(req)) mercuryService.clearCache();

  const days = Math.min(Math.max(Number((req.query as Record<string, unknown>).days) || 180, 30), 365);
  const overview = await buildOverview(days);

  res.json({ configured: mercuryService.isConfigured(), ...overview });
});
