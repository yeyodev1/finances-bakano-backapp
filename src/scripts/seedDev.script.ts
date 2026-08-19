import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { env } from "../config/env";
import { Client, Invoice, Payment, PaymentSubmission, StripeEvent, User } from "../models";
import { toPeriod, addMonthsToPeriod, dayToDate } from "../utils/date.util";

/**
 * Datos falsos para el entorno de develop. Deja la base lista para probar el
 * flujo completo: clientes con facturas abiertas (para Checkout y comprobantes),
 * nombres que calzan con los customers de la cuenta test de Stripe (para el
 * import con sugerencias) y montos iguales a los cargos test (37/67/17 USD).
 */

const GUARD = "-dev";

interface SeedClient {
  name: string;
  amount: number;
  collectionDay: number;
  workspaceId?: string;
  monthsBack: number;
  leaveOpen: boolean;
}

const CLIENTS: SeedClient[] = [
  // Calza por nombre con los customers "diego reyes" de la cuenta test de Stripe.
  { name: "Diego Reyes Agencia", amount: 37, collectionDay: 15, workspaceId: "dev-ws-diego", monthsBack: 3, leaveOpen: true },
  // Calza con "wingman-test..." por tokens.
  { name: "Wingman Test", amount: 67, collectionDay: 1, workspaceId: "dev-ws-wingman", monthsBack: 2, leaveOpen: true },
  { name: "La Parrilla del Puerto", amount: 250, collectionDay: 8, workspaceId: "dev-ws-parrilla", monthsBack: 4, leaveOpen: true },
  { name: "Clínica Sonrisa", amount: 400, collectionDay: 23, workspaceId: "dev-ws-sonrisa", monthsBack: 2, leaveOpen: false },
  { name: "Ferretería El Tornillo", amount: 180, collectionDay: 5, monthsBack: 1, leaveOpen: true },
];

async function run() {
  await dbConnect();

  const dbName = mongoose.connection.name || "";
  if (!env.dbUri.includes(GUARD) && !dbName.includes(GUARD)) {
    console.error(
      `[seedDev] ABORTADO: la base "${dbName}" no parece de develop (falta "${GUARD}" en el nombre o en DB_URI). Este seed BORRA datos.`
    );
    process.exit(1);
  }

  console.log(`[seedDev] Sembrando la base "${dbName}"…`);

  await Promise.all([
    Client.deleteMany({}),
    Invoice.deleteMany({}),
    Payment.deleteMany({}),
    PaymentSubmission.deleteMany({}),
    StripeEvent.deleteMany({}),
  ]);

  // Login de develop: mismo superadmin que producción pero en base aparte.
  const email = env.seedAdmin.email.toLowerCase().trim();
  if (env.seedAdmin.password && !(await User.findOne({ email }))) {
    await User.create({
      name: env.seedAdmin.name,
      email,
      password: env.seedAdmin.password,
      role: "superadmin",
      isActive: true,
      receivesNotifications: true,
    });
    console.log(`[seedDev] Superadmin creado: ${email}`);
  }

  const currentPeriod = toPeriod();

  for (const seed of CLIENTS) {
    const client = await Client.create({
      name: seed.name,
      amount: seed.amount,
      collectionDay: seed.collectionDay,
      billingType: "monthly",
      paymentMethod: "transferencia",
      workspaceId: seed.workspaceId || null,
      notes: "Cliente de prueba (seed de develop)",
    });

    for (let back = seed.monthsBack; back >= 0; back -= 1) {
      const period = addMonthsToPeriod(currentPeriod, -back);
      const dueDate = dayToDate(period, seed.collectionDay);
      const isCurrent = back === 0;
      const leaveOpen = isCurrent && seed.leaveOpen;

      const invoice = await Invoice.create({
        clientId: client._id,
        clientName: client.name,
        period,
        amount: seed.amount,
        currency: "USD",
        paidAmount: leaveOpen ? 0 : seed.amount,
        issueDate: dayToDate(period, 1),
        dueDate,
        originalDueDate: dueDate,
        status: leaveOpen ? (dueDate < new Date() ? "overdue" : "pending") : "paid",
        paidAt: leaveOpen ? null : dueDate,
      });

      if (!leaveOpen) {
        await Payment.create({
          invoiceId: invoice._id,
          clientId: client._id,
          clientName: client.name,
          period,
          amount: seed.amount,
          currency: "USD",
          paidAt: dueDate,
          method: "transferencia",
          source: "manual",
          registeredByName: "Seed develop",
        });
      }
    }

    console.log(`[seedDev] ${seed.name}: ${seed.monthsBack + 1} factura(s), abierta: ${seed.leaveOpen}`);
  }

  const [clients, invoices, payments] = await Promise.all([
    Client.countDocuments(),
    Invoice.countDocuments(),
    Payment.countDocuments(),
  ]);
  console.log(`[seedDev] Listo: ${clients} clientes, ${invoices} facturas, ${payments} pagos.`);

  await mongoose.connection.close();
  process.exit(0);
}

run().catch(async (error) => {
  console.error("[seedDev] Error:", error);
  await mongoose.connection.close().catch(() => undefined);
  process.exit(1);
});
