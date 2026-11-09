/**
 * Ex clientes archivados con cobros abiertos: sus saldos se dan por perdidos
 * (decisión de Dirección, 9 nov 2026, tarea Metrics 6ae385d1aa35bac083a8948b).
 * Condona (waived) cada cobro pending/partial/overdue con motivo, sin borrar
 * nada: los pagos registrados quedan como historia.
 *
 * Sin argumentos solo lista. Con --aplicar condona.
 */
import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { Client, Invoice } from "../models";
import { invoiceQueryService } from "../services/invoice.query.service";

const APLICAR = process.argv.includes("--aplicar");
const MOTIVO = "Cliente archivado (fin de relación ago/sep 2026): saldo dado por perdido por Dirección el 9 nov 2026";

async function main() {
  await dbConnect();
  const archivados = await Client.find({ $or: [{ isArchived: true }, { isActive: false }] }).select("name archivedAt").lean();
  const ids = archivados.map((c: any) => c._id);
  const abiertos = await Invoice.find({ clientId: { $in: ids }, status: { $in: ["pending", "partial", "overdue"] } })
    .select("clientId clientName period amount paidAmount status dueDate")
    .sort({ clientName: 1, period: 1 })
    .lean();
  let total = 0;
  for (const inv of abiertos as any[]) {
    const saldo = Number(inv.amount) - Number(inv.paidAmount || 0);
    total += saldo;
    console.log(`${inv.clientName} | ${inv.period} | ${inv.status} | monto ${inv.amount} pagado ${inv.paidAmount || 0} | saldo ${saldo.toFixed(2)}`);
  }
  console.log(`\n${archivados.length} clientes archivados, ${abiertos.length} cobros abiertos, saldo total ${total.toFixed(2)}`);
  if (!APLICAR) {
    console.log("Solo lectura. Para condonar: --aplicar");
  } else {
    let ok = 0;
    for (const inv of abiertos as any[]) {
      await invoiceQueryService.markWaived(String(inv._id), MOTIVO);
      ok++;
    }
    console.log(`Condonados ${ok} cobros.`);
  }
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
