// Auto-chequeo: el mapeo de servicios finanzas ↔ métricas es coherente. `npx tsx src/scripts/checkServices.script.ts`
import assert from "node:assert/strict";
import { CLIENT_SERVICES, METRICS_SERVICE, SERVICE_FROM_METRICS } from "../types/finance.types";

// Lo que acepta métricas (onboardingSesiones.service.ts → SERVICIOS_CLIENTE).
const METRICS_ENUM = ["completo", "guiones_pautas", "solo_pautas", "web", "automatizacion"];

for (const s of CLIENT_SERVICES) assert.ok(METRICS_ENUM.includes(METRICS_SERVICE[s]), `${s} no existe en métricas`);
for (const [m, s] of Object.entries(SERVICE_FROM_METRICS)) assert.equal(METRICS_SERVICE[s], m, `${m} no vuelve igual`);
assert.equal(SERVICE_FROM_METRICS.web, undefined, "web es ambiguo: no se rellena solo");
console.log("ok: servicios coherentes");
