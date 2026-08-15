import { FilterQuery } from "mongoose";
import { Client, ClientCategory, IClient, User } from "../models";
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
import { invoiceGenerationService } from "./invoice.generation.service";
import { metricsService } from "./metrics.service";
import { toPeriod } from "../utils/date.util";

export type ArchivedFilter = "true" | "false" | "all";

export interface ClientListQuery {
  q?: string;
  paymentMethod?: PaymentMethod;
  billingType?: BillingType;
  isActive?: boolean;
  hasWorkspace?: boolean;
  archived?: ArchivedFilter;
  tag?: string;
  ownerId?: string;
  categoryId?: string;
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
  if (query.ownerId) filter.ownerId = query.ownerId;
  if (query.categoryId) filter.categoryId = query.categoryId;
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

/**
 * Cachea el nombre del responsable junto al id. Se denormaliza a propósito: las
 * listas de cobros lo muestran en cada fila y resolverlo por lookup en cada
 * consulta no compensa.
 */
async function resolveCategoryName(input: Partial<IClient>): Promise<void> {
  if (!("categoryId" in input)) return;
  if (!input.categoryId) {
    input.categoryName = null;
    return;
  }
  const category = await ClientCategory.findById(input.categoryId);
  if (!category) throw new CustomError("La categoría no existe", 404);
  input.categoryName = category.name;
}

async function resolveOwnerName(input: Partial<IClient>): Promise<void> {
  if (!("ownerId" in input)) return;
  if (!input.ownerId) {
    input.ownerName = undefined;
    return;
  }
  const owner = await User.findById(input.ownerId).select("name");
  if (!owner) throw new CustomError("El responsable de cobro no existe", 404);
  input.ownerName = owner.name;
}

async function create(input: Partial<IClient>, userId?: string) {
  const exists = await Client.findOne({ name: input.name });
  if (exists) throw new CustomError("Ya existe un cliente con ese nombre", 409);

  await resolveOwnerName(input);
  await resolveCategoryName(input);
  const client = await Client.create({ ...input, createdBy: userId });

  // Espacio de trabajo en métricas. Sin él no hay logo, ni corte por mora, ni
  // nada que mostrarle al cliente: crearlo a mano después se olvidaba. Si ya
  // existe uno con ese nombre se reutiliza en vez de duplicarlo.
  if (!client.workspaceId) {
    try {
      const result = await metricsService.createWorkspace(client.name);
      if (result?.workspace?._id) {
        client.workspaceId = String(result.workspace._id);
        client.workspaceName = result.workspace.name ?? client.name;
        client.workspaceIsActive = result.workspace.isActive !== false;
        client.workspaceLinkedAt = new Date();
        await client.save();
      }
    } catch (error) {
      // Nunca tumbar el alta por esto: el espacio se puede vincular a mano.
      console.error(
        `[clients] No se pudo crear el espacio de ${client.name}:`,
        (error as Error).message
      );
    }
  }

  // El cron mensual ya corrió para el período en curso, así que un alta a mitad
  // de mes quedaba sin cobro hasta el mes siguiente: su primer pago no tenía
  // contra qué registrarse y el cliente no aparecía en el histórico.
  // `generateForPeriod` es idempotente y respeta startDate/billingStartPeriod,
  // así que si al cliente no le toca facturar este mes simplemente no crea nada.
  try {
    await invoiceGenerationService.generateForPeriod(toPeriod(), {
      clientIds: [client._id.toString()],
    });
  } catch (error) {
    // Nunca tumbar el alta por esto: el cobro se puede generar después a mano.
    console.error(
      `[clients] No se pudo generar el primer cobro de ${client.name}:`,
      (error as Error).message
    );
  }

  return client;
}

async function update(id: string, input: Partial<IClient>) {
  const client = await getById(id);

  if (input.name && input.name !== client.name) {
    const exists = await Client.findOne({ name: input.name, _id: { $ne: client._id } });
    if (exists) throw new CustomError("Ya existe un cliente con ese nombre", 409);
  }

  const forbidden = ["_id", "createdAt", "updatedAt", "createdBy"];
  forbidden.forEach((key) => delete (input as Record<string, unknown>)[key]);

  await resolveOwnerName(input);
  await resolveCategoryName(input);

  const touchesBilling =
    input.amount !== undefined || input.splits !== undefined || input.collectionDay !== undefined;

  client.set(input);
  await client.save();

  // Si cambió el monto, los cobros divididos o el día de cobro, los cobros abiertos
  // del período en curso se regeneran con el valor nuevo; si no, la factura queda
  // con el monto viejo y el pago correspondiente no se puede registrar.
  if (touchesBilling) {
    try {
      await invoiceGenerationService.generateForPeriod(toPeriod(), {
        clientIds: [client._id.toString()],
        force: true,
      });
    } catch (error) {
      // Nunca tumbar la edición por esto: el cobro se puede regenerar después a mano.
      console.error(
        `[clients] No se pudo sincronizar los cobros de ${client.name}:`,
        (error as Error).message
      );
    }
  }

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
  updateLifecycleDates: clientLifecycleService.updateLifecycleDates,
  addLifecycleAttachments: clientLifecycleService.addLifecycleAttachments,
  purge: clientLifecycleService.purge,
  listArchived: clientLifecycleService.listArchived,
};

export { clientLifecycleService, clientWorkspaceService };
export type { ArchiveInput, ReactivateInput } from "./client.lifecycle.service";
export type { WorkspaceSuggestion } from "./client.workspace.service";
