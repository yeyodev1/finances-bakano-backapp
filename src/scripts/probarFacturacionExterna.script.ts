import assert from "node:assert/strict";
import { cruzar, extraerFactura } from "../services/facturacionExterna.service";

// invoiceData como texto JSON con el formato del SRI
const f = extraerFactura({
  _id: "f1", secuencial: 12, status: "AUTORIZADA", authorizationDate: "2026-11-10T15:00:00Z",
  invoiceData: JSON.stringify({ infoFactura: { importeTotal: "500.00", razonSocialComprador: "Cliente Demo", identificacionComprador: "0912345678" } }),
});
assert.equal(f.monto, 500);
assert.equal(f.clienteNombre, "Cliente Demo");
assert.equal(f.clienteIdentificacion, "0912345678");
assert.equal(f.secuencial, "12");
// JSON roto o vacío no revienta
assert.equal(extraerFactura({ _id: "f2", invoiceData: "{roto" }).monto, 0);

const { facturaCobrada, cobroFacturado } = cruzar(
  [{ externalId: "f1", cobradaAlEmitir: false }, { externalId: "f3", cobradaAlEmitir: true }, { externalId: "f4", cobradaAlEmitir: false }],
  [{ invoiceId: "f1" }, { invoiceId: null, isManualInvoiced: true }, { invoiceId: null }]
);
assert.equal(facturaCobrada({ externalId: "f1", cobradaAlEmitir: false }), true);
assert.equal(facturaCobrada({ externalId: "f3", cobradaAlEmitir: true }), true);
assert.equal(facturaCobrada({ externalId: "f4", cobradaAlEmitir: false }), false); // facturada sin cobrar
assert.equal(cobroFacturado({ invoiceId: null, isManualInvoiced: true }), true);
assert.equal(cobroFacturado({ invoiceId: null }), false); // cobrado sin factura
console.log("facturación externa OK");
process.exit(0);
