import { AuditLog, Client, IClient, IInvoice, Invoice } from "../models";
import { startOfDay } from "../utils/date.util";
import { emailService } from "./email.service";
import { metricsService } from "./metrics.service";
import { closedOverride, isOverrideActive } from "./access.status.service";

export interface DeactivationCounters {
  deactivated: number;
  skippedByOverride: number;
  expiredOverrides: number;
  errors: string[];
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86400000);
}

/**
 * Excepciones vencidas: apaga la excepción y, si el cliente sigue en mora, cierra el
 * espacio y avisa por correo que se cerró porque venció la excepción.
 * Corre ANTES del paso de auto-desactivación.
 */
export async function stepExpiredOverrides(summary: DeactivationCounters) {
  try {
    const now = new Date();
    const clients = await Client.find({
      "accessOverride.enabled": true,
      "accessOverride.until": { $ne: null, $lte: now },
    });

    for (const client of clients) {
      try {
        const overdue = await Invoice.findOne({ clientId: client._id, status: "overdue" }).sort({
          dueDate: 1,
        });
        const stillOverdue = Boolean(overdue);
        const reason = `Venció la excepción de acceso abierto (${client.accessOverride?.reason || "sin motivo"})`;

        client.accessOverride = closedOverride(
          client.accessOverride,
          now,
          "Proceso automático (excepción vencida)"
        );
        client.markModified("accessOverride");

        if (stillOverdue && client.workspaceId) {
          await metricsService.setWorkspaceActive(client.workspaceId, false, reason);
          client.workspaceIsActive = false;
          client.deactivatedAt = now;
          client.deactivationReason = reason;
        }

        await client.save();

        if (stillOverdue && overdue) {
          overdue.deactivation.deactivatedAt = now;
          overdue.deactivation.reason = reason;
          overdue.markModified("deactivation");
          await overdue.save();

          await emailService.sendWorkspaceDeactivated({ client, invoice: overdue, reason });
        }

        await AuditLog.create({
          action: "client.accessOverrideExpired",
          entity: "Client",
          entityId: client._id.toString(),
          level: "warn",
          meta: {
            workspaceId: client.workspaceId,
            reason,
            stillOverdue,
            closedWorkspace: stillOverdue && Boolean(client.workspaceId),
          },
        });

        summary.expiredOverrides += 1;
      } catch (error) {
        summary.errors.push(`expiredOverride ${client._id}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    summary.errors.push(`expiredOverrides: ${(error as Error).message}`);
  }
}

async function loadClient(invoice: IInvoice): Promise<IClient | null> {
  return Client.findById(invoice.clientId);
}

/** Auto-desactivación por mora. Los clientes con excepción vigente se saltan y se cuentan. */
export async function stepDeactivations(
  summary: DeactivationCounters,
  graceDays: number,
  excluded: unknown[]
) {
  try {
    const invoices = await Invoice.find({
      status: "overdue",
      "deactivation.deactivatedAt": null,
      clientId: { $nin: excluded },
    });

    const now = new Date();

    for (const invoice of invoices) {
      try {
        const client = await loadClient(invoice);
        if (!client || client.isArchived) continue;
        if (!client.autoDeactivate || !client.workspaceId) continue;

        if (isOverrideActive(client, now)) {
          summary.skippedByOverride += 1;
          continue;
        }

        const clientGrace = client.graceDays ?? graceDays;
        const daysOverdue = Math.max(daysBetween(invoice.dueDate, new Date()), 0);
        if (daysOverdue <= clientGrace) continue;

        const reason = `Falta de pago del período ${invoice.period} (${daysOverdue} días de mora)`;

        await metricsService.setWorkspaceActive(client.workspaceId, false, reason);

        invoice.deactivation.deactivatedAt = new Date();
        invoice.deactivation.reason = reason;
        invoice.markModified("deactivation");
        await invoice.save();

        client.workspaceIsActive = false;
        client.deactivatedAt = new Date();
        client.deactivationReason = reason;
        await client.save();

        await emailService.sendWorkspaceDeactivated({ client, invoice, reason });

        await AuditLog.create({
          action: "workspace.autoDeactivated",
          entity: "Client",
          entityId: client._id.toString(),
          level: "warn",
          meta: {
            workspaceId: client.workspaceId,
            invoiceId: invoice._id.toString(),
            period: invoice.period,
            daysOverdue,
            reason,
          },
        });

        summary.deactivated += 1;
      } catch (error) {
        summary.errors.push(`deactivation ${invoice._id}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    summary.errors.push(`deactivations: ${(error as Error).message}`);
  }
}
