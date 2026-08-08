import cron from "node-cron";
import { env } from "../config/env";
import { AuditLog, Client, IClient, IInvoice, Invoice } from "../models";
import { addDays, addMonthsToPeriod, endOfDay, startOfDay, toPeriod } from "../utils/date.util";
import { settingsService } from "./settings.service";
import { emailService } from "./email.service";
import { invoiceService } from "./invoice.service";
import { stepDeactivations, stepExpiredOverrides } from "./scheduler.access";

export interface DailyJobSummary {
  startedAt: Date;
  finishedAt?: Date;
  recalculated: number;
  remindersSent: number;
  overdueAlerts: number;
  warnings: number;
  deactivated: number;
  /** Clientes que el cron NO cerró porque tienen una excepción de acceso vigente. */
  skippedByOverride: number;
  /** Excepciones que vencieron hoy y se apagaron. */
  expiredOverrides: number;
  errors: string[];
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86400000);
}

async function loadClient(invoice: IInvoice): Promise<IClient | null> {
  return Client.findById(invoice.clientId);
}

/** Los clientes dados de baja quedan fuera de recordatorios, mora y auto-desactivación. */
async function archivedClientIds(): Promise<unknown[]> {
  const rows = await Client.find({ isArchived: true }).select("_id").lean();
  return rows.map((row) => row._id);
}

async function stepRecalc(summary: DailyJobSummary) {
  try {
    const result = await invoiceService.recalcStatuses();
    summary.recalculated = result?.updated ?? 0;
  } catch (error) {
    summary.errors.push(`recalcStatuses: ${(error as Error).message}`);
  }
}

