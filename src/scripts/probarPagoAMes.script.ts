// Auto-chequeo de a qué cobro va un pago (sin base de datos). `pnpm probar:pago-a-mes`
import assert from "node:assert/strict";
import { CustomError } from "../errors/customError.error";
import { elegirCobros, repartir, validarSelector } from "../services/payment.allocation";

const cobro = (period: string, status: any, amount: number, paidAmount = 0) => ({ period, status, amount, paidAmount });
const falla = (fn: () => unknown, status: number, texto: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof CustomError && e.status === status && texto.test(e.message));

// Sin mes: el más viejo primero, sin pasarse del saldo.
const abiertos = [cobro("2026-09", "overdue", 200, 50), cobro("2026-10", "pending", 200), cobro("2026-11", "pending", 200)];
assert.deepEqual(
  repartir(abiertos, 300).map((x) => [x.cobro.period, x.parte]),
  [["2026-09", 150], ["2026-10", 150]]
);
assert.deepEqual(repartir(abiertos, 550).map((x) => x.parte), [150, 200, 200]);
assert.deepEqual(repartir([cobro("2026-10", "partial", 100, 100), cobro("2026-11", "pending", 0.3)], 0.3).map((x) => x.parte), [0.3]);

// Caso Eventos la Colonia: octubre ANULADO, noviembre abierto, pago de $200 para octubre.
const octubre = [cobro("2026-10", "cancelled", 200)];
const sel = { cliente: "Eventos la Colonia", mes: "2026-10" };
falla(() => elegirCobros(octubre, { ...sel, esSuperadmin: false, motivo: "x" }), 403, /ANULADO.*superadmin/);
falla(() => elegirCobros(octubre, { ...sel, esSuperadmin: true }), 400, /motivo/);
const r = elegirCobros(octubre, { ...sel, esSuperadmin: true, motivo: "Pagó octubre; se anuló por error" });
assert.equal(r.reactivar.length, 1);
assert.deepEqual(repartir(r.objetivos, 200).map((x) => [x.cobro.period, x.parte]), [["2026-10", 200]]);

// Mes con un split abierto y otro anulado: solo el abierto, nada se reactiva.
const mixto = elegirCobros([cobro("2026-10", "cancelled", 100), cobro("2026-10", "pending", 100)], { ...sel, esSuperadmin: true });
assert.deepEqual([mixto.objetivos.map((c) => c.status), mixto.reactivar.length], [["pending"], 0]);

// Mes sin cobro: error claro con cómo crearlo, no se crea solo.
falla(() => elegirCobros([], { cliente: "X", mes: "2026-09", esSuperadmin: true }), 404, /no tiene cobro de 2026-09.*Generar cobros/);
falla(() => elegirCobros([], { cliente: "X", cobroId: "abc", esSuperadmin: true }), 404, /No encontré el cobro abc/);
// Ya pagado o condonado: no hay a qué aplicar.
falla(() => elegirCobros([cobro("2026-10", "paid", 200, 200)], { ...sel, esSuperadmin: true }), 409, /sin saldo|no tiene saldo/);

// Selector.
falla(() => validarSelector("2026-13"), 400, /AAAA-MM/);
falla(() => validarSelector("2026-10", "id"), 400, /no los dos/);
validarSelector("2026-10");
validarSelector(undefined, "id");
validarSelector();

console.log("ok: asignación de pagos a cobros");
