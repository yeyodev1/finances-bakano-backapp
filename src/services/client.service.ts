import { FilterQuery } from "mongoose";
import { Client, IClient } from "../models";
import { CustomError } from "../errors/customError.error";
import { BillingType, PaginatedResult, PaymentMethod } from "../types/finance.types";
import {
  IDEAL_MONTHLY_MATCH,
  clientLifecycleService,
  idealMonthlyAmount,
  lifetimeRevenueOf,
  resolveLifetimeDays,
} from "./client.lifecycle.service";
import { clientWorkspaceService } from "./client.workspace.service";
import {
  accessStatusFor,
  accessStatusMap,
  isOverrideActive,
} from "./access.status.service";

export type ArchivedFilter = "true" | "false" | "all";

export interface ClientListQuery {
  q?: string;
  paymentMethod?: PaymentMethod;
  billingType?: BillingType;
  isActive?: boolean;
  hasWorkspace?: boolean;
  archived?: ArchivedFilter;
  tag?: string;
  page?: number;
  limit?: number;
  sort?: string;
}

export type ClientListItem = Record<string, unknown> & { lifetimeDays: number | null };

async function list(query: ClientListQuery = {}): Promise<PaginatedResult<ClientListItem>> {
  const page = Math.max(query.page || 1, 1);
  const limit = Math.min(Math.max(query.limit || 50, 1), 200);

  const filter: FilterQuery<IClient> = {};

  if (query.q) {
    const regex = { $regex: query.q, $options: "i" };
    filter.$or = [
      { name: regex },
      { legalName: regex },
      { contactName: regex },
      { contactEmail: regex },
      { workspaceName: regex },
    ];
  }
  if (query.paymentMethod) filter.paymentMethod = query.paymentMethod;
  if (query.billingType) filter.billingType = query.billingType;
  if (typeof query.isActive === "boolean") filter.isActive = query.isActive;
  if (query.tag) filter.tags = query.tag;
  if (typeof query.hasWorkspace === "boolean") {
    filter.workspaceId = query.hasWorkspace ? { $nin: [null, ""] } : { $in: [null, ""] };
  }

  const archived: ArchivedFilter = query.archived || "false";
  if (archived === "true") filter.isArchived = true;
  else if (archived === "false") filter.isArchived = { $ne: true };

  const sort = query.sort || "name";
  const sortSpec: Record<string, 1 | -1> = sort.startsWith("-")
    ? { [sort.slice(1)]: -1 }
    : { [sort]: 1 };

  const [docs, total] = await Promise.all([
    Client.find(filter)
      .sort(sortSpec)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Client.countDocuments(filter),
  ]);

  const statuses = await accessStatusMap(docs.map((doc) => doc._id));
  const now = new Date();

  const items = docs.map((doc) => ({
    ...doc,
    ...(statuses.get(String(doc._id)) || {
      shouldBeClosed: false,
      overdueAmount: 0,
      maxDaysOverdue: 0,
      overdueInvoices: 0,
      effectiveGraceDays: 0,
    }),
    accessOverrideActive: isOverrideActive(doc, now),
    lifetimeDays: resolveLifetimeDays(doc),
  })) as ClientListItem[];

  return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
}

async function getById(id: string): Promise<IClient> {
  const client = await Client.findById(id);
  if (!client) throw new CustomError("Cliente no encontrado", 404);
  return client;
}

/** Detalle enriquecido para la API: incluye duración de vida e ingreso acumulado. */
async function getDetail(id: string) {
  const client = await getById(id);

  const [lifetimeRevenue, status] = await Promise.all([
    client.isArchived && typeof client.lifetimeRevenue === "number"
      ? Promise.resolve(client.lifetimeRevenue)
      : lifetimeRevenueOf(client._id),
    accessStatusFor(client._id),
  ]);

  return {
    ...client.toObject(),
    ...status,
    accessOverrideActive: isOverrideActive(client),
    lifetimeDays: resolveLifetimeDays(client),
    lifetimeRevenue,
    lifecycleHistory: client.lifecycleHistory || [],
  };
}

async function create(input: Partial<IClient>, userId?: string) {
  const exists = await Client.findOne({ name: input.name });
  if (exists) throw new CustomError("Ya existe un cliente con ese nombre", 409);

  return Client.create({ ...input, createdBy: userId });
}

async function update(id: string, input: Partial<IClient>) {
  const client = await getById(id);

  if (input.name && input.name !== client.name) {
    const exists = await Client.findOne({ name: input.name, _id: { $ne: client._id } });
    if (exists) throw new CustomError("Ya existe un cliente con ese nombre", 409);
  }

  const forbidden = ["_id", "createdAt", "updatedAt", "createdBy"];
  forbidden.forEach((key) => delete (input as Record<string, unknown>)[key]);

  client.set(input);
  await client.save();
  return client;
}

async function remove(_id: string): Promise<never> {
  throw new CustomError(
    "Los clientes no se eliminan; usa la baja para conservar el historial.",
    400
  );
}

async function toggleActive(id: string, isActive: boolean, reason?: string) {
  const client = await getById(id);

  client.isActive = isActive;
  if (!isActive) {
    client.deactivatedAt = new Date();
    client.deactivationReason = reason || "Desactivado manualmente";
  } else {
    client.deactivatedAt = null;
    client.deactivationReason = undefined;
  }

  await client.save();
  return client;
}

async function stats() {
  const notArchived = { isArchived: { $ne: true } };

  const [total, active, archived, linked, monthly, ideal] = await Promise.all([
    Client.countDocuments(notArchived),
    Client.countDocuments({ ...notArchived, isActive: true }),
    Client.countDocuments({ isArchived: true }),
    Client.countDocuments({ ...notArchived, isActive: true, workspaceId: { $nin: [null, ""] } }),
    Client.aggregate<{ _id: null; expected: number }>([
      { $match: { ...IDEAL_MONTHLY_MATCH } },
      { $group: { _id: null, expected: { $sum: "$amount" } } },
    ]),
    idealMonthlyAmount(),
  ]);

  return {
    totalClients: total,
    activeClients: active,
    inactiveClients: total - active,
    archivedClients: archived,
    linkedWorkspaces: linked,
    expectedMonthlyAmount: monthly[0]?.expected || 0,
    idealMonthlyAmount: ideal,
  };
}

export const clientService = {
  list,
  getById,
  getDetail,
  create,
  update,
  remove,
  toggleActive,
  stats,
  linkWorkspace: clientWorkspaceService.linkWorkspace,
  unlinkWorkspace: clientWorkspaceService.unlinkWorkspace,
  suggestWorkspaceMatches: clientWorkspaceService.suggestWorkspaceMatches,
  syncWorkspaceImages: clientWorkspaceService.syncWorkspaceImages,
  archive: clientLifecycleService.archive,
  reactivate: clientLifecycleService.reactivate,
  addLifecycleAttachments: clientLifecycleService.addLifecycleAttachments,
  purge: clientLifecycleService.purge,
  listArchived: clientLifecycleService.listArchived,
};

export { clientLifecycleService, clientWorkspaceService };
export type { ArchiveInput, ReactivateInput } from "./client.lifecycle.service";
export type { WorkspaceSuggestion } from "./client.workspace.service";
