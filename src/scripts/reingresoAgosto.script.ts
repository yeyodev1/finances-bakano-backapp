import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { env } from "../config/env";
import { Client, ClientCategory, Sale, User } from "../models";
import { clientCategoryService } from "../services/clientCategory.service";
import { invoiceGenerationService } from "../services/invoice.generation.service";
import { buildSchedule } from "../services/sale.service";
import { normalizeText } from "../utils/similarity.util";

/**
 * Reingreso de los clientes de agosto 2026 borrados el 24 de agosto.
 *
 * Vuelve a cargar cada ficha con sus fechas reales (`startDate` en agosto) y
 * registra por cada una la venta en Ventas con `agreedAt` en agosto, para que el
 * objetivo del mes anterior los muestre. Idempotente: si el cliente o la venta
 * ya existen (por nombre, workspace o customer de Stripe) no se duplican.
 *
 *   pnpm reingreso:agosto -- --dry-run
 *   pnpm reingreso:agosto -- --seller=vendedora@bakano.ec --owner=dreyes@bakano.ec
 *
 * S&K queda fuera a propósito: era un duplicado consolidado en "Método SK".
 * Los pagos que tenían antes del borrado no se recrean (no están en el respaldo
 * disponible): se listan al final para registrarlos a mano en Cobros del mes.
 */

interface Entry {
  name: string;
  legalName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  amount: number;
  issueDay: number | null;
  collectionDay: number | null;
  paymentMethod: "transferencia" | "stripe";
  splits?: Array<{ label?: string; amount: number; day: number | null }>;
  tags?: string[];
  notes?: string;
  workspaceId: string;
  workspaceName: string;
  categoryName?: string;
  startDate: string;
  stripeCustomerId: string;
  stripeCustomerIds: string[];
  /** Cuántos pagos tenía antes del borrado (para avisar, no se recrean). */
  hadPayments: number;
  /** Cuándo vence el primer cobro si no coincide con la fecha de ingreso. */
  firstChargeDate?: string;
  previousId: string;
}

const PERIODS = ["2026-08", "2026-09"];

