import mongoose from "mongoose";
import "../config/env";
import { dbConnect } from "../config/mongo";
import { Client } from "../models";
import { clientsSeed } from "../data/clients.seed";
import { PAYMENT_METHOD_LABELS } from "../types/finance.types";

async function run() {
  await dbConnect();

  let created = 0;
  let updated = 0;
  const rows: Record<string, string | number>[] = [];

  for (const seed of clientsSeed) {
    const payload = {
      name: seed.name,
      amount: seed.amount,
      currency: "USD",
      issueDay: seed.issueDay,
      collectionDay: seed.collectionDay,
      collectionDayLabel: seed.collectionDayLabel || "",
      paymentMethod: seed.paymentMethod,
      billingType: seed.billingType || "monthly",
      autoDeactivate: seed.autoDeactivate ?? true,
      splits: seed.splits || [],
      notes: seed.notes || "",
      isActive: true,
    };

    const existing = await Client.findOne({ name: seed.name });

    if (existing) {
      existing.set(payload);
      await existing.save();
      updated += 1;
    } else {
      await Client.create({ ...payload, startDate: new Date() });
      created += 1;
    }

    rows.push({
      Cliente: seed.name,
      Monto: seed.amount,
      Emisión: seed.issueDay ?? "-",
      Cobro: seed.collectionDay ?? seed.collectionDayLabel ?? "-",
      Método: PAYMENT_METHOD_LABELS[seed.paymentMethod],
      Splits: seed.splits?.length || 0,
    });
  }

  const totalAmount = clientsSeed.reduce((acc, item) => acc + item.amount, 0);

  console.table(rows);
  console.log("--------------------------------------------------");
  console.log(`Clientes procesados : ${clientsSeed.length}`);
  console.log(`Creados             : ${created}`);
  console.log(`Actualizados        : ${updated}`);
  console.log(`Facturación mensual : $${totalAmount.toFixed(2)}`);
  console.log(`Sin cobro (no paga) : ${clientsSeed.filter((c) => c.paymentMethod === "no_paga").length}`);
  console.log("--------------------------------------------------");

  await mongoose.connection.close();
  process.exit(0);
}

run().catch(async (error) => {
  console.error("[seedClients] Error:", error);
  await mongoose.connection.close().catch(() => undefined);
  process.exit(1);
});
