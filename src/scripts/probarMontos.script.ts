// Auto-chequeo de corregir montos y anular pagos desde el MCP (sin base de datos). `pnpm probar:montos`
import assert from "node:assert/strict";
import { CustomError } from "../errors/customError.error";
import { reglaMonto, reglaSuperadmin } from "../services/mcp.service";

const falla = (fn: () => unknown, status: number, texto: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof CustomError && e.status === status && texto.test(e.message));

// Solo superadmin (de Finanzas o de Metrics) y siempre con motivo.
falla(() => reglaSuperadmin("admin", false, "Error de tipeo", "Corregir montos"), 403, /solo de superadmin/);
assert.equal(reglaSuperadmin("admin", true, " Error de tipeo ", "Corregir montos"), "Error de tipeo");
falla(() => reglaSuperadmin("superadmin", false, "  ", "Anular pagos"), 400, /motivo/);
falla(() => reglaSuperadmin("superadmin", false, undefined, "Anular pagos"), 400, /motivo/);

// Nunca por debajo de lo pagado; un cobro pagado no se toca; anulado sí (EL DON 2026-10).
const cobro = (paidAmount: number, status: string) => ({ period: "2026-11", amount: 500, paidAmount, status });
falla(() => reglaMonto(cobro(500, "paid"), 400), 409, /\$500 pagados.*anúlalo primero/);
falla(() => reglaMonto(cobro(500, "paid"), 600), 409, /está pagado/);
falla(() => reglaMonto(cobro(300, "partial"), 299.99), 409, /\$300 pagados/);
falla(() => reglaMonto(cobro(0, "overdue"), 0), 400, /mayor a cero/);
assert.doesNotThrow(() => reglaMonto(cobro(300, "partial"), 300));
assert.doesNotThrow(() => reglaMonto(cobro(0, "overdue"), 400));
assert.doesNotThrow(() => reglaMonto(cobro(0, "cancelled"), 700));

console.log("probar:montos OK");
