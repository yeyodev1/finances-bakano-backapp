import { PipelineStage, Types } from "mongoose";
import { Client } from "../models";
import { IAccessOverride } from "../models/client.model";
import { diffInDays } from "../utils/date.util";
import { settingsService } from "./settings.service";

/** Apaga la excepción conservando el rastro de quién y por qué la había abierto. */
export function closedOverride(
  previous: IAccessOverride | undefined,
  at: Date,
  revokedByName: string
): IAccessOverride {
  return {
    enabled: false,
    reason: previous?.reason,
    grantedAt: previous?.grantedAt ?? null,
    grantedBy: previous?.grantedBy,
    grantedByName: previous?.grantedByName,
    until: previous?.until ?? null,
    revokedAt: at,
    revokedByName,
  };
}

/**
 * Estado derivado de cobranza de un cliente.
 *
 * `shouldBeClosed` = "este espacio debería estar cerrado": tiene al menos una factura
 * vencida con más días de mora que sus días de gracia efectivos (`client.graceDays` o el
 * global de NotificationSetting) y su espacio de trabajo sigue abierto. Es un estado
 * calculado, nunca se guarda en la base.
 */
export interface AccessStatus {
  shouldBeClosed: boolean;
  overdueAmount: number;
  maxDaysOverdue: number;
  overdueInvoices: number;
  effectiveGraceDays: number;
}

export const EMPTY_ACCESS_STATUS: AccessStatus = {
  shouldBeClosed: false,
  overdueAmount: 0,
  maxDaysOverdue: 0,
  overdueInvoices: 0,
  effectiveGraceDays: 0,
};

type OverrideLike = {
  enabled?: boolean;
  until?: Date | string | null;
} | null | undefined;

/** La excepción está vigente si está encendida y todavía no venció. */
export function isOverrideActive(
  client: { accessOverride?: OverrideLike } | null | undefined,
  now: Date = new Date()
): boolean {
  const override = client?.accessOverride;
  if (!override || override.enabled !== true) return false;
  if (override.until == null) return true;
  return new Date(override.until).getTime() > now.getTime();
}

/** Filtro de Mongo para las excepciones vigentes en este instante. */
export function activeOverrideFilter(now: Date = new Date()) {
  return {
    "accessOverride.enabled": true,
    $or: [{ "accessOverride.until": null }, { "accessOverride.until": { $gt: now } }],
  };
}

/** Lookup de facturas vencidas agrupadas por cliente, reutilizado por todas las agregaciones. */
export function overdueLookupStages(now: Date = new Date()): PipelineStage[] {
  return [
    {
      $lookup: {
        from: "invoices",
        let: { clientId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [{ $eq: ["$clientId", "$$clientId"] }, { $eq: ["$status", "overdue"] }],
              },
            },
          },
          {
            $group: {
              _id: null,
              overdueAmount: { $sum: { $subtract: ["$amount", "$paidAmount"] } },
              maxDaysOverdue: {
                $max: {
                  $max: [
                    0,
                    { $floor: { $divide: [{ $subtract: [now, "$dueDate"] }, 86400000] } },
                  ],
                },
              },
              overdueInvoices: { $sum: 1 },
            },
          },
        ],
        as: "overdueStats",
      },
    },
    {
      $addFields: {
        overdueAmount: {
          $round: [{ $ifNull: [{ $arrayElemAt: ["$overdueStats.overdueAmount", 0] }, 0] }, 2],
        },
        maxDaysOverdue: {
          $ifNull: [{ $arrayElemAt: ["$overdueStats.maxDaysOverdue", 0] }, 0],
        },
        overdueInvoices: {
          $ifNull: [{ $arrayElemAt: ["$overdueStats.overdueInvoices", 0] }, 0],
        },
      },
    },
  ];
}

/** Añade `effectiveGraceDays` y `shouldBeClosed` sobre un pipeline que ya trajo la mora. */
export function shouldBeClosedStages(globalGraceDays: number): PipelineStage[] {
  return [
    { $addFields: { effectiveGraceDays: { $ifNull: ["$graceDays", globalGraceDays] } } },
    {
      $addFields: {
        shouldBeClosed: {
          $and: [
            { $gt: ["$overdueInvoices", 0] },
            { $gt: ["$maxDaysOverdue", "$effectiveGraceDays"] },
            { $ne: ["$workspaceIsActive", false] },
          ],
        },
      },
    },
  ];
}

async function globalGraceDays(): Promise<number> {
  const settings = await settingsService.getNotificationSettings();
  return settings.graceDays ?? 0;
}

/**
 * Estado de cobranza de varios clientes en una sola agregación.
 * Sin `ids` recorre todos los clientes no archivados.
 */