const ENTRIES: Entry[] = [
  {
    name: "DISKRET",
    contactName: "Julian Torres",
    contactEmail: "juliantorresp@gmail.com",
    contactPhone: "0939761147",
    amount: 350,
    issueDay: 1,
    collectionDay: 5,
    paymentMethod: "transferencia",
    tags: ["Remodelación de casas"],
    workspaceId: "6a763d73b8df726326dc43b2",
    workspaceName: "CONSTRUCTORA ELITE",
    startDate: "2026-08-05T00:00:00.000Z",
    stripeCustomerId: "cus_V61WseASJ3MNRc",
    stripeCustomerIds: ["cus_V61WseASJ3MNRc", "cus_V18pl4k6uEQf2p"],
    hadPayments: 0,
    previousId: "6a7df2c11dac2d84cb441c21",
  },
  {
    name: "DKC",
    contactName: "Oscar Ugarte",
    contactEmail: "ougarte@courierboxlogistics.com",
    contactPhone: "0985099796",
    amount: 350,
    issueDay: 1,
    collectionDay: 5,
    paymentMethod: "transferencia",
    tags: ["Estudio de uñas y cabello"],
    workspaceId: "6a7df4077e00fd34f1b92be0",
    workspaceName: "DKC",
    startDate: "2026-08-12T00:00:00.000Z",
    stripeCustomerId: "cus_V3miIPKvbBQLul",
    stripeCustomerIds: ["cus_V3miIPKvbBQLul"],
    hadPayments: 1,
    previousId: "6a7df4071dac2d84cb441c3f",
  },
  {
    name: "DMADEIRA",
    legalName: "DMadeira",
    contactName: "Alejandro Chavez",
    contactEmail: "facturasdm2625@gmail.com",
    contactPhone: "099 522 1891",
    amount: 500,
    issueDay: 12,
    collectionDay: 26,
    paymentMethod: "stripe",
    workspaceId: "6a7dfb098187fd55c1e27350",
    workspaceName: "DMADEIRA",
    startDate: "2026-08-11T00:00:00.000Z",
    stripeCustomerId: "cus_V3pvwLLGcLTODr",
    stripeCustomerIds: ["cus_V3pvwLLGcLTODr"],
    hadPayments: 1,
    previousId: "6a7cd0f0dd758db0ccbfbcfb",
  },
  {
    name: "DONATUS",
    contactName: "Julio Zamora",
    contactEmail: "infodonatusec@gmail.com",
    contactPhone: "0987466399",
    amount: 500,
    issueDay: 1,
    collectionDay: 5,
    paymentMethod: "transferencia",
    tags: ["Pastelería"],
    workspaceId: "6a720a92a7e17dfcf4daff29",
    workspaceName: "Donatus",
    startDate: "2026-08-04T00:00:00.000Z",
    stripeCustomerId: "cus_V4CWpiHUJJaZkC",
    stripeCustomerIds: ["cus_V4CWpiHUJJaZkC"],
    hadPayments: 0,
    previousId: "6a7df1f3c25f26a4fbac8b2a",
  },
  {
    name: "DOX",
    contactName: "David Ricaurte",
    contactEmail: "david@dox-ec.com",
    contactPhone: "0999901752",
    amount: 500,
    issueDay: 27,
    collectionDay: 15,
    paymentMethod: "transferencia",
    splits: [
      { label: "Pago 1", amount: 250, day: null },
      { label: "Pago 2", amount: 250, day: 15 },
    ],
    tags: ["Alquiler de impresoras"],
    notes: "Dos pagos 250",
    workspaceId: "6a6cf87dd02252fdeb4ac89e",
    workspaceName: "DOX",
    categoryName: "Alquiler de impresoras",
    startDate: "2026-08-27T00:00:00.000Z",
    stripeCustomerId: "cus_V4bDnv8UfjiPbF",
    stripeCustomerIds: ["cus_V4bDnv8UfjiPbF"],
    hadPayments: 0,
    previousId: "6a776e2e620c78720cb9f73d",
  },
  {
    name: "Ezi productos de Limpieza",
    legalName: "Laboratorios Ezi",
    contactName: "Vanessa Corral",
    contactEmail: "vanessacorralec@gmail.com",
    contactPhone: "099 304 4930",
    amount: 500,
    issueDay: 13,
    collectionDay: 27,
    paymentMethod: "stripe",
    workspaceId: "6a7defac7e00fd34f1b92ba2",
    workspaceName: "Ezi productos de Limpieza",
    startDate: "2026-08-12T00:00:00.000Z",
    stripeCustomerId: "cus_V49MfcEdAawl9Q",
    stripeCustomerIds: ["cus_V49MfcEdAawl9Q", "cus_V6T5Pp48JIoKnh"],
    hadPayments: 1,
    previousId: "6a7defabc25f26a4fbac8ac4",
  },
  {
    name: "Frico Fergus",
    legalName: "Frico Fergus",
    contactName: "Titi Orrantia",
    contactEmail: "fricofergus@gmail.com",
    contactPhone: "0997802669",
    amount: 500,
    issueDay: 15,
    collectionDay: 15,
    paymentMethod: "transferencia",
    workspaceId: "6a80953577b1949088400c08",
    workspaceName: "Frico Fergus",
    categoryName: "Restaurante",
    startDate: "2026-08-14T00:00:00.000Z",
    stripeCustomerId: "cus_V4cq9lfYWQOL4x",
    stripeCustomerIds: ["cus_V4cq9lfYWQOL4x"],
    hadPayments: 1,
    previousId: "6a809534d057934ab7040e0c",
  },
  {
    name: "GearCore",
    contactName: "Jaime Dueñas",
    contactEmail: "jedi6389@hotmail.com",
    contactPhone: "0969839765",
    amount: 500,
    issueDay: null,
    collectionDay: 15,
    paymentMethod: "transferencia",
    tags: ["Instalación de internet"],
    workspaceId: "6a6b5ced1423c3a382bb3747",
    workspaceName: "Gearcore",
    startDate: "2026-08-15T00:00:00.000Z",
    stripeCustomerId: "cus_V0THMKqJ1gBVdx",
    stripeCustomerIds: ["cus_V0THMKqJ1gBVdx", "cus_UyF7MLJhazhWYy"],
    hadPayments: 0,
    previousId: "6a776e2d620c78720cb9f734",
  },
  {
    name: "Karla Jimenez",
    contactName: "Karla Jimenez",
    contactEmail: "karlajimenez11@gmail.com",
    contactPhone: "0994709294",
    amount: 300,
    issueDay: 1,
    collectionDay: 5,
    paymentMethod: "transferencia",
    tags: ["Marca personal"],
    workspaceId: "6a760d5de5dd794bbdc01977",
    workspaceName: "KARLA JIMENEZ",
    startDate: "2026-08-05T00:00:00.000Z",
    stripeCustomerId: "cus_V66lp0kySxF2B3",
    stripeCustomerIds: ["cus_V66lp0kySxF2B3", "cus_V1Dtjzjaxh2UTS"],
    hadPayments: 0,
    previousId: "6a7df270c25f26a4fbac8b40",
  },
  {
    name: "Método SK",
    contactName: "Karen Lopez",
    contactEmail: "nutricionistakarenlopez@gmail.com",
    amount: 350,
    issueDay: null,
    collectionDay: 3,
    paymentMethod: "stripe",
    notes: "Nutricionista. Paga por suscripción de Stripe ($350/mes, cobra el 3).",
    workspaceId: "6a8618b8f1a34d7bf1bc5c6e",
    workspaceName: "Método SK",
    startDate: "2026-08-19T20:57:27.945Z",
    stripeCustomerId: "cus_V0UZfZtiiig6xt",
    stripeCustomerIds: ["cus_V0UZfZtiiig6xt"],
    hadPayments: 1,
    previousId: "6a8618b715cdbc4a39da3cb1",
  },
  {
    name: "Rigel S.A",
    legalName: "Rigel S.A",
    contactName: "Juan Hurtado",
    contactEmail: "contable@rigelsa.com",
    contactPhone: "+593 99 595 4964",
    amount: 350,
    issueDay: 12,
    collectionDay: 25,
    paymentMethod: "transferencia",
    tags: ["Impresoras de etiquetas con información"],
    notes: "$350 El primer pago es a las 6 semanas de ingreso. Ingresó el día 12 Ago",
    workspaceId: "6a7f163b730909f519b77513",
    workspaceName: "Rigel",
    startDate: "2026-08-10T00:00:00.000Z",
    stripeCustomerId: "cus_V64rmKTnkqhicP",
    stripeCustomerIds: ["cus_V64rmKTnkqhicP"],
    hadPayments: 0,
    // Seis semanas después del ingreso (12 ago).
    firstChargeDate: "2026-09-23T00:00:00.000Z",
    previousId: "6a7c8147fb6de1efda8eddf4",
  },
  {
    name: "SASHA PET",
    amount: 500,
    issueDay: 1,
    collectionDay: 5,
    paymentMethod: "transferencia",
    tags: ["Veterinaria Spa"],
    workspaceId: "6a84841556455800663f5d68",
    workspaceName: "SASHA PET",
    startDate: "2026-08-17T00:00:00.000Z",
    stripeCustomerId: "cus_V5iq6YNSbd1caY",
    stripeCustomerIds: ["cus_V5iq6YNSbd1caY", "cus_V5icm29wHfih55"],
    hadPayments: 1,
    previousId: "6a8484144b3b74992b3abf55",
  },
];

