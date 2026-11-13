// Auto-chequeo de quién puede dar de baja saldos (sin base de datos). `pnpm probar:baja`
import assert from "node:assert/strict";
import { CustomError } from "../errors/customError.error";
import { reglaBaja } from "../services/mcp.service";

const falla = (fn: () => unknown, status: number, texto: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof CustomError && e.status === status && texto.test(e.message));
const condonar = { cliente: "X", confirmar: true, motivo: "Se fue" };

// Admin de Finanzas sin aviso de Metrics: no.
falla(() => reglaBaja("admin", false, condonar), 403, /solo de superadmin/);
// Génesis: admin en Finanzas pero superadmin en Metrics: sí.
assert.equal(reglaBaja("admin", true, condonar), "Se fue");
assert.equal(reglaBaja("superadmin", false, condonar), "Se fue");
// Condonar sin motivo: no. Ver la lista sin motivo: sí.
falla(() => reglaBaja("superadmin", false, { ...condonar, motivo: "  " }), 400, /motivo/);
falla(() => reglaBaja("admin", true, { todos_archivados: true, confirmar: true }), 400, /motivo/);
assert.equal(reglaBaja("admin", true, { cliente: "X" }), "");
assert.equal(reglaBaja("admin", true, { confirmar: true }), "");

console.log("probar:baja OK");
