import { Types } from "mongoose";
import { AuditLog, Client, IClient, Invoice } from "../models";
import { CustomError } from "../errors/customError.error";
import { JwtPayload } from "../types/AuthRequest";
import { metricsService } from "./metrics.service";
import { emailService } from "./email.service";
import {
  accessStatusFor,
  closedOverride,
  isOverrideActive,
  listAccessOverrides,
} from "./access.status.service";

export interface GrantAccessInput {
  reason?: string;
  until?: string | Date | null;
}

export interface RevokeAccessInput {
  closeWorkspace?: boolean;
}

async function findClient(id: string): Promise<IClient> {
  const client = await Client.findById(id);
  if (!client) throw new CustomError("Cliente no encontrado", 404);
  return client;
}

function toObjectId(value?: string): Types.ObjectId | undefined {
  return value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : undefined;
}

function actorName(user?: JwtPayload): string {
  return user?.name || user?.email || "Sistema";
}

function parseUntil(value?: string | Date | null): Date | null {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new CustomError("La fecha de vencimiento de la excepción es inválida.", 400);
  }
  if (date.getTime() <= Date.now()) {
    throw new CustomError("La excepción debe vencer en una fecha futura.", 400);
  }
  return date;
}

/** Reabre las facturas vencidas que el cron había marcado como desactivadas. */
async function markInvoicesReactivated(clientId: Types.ObjectId, at: Date): Promise<number> {
  const result = await Invoice.updateMany(
    {
      clientId,
      status: "overdue",
      "deactivation.deactivatedAt": { $ne: null },
      "deactivation.reactivatedAt": null,
    },
    { $set: { "deactivation.reactivatedAt": at } }
  );
  return result.modifiedCount || 0;
}

/**
 * Abre el acceso a un cliente moroso dejándolo marcado como excepción: el espacio queda
 * abierto a propósito aunque `shouldBeClosed` siga siendo true, y el cron lo respeta
 * mientras la excepción esté vigente.
 */
async function grantAccess(clientId: string, input: GrantAccessInput, user?: JwtPayload) {
  const reason = String(input.reason || "").trim();
  if (!reason) {
    throw new CustomError("Debes indicar por qué se abre el acceso.", 400);
  }

  const client = await findClient(clientId);
  if (!client.workspaceId) {
    throw new CustomError(
      "Este cliente no tiene un espacio de trabajo vinculado; vincúlalo antes de abrir el acceso.",
      400
    );
  }

  const until = parseUntil(input.until);
  const status = await accessStatusFor(client._id);
  const now = new Date();

  await metricsService.setWorkspaceActive(
    client.workspaceId,
    true,
    `Acceso abierto por excepción: ${reason}`
  );

  client.accessOverride = {
    enabled: true,
    reason,
    grantedAt: now,
    grantedBy: toObjectId(user?._id),
    grantedByName: actorName(user),
    until,
    revokedAt: null,
    revokedByName: undefined,
  };
  client.workspaceIsActive = true;
  client.deactivatedAt = null;
  client.deactivationReason = undefined;
  client.markModified("accessOverride");
  await client.save();

  const reactivatedInvoices = await markInvoicesReactivated(client._id, now);

  await AuditLog.create({
    action: "client.accessGranted",
    entity: "Client",
    entityId: client._id.toString(),
    userId: toObjectId(user?._id),
    userName: actorName(user),
    level: "warn",
    meta: {
      workspaceId: client.workspaceId,
      reason,
      until,
      overdueAmount: status.overdueAmount,
      maxDaysOverdue: status.maxDaysOverdue,
      reactivatedInvoices,
      shouldBeClosed: status.shouldBeClosed,
    },
  });

  await emailService
    .sendAccessGranted({
      client,
      reason,
      until,
      overdueAmount: status.overdueAmount,
      daysOverdue: status.maxDaysOverdue,
      grantedByName: actorName(user),
    })
    .catch((error) =>
      console.error("[access] Falló el aviso de acceso abierto:", (error as Error).message)
    );

  return {
    client,
    reactivatedInvoices,
    overdueAmount: status.overdueAmount,
    maxDaysOverdue: status.maxDaysOverdue,
    until,
    message: "Acceso abierto por excepción. El espacio queda marcado como que debería estar cerrado.",
  };
}

/** Apaga la excepción y, si el cliente sigue en mora, vuelve a cerrar el espacio. */
async function revokeAccess(clientId: string, input: RevokeAccessInput = {}, user?: JwtPayload) {
  const client = await findClient(clientId);

  if (!client.accessOverride?.enabled) {
    throw new CustomError("Este cliente no tiene una excepción de acceso activa.", 400);
  }

  const status = await accessStatusFor(client._id);
  const now = new Date();
  const stillOverdue = status.overdueInvoices > 0;
  const shouldClose = input.closeWorkspace !== false && stillOverdue && Boolean(client.workspaceId);
  const reason = `Excepción de acceso revocada por ${actorName(user)}`;

  if (shouldClose && client.workspaceId) {
    await metricsService.setWorkspaceActive(client.workspaceId, false, reason);
    client.workspaceIsActive = false;
    client.deactivatedAt = now;
    client.deactivationReason = reason;
  }

  client.accessOverride = closedOverride(client.accessOverride, now, actorName(user));
  client.markModified("accessOverride");
  await client.save();

  await AuditLog.create({
    action: "client.accessRevoked",
    entity: "Client",
    entityId: client._id.toString(),
    userId: toObjectId(user?._id),
    userName: actorName(user),
    level: "warn",
    meta: {
      workspaceId: client.workspaceId,
      closedWorkspace: shouldClose,
      stillOverdue,
      overdueAmount: status.overdueAmount,
      maxDaysOverdue: status.maxDaysOverdue,
    },
  });

  await emailService
    .sendAccessRevoked({ client, closedWorkspace: shouldClose })
    .catch((error) =>
      console.error("[access] Falló el aviso de excepción revocada:", (error as Error).message)
    );

  return {
    client,
    closedWorkspace: shouldClose,
    stillOverdue,
    overdueAmount: status.overdueAmount,
    message: shouldClose
      ? "Excepción revocada y espacio de trabajo cerrado."
      : "Excepción revocada. El espacio de trabajo quedó como estaba.",
  };
}

export const accessService = {
  grantAccess,
  revokeAccess,
  listOverrides: listAccessOverrides,
  isOverrideActive,
};

export { isOverrideActive, listAccessOverrides as listOverrides };
export type { AccessOverrideRow } from "./access.status.service";
