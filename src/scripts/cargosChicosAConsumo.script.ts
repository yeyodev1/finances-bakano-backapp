/**
 * Cargos chicos de Stripe (< $50, recargas del CRM) que se aplicaron como abono a
 * la mensualidad antes del PR #12 (13 nov 2026). Los de cobros DESDE_PERIODO en
 * adelante salen del cobro (se recalcula como con "eliminar pago") y pasan a
 * consumo CRM con el mismo cargo. Lo anterior no se toca: esos meses ya se
 * cuadraron a mano. Tarea Metrics 6afb10719c5f043655aee212.
 *
 * Sin argumentos solo lista. Con --aplicar mueve.
 */
import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { Payment } from "../models";
import { paymentService } from "../services/payment.service";
import { crmConsumptionService, isCrmCharge } from "../services/crmConsumption.service";

const APLICAR = process.argv.includes("--aplicar");
const DESDE_PERIODO = "2026-11";
const QUIEN = { name: "Diego Reyes (script cargos chicos → consumo CRM)" } as any;

async function main() {
  await dbConnect();
  const pagos = await Payment.find({ stripeChargeId: { $exists: true, $ne: null }, period: { $gte: DESDE_PERIODO } })
    .sort({ clientName: 1, paidAt: 1 })
    .lean();
  const chicos = pagos.filter((p: any) => isCrmCharge(Number(p.amount)));

  for (const p of chicos as any[]) {
    console.log(`${p.clientName} | ${p.period} | $${p.amount} | ${p.paidAt.toISOString().slice(0, 10)} | ${p.stripeChargeId}`);
    if (!APLICAR) continue;
    if (p.receiptPublicId) {
      console.log("  ↳ tiene comprobante subido a mano, se salta");
      continue;
    }
    await paymentService.remove(String(p._id), QUIEN);
    const r = await crmConsumptionService.record({
      clientId: p.clientId,
      clientName: p.clientName,
      stripeChargeId: p.stripeChargeId,
      amount: p.amount,
      currency: p.currency || "USD",
      paidAt: p.paidAt,
      description: p.notes || "Cargo chico de Stripe movido desde la mensualidad",
      receiptUrl: p.receiptUrl,
      source: "stripe_import",
    });
    console.log(`  ↳ fuera del cobro y ${r.created ? "guardado" : "ya estaba"} como consumo CRM`);
  }
  console.log(`${chicos.length} cargo(s) chico(s) en cobros desde ${DESDE_PERIODO}${APLICAR ? " movidos" : " (solo lista; --aplicar para mover)"}`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
