import { Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.util";
import { clientCategoryService } from "../services/clientCategory.service";
import { clientService, ClientListQuery } from "../services/client.service";
import { accessService } from "../services/access.service";
import { invoiceService } from "../services/invoice.service";
import { AuthRequest } from "../types/AuthRequest";
import { param } from "../utils/expressHandler.util";
import { IClient } from "../models";

export const list = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await clientService.list(req.query as ClientListQuery);
  res.status(200).json(result);
});

export const stats = asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.status(200).json(await clientService.stats());
});

export const getById = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await clientService.getDetail(param(req, "id")));
});

export const listArchived = asyncHandler(async (req: AuthRequest, res: Response) => {
  const limit = Number(req.query.limit) || 100;
  const items = await clientService.listArchived(limit);
  res.status(200).json({ total: items.length, items });
});

export const create = asyncHandler(async (req: AuthRequest, res: Response) => {
  const client = await clientService.create(req.body as Partial<IClient>, req.user?._id);
  res.status(201).json(client);
});

export const update = asyncHandler(async (req: AuthRequest, res: Response) => {
  const client = await clientService.update(param(req, "id"), req.body as Partial<IClient>);
  res.status(200).json(client);
});

export const remove = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await clientService.remove(param(req, "id")));
});

function filesOf(req: AuthRequest): Express.Multer.File[] {
  const files = (req as { files?: unknown }).files;
  return Array.isArray(files) ? (files as Express.Multer.File[]) : [];
}

// ── Categorías de cliente ────────────────────────────────────────
export const listCategories = asyncHandler(async (req: AuthRequest, res: Response) => {
  const includeInactive = req.query.includeInactive === "true";
  res.status(200).json({ items: await clientCategoryService.list(includeInactive) });
});

export const createCategory = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(201).json(await clientCategoryService.create(req.body, req.user));
});

export const updateCategory = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await clientCategoryService.update(param(req, "id"), req.body));
});

export const removeCategory = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await clientCategoryService.remove(param(req, "id")));
});

export const archive = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { reason, notes, archivedAt } = req.body as {
    reason?: string;
    notes?: string;
    archivedAt?: string;
  };
  const result = await clientService.archive(
    param(req, "id"),
    { reason, notes, archivedAt, attachments: filesOf(req) },
    req.user
  );
  res.status(200).json(result);
});

export const updateLifecycleDates = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, archivedAt } = req.body as { startDate?: string; archivedAt?: string };
  res
    .status(200)
    .json(
      await clientService.updateLifecycleDates(param(req, "id"), { startDate, archivedAt }, req.user)
    );
});

export const reactivate = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { notes } = req.body as { notes?: string };
  res.status(200).json(await clientService.reactivate(param(req, "id"), { notes }, req.user));
});

export const addAttachments = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await clientService.addLifecycleAttachments(
    param(req, "id"),
    filesOf(req),
    req.user
  );
  res.status(201).json(result);
});

export const purge = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await clientService.purge(param(req, "id"), req.user));
});

export const toggleActive = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { isActive, reason } = req.body;
  res.status(200).json(await clientService.toggleActive(param(req, "id"), isActive, reason));
});

export const linkWorkspace = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { workspaceId, workspaceName } = req.body;
  const client = await clientService.linkWorkspace(param(req, "id"), workspaceId, workspaceName);
  res.status(200).json(client);
});

export const unlinkWorkspace = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await clientService.unlinkWorkspace(param(req, "id")));
});

export const workspaceSuggestions = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await clientService.suggestWorkspaceMatches(param(req, "id")));
});

export const syncWorkspaceImages = asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.status(200).json(await clientService.syncWorkspaceImages());
});

export const listAccessOverrides = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const items = await accessService.listOverrides();
  res.status(200).json({ total: items.length, items });
});

export const grantAccess = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { reason, until } = req.body as { reason?: string; until?: Date | null };
  const result = await accessService.grantAccess(param(req, "id"), { reason, until }, req.user);
  res.status(200).json(result);
});

export const revokeAccess = asyncHandler(async (req: AuthRequest, res: Response) => {
  const raw = (req.body as { closeWorkspace?: unknown })?.closeWorkspace ?? req.query.closeWorkspace;
  const closeWorkspace = raw === false || raw === "false" || raw === "0" ? false : true;
  const result = await accessService.revokeAccess(param(req, "id"), { closeWorkspace }, req.user);
  res.status(200).json(result);
});

export const backfill = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { fromDate, markPaidUntil } = req.body;
  const result = await invoiceService.backfillForClient(param(req, "id"), {
    fromDate,
    markPaidUntil,
  });
  res.status(200).json(result);
});