export async function accessStatusMap(
  ids?: (Types.ObjectId | string)[]
): Promise<Map<string, AccessStatus>> {
  if (ids && ids.length === 0) return new Map();

  const grace = await globalGraceDays();

  const match: Record<string, unknown> = ids
    ? { _id: { $in: ids.map((id) => new Types.ObjectId(String(id))) } }
    : { isArchived: { $ne: true } };

  const rows = await Client.aggregate<AccessStatus & { _id: Types.ObjectId }>([
    { $match: match },
    ...overdueLookupStages(),
    ...shouldBeClosedStages(grace),
    {
      $project: {
        _id: 1,
        shouldBeClosed: 1,
        overdueAmount: 1,
        maxDaysOverdue: 1,
        overdueInvoices: 1,
        effectiveGraceDays: 1,
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      String(row._id),
      {
        shouldBeClosed: Boolean(row.shouldBeClosed),
        overdueAmount: row.overdueAmount || 0,
        maxDaysOverdue: row.maxDaysOverdue || 0,
        overdueInvoices: row.overdueInvoices || 0,
        effectiveGraceDays: row.effectiveGraceDays || 0,
      },
    ])
  );
}

export async function accessStatusFor(id: Types.ObjectId | string): Promise<AccessStatus> {
  const map = await accessStatusMap([id]);
  return map.get(String(id)) || EMPTY_ACCESS_STATUS;
}

/** Contadores para el dashboard: espacios que deberían estar cerrados y excepciones vigentes. */
export async function accessStatusCounts(): Promise<{
  shouldBeClosedCount: number;
  accessOverridesCount: number;
}> {
  const grace = await globalGraceDays();
  const now = new Date();

  const [rows, accessOverridesCount] = await Promise.all([
    Client.aggregate<{ _id: null; total: number }>([
      { $match: { isArchived: { $ne: true } } },
      ...overdueLookupStages(now),
      ...shouldBeClosedStages(grace),
      { $match: { shouldBeClosed: true } },
      { $count: "total" },
    ]),
    Client.countDocuments(activeOverrideFilter(now)),
  ]);

  return {
    shouldBeClosedCount: (rows[0] as unknown as { total?: number })?.total || 0,
    accessOverridesCount,
  };
}

export interface AccessOverrideRow {
  _id: string;
  name: string;
  workspaceId?: string | null;
  workspaceName?: string | null;
  workspaceImageUrl?: string | null;
  workspaceIsActive?: boolean | null;
  reason?: string;
  grantedAt?: Date | null;
  grantedByName?: string;
  until?: Date | null;
  daysLeft: number | null;
  expired: boolean;
  overdueAmount: number;
  maxDaysOverdue: number;
  overdueInvoices: number;
  currency: string;
}

/** Clientes abiertos por excepción, con su deuda y lo que le queda de vigencia a la excepción. */
export async function listAccessOverrides(): Promise<AccessOverrideRow[]> {
  const now = new Date();

  const rows = await Client.aggregate<Record<string, unknown> & { _id: Types.ObjectId }>([
    { $match: { "accessOverride.enabled": true } },
    ...overdueLookupStages(now),
    { $sort: { "accessOverride.grantedAt": -1 } },
    {
      $project: {
        name: 1,
        currency: 1,
        workspaceId: 1,
        workspaceName: 1,
        workspaceImageUrl: 1,
        workspaceIsActive: 1,
        accessOverride: 1,
        overdueAmount: 1,
        maxDaysOverdue: 1,
        overdueInvoices: 1,
      },
    },
  ]);

  return rows.map((row) => {
    const override = (row.accessOverride || {}) as {
      reason?: string;
      grantedAt?: Date | null;
      grantedByName?: string;
      until?: Date | null;
    };
    const until = override.until ? new Date(override.until) : null;

    return {
      _id: String(row._id),
      name: String(row.name || ""),
      workspaceId: (row.workspaceId as string) || null,
      workspaceName: (row.workspaceName as string) || null,
      workspaceImageUrl: (row.workspaceImageUrl as string) || null,
      workspaceIsActive: (row.workspaceIsActive as boolean) ?? null,
      reason: override.reason,
      grantedAt: override.grantedAt || null,
      grantedByName: override.grantedByName,
      until,
      daysLeft: until ? Math.max(diffInDays(now, until), 0) : null,
      expired: Boolean(until && until.getTime() <= now.getTime()),
      overdueAmount: (row.overdueAmount as number) || 0,
      maxDaysOverdue: (row.maxDaysOverdue as number) || 0,
      overdueInvoices: (row.overdueInvoices as number) || 0,
      currency: String(row.currency || "USD"),
    };
  });
}