async function stepReminders(
  summary: DailyJobSummary,
  reminderDaysBefore: number,
  excluded: unknown[]
) {
  try {
    const target = addDays(new Date(), reminderDaysBefore);
    const invoices = await Invoice.find({
      status: { $in: ["pending", "partial"] },
      reminderSentAt: null,
      clientId: { $nin: excluded },
      dueDate: { $gte: startOfDay(target), $lte: endOfDay(target) },
    });

    for (const invoice of invoices) {
      try {
        const client = await loadClient(invoice);
        const result = await emailService.sendReminderBeforeDue({
          invoice,
          client,
          daysBefore: reminderDaysBefore,
        });
        invoice.reminderSentAt = new Date();
        await invoice.save();
        if (result.sent) summary.remindersSent += 1;
      } catch (error) {
        summary.errors.push(`reminder ${invoice._id}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    summary.errors.push(`reminders: ${(error as Error).message}`);
  }
}

async function stepOverdue(summary: DailyJobSummary, excluded: unknown[]) {
  try {
    const invoices = await Invoice.find({
      status: "overdue",
      overdueNotifiedAt: null,
      clientId: { $nin: excluded },
    });

    for (const invoice of invoices) {
      try {
        const client = await loadClient(invoice);
        const result = await emailService.sendOverdueAlert({
          invoice,
          client,
          daysOverdue: Math.max(daysBetween(invoice.dueDate, new Date()), 0),
        });
        invoice.overdueNotifiedAt = new Date();
        await invoice.save();
        if (result.sent) summary.overdueAlerts += 1;
      } catch (error) {
        summary.errors.push(`overdue ${invoice._id}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    summary.errors.push(`overdueAlerts: ${(error as Error).message}`);
  }
}

async function stepWarnings(
  summary: DailyJobSummary,
  graceDays: number,
  warnBeforeDeactivationDays: number,
  excluded: unknown[]
) {
  try {
    const invoices = await Invoice.find({
      status: "overdue",
      "deactivation.warnedAt": null,
      "deactivation.deactivatedAt": null,
      clientId: { $nin: excluded },
    });

    for (const invoice of invoices) {
      try {
        const client = await loadClient(invoice);
        const clientGrace = client?.graceDays ?? graceDays;
        const threshold = Math.max(clientGrace - warnBeforeDeactivationDays, 0);
        const daysOverdue = Math.max(daysBetween(invoice.dueDate, new Date()), 0);

        if (daysOverdue < threshold) continue;

        const result = await emailService.sendOverdueAlert({
          invoice,
          client,
          daysOverdue,
          deactivationInDays: Math.max(clientGrace - daysOverdue, 0),
        });

        invoice.deactivation.warnedAt = new Date();
        invoice.markModified("deactivation");
        await invoice.save();
        if (result.sent) summary.warnings += 1;
      } catch (error) {
        summary.errors.push(`warning ${invoice._id}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    summary.errors.push(`warnings: ${(error as Error).message}`);
  }
}

async function runDailyJob(): Promise<DailyJobSummary> {
  const summary: DailyJobSummary = {
    startedAt: new Date(),
    recalculated: 0,
    remindersSent: 0,
    overdueAlerts: 0,
    warnings: 0,
    deactivated: 0,
    skippedByOverride: 0,
    expiredOverrides: 0,
    errors: [],
  };

  console.log("[cron] Iniciando job diario de cobranzas");

  const settings = await settingsService.getNotificationSettings();
  const excluded = await archivedClientIds();

  await stepRecalc(summary);
  await stepReminders(summary, settings.reminderDaysBefore, excluded);
  await stepOverdue(summary, excluded);
  await stepWarnings(
    summary,
    settings.graceDays,
    settings.warnBeforeDeactivationDays,
    excluded
  );

  await stepExpiredOverrides(summary);

  if (settings.autoDeactivateEnabled) {
    await stepDeactivations(summary, settings.graceDays, excluded);
  } else {
    console.log("[cron] Auto-desactivación deshabilitada en configuración");
  }

  summary.finishedAt = new Date();

  try {
    await AuditLog.create({
      action: "cron.dailyJob",
      entity: "Job",
      level: summary.errors.length ? "warn" : "info",
      meta: { ...summary },
    });
  } catch {
    console.error("[cron] No se pudo registrar el AuditLog del job diario");
  }

  console.log("[cron] Job diario finalizado:", JSON.stringify(summary));
  return summary;
}

export interface MonthlyJobSummary {
  period: string;
  previousPeriod: string;
  generated: unknown;
  summarySent: boolean;
  errors: string[];
}

async function runMonthlyJob(): Promise<MonthlyJobSummary> {
  const period = toPeriod();
  const previousPeriod = addMonthsToPeriod(period, -1);
  const result: MonthlyJobSummary = {
    period,
    previousPeriod,
    generated: null,
    summarySent: false,
    errors: [],
  };

  console.log(`[cron] Iniciando job mensual · genera ${period} · resume ${previousPeriod}`);

  try {
    result.generated = await invoiceService.generateForPeriod(period);
  } catch (error) {
    result.errors.push(`generateForPeriod: ${(error as Error).message}`);
  }

  try {
    const sendResult = await emailService.sendMonthlySummary({ period: previousPeriod });
    result.summarySent = Boolean(sendResult.sent);
  } catch (error) {
    result.errors.push(`sendMonthlySummary: ${(error as Error).message}`);
  }

  try {
    await AuditLog.create({
      action: "cron.monthlyJob",
      entity: "Job",
      level: result.errors.length ? "warn" : "info",
      meta: { ...result },
    });
  } catch {
    console.error("[cron] No se pudo registrar el AuditLog del job mensual");
  }

  console.log("[cron] Job mensual finalizado:", JSON.stringify(result));
  return result;
}

const DAILY_EXPRESSION = "0 8 * * *";
const MONTHLY_EXPRESSION = "5 1 1 * *";

function startSchedulers() {
  if (!env.cronEnabled) {
    console.log("[cron] Schedulers deshabilitados (CRON_ENABLED=false)");
    return;
  }

  cron.schedule(
    DAILY_EXPRESSION,
    () => {
      runDailyJob().catch((error) =>
        console.error("[cron] Error no controlado en el job diario:", error)
      );
    },
    { timezone: env.timezone }
  );

  cron.schedule(
    MONTHLY_EXPRESSION,
    () => {
      runMonthlyJob().catch((error) =>
        console.error("[cron] Error no controlado en el job mensual:", error)
      );
    },
    { timezone: env.timezone }
  );

  console.log(
    `[cron] Programado job diario "${DAILY_EXPRESSION}" y job mensual "${MONTHLY_EXPRESSION}" (zona horaria: ${env.timezone})`
  );
}

export const schedulerService = {
  runDailyJob,
  runMonthlyJob,
  startSchedulers,
};

export { startSchedulers };