const NOTE = "Reingreso de agosto 2026 (respaldo del borrado del 24 ago)";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const DRY = process.argv.includes("--dry-run");

async function findUser(email: string, label: string) {
  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) throw new Error(`${label} no existe: ${email}`);
  return user;
}

async function findExistingClient(entry: Entry) {
  const byLink = await Client.findOne({
    $or: [{ workspaceId: entry.workspaceId }, { stripeCustomerIds: { $in: entry.stripeCustomerIds } }],
  });
  if (byLink) return byLink;
  const wanted = normalizeText(entry.name);
  const all = await Client.find({}).select("name legalName");
  const hit = all.find((c) => normalizeText(c.name) === wanted);
  return hit ? Client.findById(hit._id) : null;
}

async function resolveCategory(
  name?: string
): Promise<{ _id: mongoose.Types.ObjectId; name: string } | null> {
  if (!name) return null;
  const all = await ClientCategory.find({});
  const hit = all.find((c) => normalizeText(c.name) === normalizeText(name));
  if (hit) return { _id: hit._id, name: hit.name };
  if (DRY) return { _id: new mongoose.Types.ObjectId(), name };
  const created = await clientCategoryService.create({ name });
  return { _id: created._id, name: created.name };
}

async function run() {
  await dbConnect();
  console.log(
    `[reingreso] Base: ${mongoose.connection.name}${DRY ? " (DRY RUN: no escribe nada)" : ""}`
  );

  const sellerEmail = arg("seller") || env.seedAdmin.email;
  const ownerEmail = arg("owner") || sellerEmail;
  const seller = await findUser(sellerEmail, "El vendedor (--seller)");
  const owner = await findUser(ownerEmail, "El responsable de cobro (--owner)");
  console.log(`[reingreso] Ventas a nombre de ${seller.name}; cobra ${owner.name}.`);

  const created: string[] = [];
  const skipped: string[] = [];
  const salesCreated: string[] = [];
  const pendingPayments: string[] = [];

  for (const entry of ENTRIES) {
    let client = await findExistingClient(entry);
    const category = await resolveCategory(entry.categoryName);

    if (client) {
      skipped.push(`${entry.name} (ya existe como "${client.name}")`);
    } else if (DRY) {
      created.push(`${entry.name} → se crearía`);
    } else {
      client = await Client.create({
        name: entry.name,
        legalName: entry.legalName,
        contactName: entry.contactName,
        contactEmail: entry.contactEmail,
        contactPhone: entry.contactPhone,
        amount: entry.amount,
        currency: "USD",
        issueDay: entry.issueDay,
        collectionDay: entry.collectionDay,
        paymentMethod: entry.paymentMethod,
        billingType: "monthly",
        splits: entry.splits ?? [],
        tags: entry.tags ?? [],
        notes: [entry.notes, `${NOTE}. ID anterior: ${entry.previousId}.`].filter(Boolean).join(" "),
        workspaceId: entry.workspaceId,
        workspaceName: entry.workspaceName,
        workspaceLinkedAt: new Date(),
        workspaceIsActive: true,
        categoryId: category?._id ?? null,
        categoryName: category?.name ?? null,
        startDate: new Date(entry.startDate),
        stripeCustomerId: entry.stripeCustomerId,
        stripeCustomerIds: entry.stripeCustomerIds,
        autoDeactivate: true,
        isActive: true,
        createdBy: seller._id,
      });
      created.push(entry.name);
    }

    if (!client) continue;

    // Cobros de agosto y septiembre: el job del día 1 no los conocía. Idempotente.
    if (!DRY) {
      for (const period of PERIODS) {
        const result = await invoiceGenerationService.generateForPeriod(period, {
          clientIds: [client._id.toString()],
        });
        if (result.created) console.log(`  · ${entry.name}: cobro ${period} generado`);
      }
    }

    // La venta de agosto, una sola vez por cliente.
    const wanted = normalizeText(entry.name);
    const sales = await Sale.find({ status: { $ne: "perdida" } }).select("businessName clientId");
    const clientId = client._id.toString();
    const existingSale = sales.find(
      (s) => String(s.clientId) === clientId || normalizeText(s.businessName) === wanted
    );
    if (existingSale) {
      console.log(`  · ${entry.name}: ya tiene venta registrada, no se duplica`);
    } else if (!DRY) {
      const agreedAt = new Date(entry.startDate);
      const firstChargeDate = entry.firstChargeDate ? new Date(entry.firstChargeDate) : agreedAt;
      await Sale.create({
        businessName: entry.name,
        clientId: client._id,
        categoryId: category?._id ?? null,
        categoryName: category?.name ?? null,
        contactName: entry.contactName,
        contactEmail: entry.contactEmail,
        contactPhone: entry.contactPhone,
        amount: entry.amount,
        items: [{ concept: "Mensualidad", kind: "recurrente", amount: entry.amount }],
        billing: { needsInvoice: false },
        currency: "USD",
        frequency: "unico",
        installmentsCount: 1,
        firstChargeDate,
        installments: buildSchedule(entry.amount, "unico", 1, firstChargeDate),
        soldBy: seller._id,
        soldByName: seller.name,
        ownerId: owner._id,
        ownerName: owner.name,
        agreedAt,
        status: "acordada",
        notes: `${NOTE}. Vendedor por confirmar.`,
        createdBy: seller._id,
        history: [
          {
            action: "created",
            detail: `Venta de agosto reingresada (${entry.amount} USD, ingresó ${entry.startDate.slice(0, 10)})`,
            at: new Date(),
            by: seller._id,
            byName: seller.name,
            meta: { reingreso: true, previousClientId: entry.previousId },
          },
        ],
      });
      salesCreated.push(entry.name);
    } else {
      salesCreated.push(`${entry.name} → se crearía`);
    }

    if (entry.hadPayments > 0) pendingPayments.push(`${entry.name} (${entry.hadPayments} pago)`);
  }

  console.log("\n[reingreso] Clientes creados:", created.length ? created.join(", ") : "ninguno");
  console.log("[reingreso] Ya existían:", skipped.length ? skipped.join(", ") : "ninguno");
  console.log(
    "[reingreso] Ventas de agosto:",
    salesCreated.length ? salesCreated.join(", ") : "ninguna nueva"
  );
  console.log(
    "[reingreso] Tenían pagos antes del borrado (regístralos en Cobros del mes):",
    pendingPayments.join(", ")
  );
  console.log("[reingreso] S&K no se recarga: duplicado consolidado en Método SK.");

  await mongoose.connection.close();
  process.exit(0);
}

run().catch(async (error) => {
  console.error("[reingreso] Error:", error);
  await mongoose.connection.close().catch(() => undefined);
  process.exit(1);
});
