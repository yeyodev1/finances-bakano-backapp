import { CustomError } from "../errors/customError.error";
import { InvoiceStatus } from "../types/finance.types";
import { isValidPeriod } from "../utils/date.util";

/**
 * Reglas puras de a qué cobro va un pago. Sin base de datos para poder
 * probarlas con `src/scripts/probarPagoAMes.script.ts`.
 */

const OPEN: InvoiceStatus[] = ["pending", "partial", "overdue"];

interface CobroLike {
  period: string;
  status: InvoiceStatus;
  amount: number;
  paidAmount?: number;
}

export function saldoDe(c: CobroLike): number {
  return Math.max(c.amount - (c.paidAmount || 0), 0);
}

/** Reparte el monto en el orden dado (el más viejo primero), sin pasarse del saldo de cada cobro. */
export function repartir<T extends CobroLike>(cobros: T[], monto: number): Array<{ cobro: T; parte: number }> {
  const out: Array<{ cobro: T; parte: number }> = [];
  let resta = Number(monto);
  for (const cobro of cobros) {
    if (resta <= 0.009) break;
    const saldo = saldoDe(cobro);
    if (saldo <= 0) continue;
    const parte = Number(Math.min(saldo, resta).toFixed(2));
    out.push({ cobro, parte });
    resta = Number((resta - parte).toFixed(2));
  }
  return out;
}

/**
 * Elige los cobros de un mes (o el cobro con ese id) a los que va el pago.
 * `cobros` son los del cliente que coinciden con el mes o el id pedido.
 * Si el cobro está anulado solo superadmin lo reactiva, y con motivo.
 */
export function elegirCobros<T extends CobroLike>(
  cobros: T[],
  sel: { cliente: string; mes?: string; cobroId?: string; motivo?: string; esSuperadmin: boolean }
): { objetivos: T[]; reactivar: T[] } {
  const queMes = sel.mes ? `el cobro de ${sel.mes}` : `el cobro ${sel.cobroId}`;
  if (!cobros.length) {
    if (sel.cobroId) throw new CustomError(`No encontré ${queMes} de ${sel.cliente}. Revisa el id en finanzas_cliente.`, 404);
    throw new CustomError(
      `${sel.cliente} no tiene cobro de ${sel.mes}: no existe y no lo creo solo. ` +
        `Créalo en finances.bakano.ec → cliente → Cobros → "Generar cobros retroactivos" desde ${sel.mes} ` +
        `(o POST /invoices/generate con period=${sel.mes} y su clientId) y vuelve a registrar el pago con mes=${sel.mes}.`,
      404
    );
  }

  const abiertos = cobros.filter((c) => OPEN.includes(c.status));
  if (abiertos.length) return { objetivos: abiertos, reactivar: [] };

  const anulados = cobros.filter((c) => c.status === "cancelled");
  if (anulados.length) {
    if (!sel.esSuperadmin) {
      throw new CustomError(
        `${queMes} de ${sel.cliente} está ANULADO. Solo Dirección (superadmin en Finanzas) puede reactivarlo para registrar este pago.`,
        403
      );
    }
    if (!sel.motivo?.trim()) {
      throw new CustomError(`${queMes} de ${sel.cliente} está ANULADO. Para reactivarlo dime el motivo (queda en el historial).`, 400);
    }
    return { objetivos: anulados, reactivar: anulados };
  }

  const estados = [...new Set(cobros.map((c) => c.status))].join(", ");
  throw new CustomError(`${queMes} de ${sel.cliente} no tiene saldo pendiente (${estados}). No hay a qué aplicar el pago.`, 409);
}

/** Valida el selector: mes AAAA-MM o id de cobro, no ambos. */
export function validarSelector(mes?: string, cobroId?: string): void {
  if (mes && cobroId) throw new CustomError("Dame el mes o el cobro_id, no los dos.", 400);
  if (mes && !isValidPeriod(mes)) throw new CustomError("El mes va como AAAA-MM (ej. 2026-10).", 400);
}
