# Bakano Finanzas — API

Base URL local: `http://localhost:8101/api`

Todas las rutas requieren `Authorization: Bearer <token>` excepto `POST /auth/login`.

Roles: `superadmin` (todo), `admin` (lectura + escritura de clientes/facturas/pagos), `viewer` (solo lectura).

Respuestas de error: `{ "message": "..." }`, y en validaciones `{ "message": "Datos inválidos en la solicitud", "details": [{ "field": "...", "message": "..." }] }`.

Listados paginados: `{ "items": [], "total": 0, "page": 1, "limit": 50, "pages": 1 }`.

---

## Auth

> Las llamadas de abajo usan variables de entorno para no dejar credenciales escritas:
> `export ADMIN_EMAIL=...` y `export ADMIN_PASSWORD=...` antes de ejecutarlas.

### Login (empieza por aquí)

```bash
curl -X POST http://localhost:8101/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"'"$ADMIN_EMAIL"'","password":"'"$ADMIN_PASSWORD"'"}'
```

Guarda el token para el resto de llamadas:

```bash
export TOKEN=$(curl -s -X POST http://localhost:8101/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"'"$ADMIN_EMAIL"'","password":"'"$ADMIN_PASSWORD"'"}' | jq -r .token)
```

### Perfil autenticado

```bash
curl http://localhost:8101/api/auth/me -H "Authorization: Bearer $TOKEN"
```

### Cambiar contraseña

```bash
curl -X POST http://localhost:8101/api/auth/change-password \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"currentPassword":"'"$ADMIN_PASSWORD"'","newPassword":"'"$NUEVA_CLAVE"'"}'
```

---

## Usuarios (`/users`) — solo `superadmin`, salvo `GET /users/me`

```bash
# Mi perfil (cualquier rol autenticado)
curl http://localhost:8101/api/users/me -H "Authorization: Bearer $TOKEN"

# Listar con filtros
curl "http://localhost:8101/api/users?q=diego&role=admin&isActive=true&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Detalle
curl http://localhost:8101/api/users/665f0a1b2c3d4e5f60718293 -H "Authorization: Bearer $TOKEN"

# Crear
curl -X POST http://localhost:8101/api/users \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Ana Torres","email":"ana@bakano.ec","password":"claveSegura1","role":"admin","receivesNotifications":true}'

# Actualizar (si mandas password se re-hashea)
curl -X PUT http://localhost:8101/api/users/665f0a1b2c3d4e5f60718293 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Ana T.","role":"viewer"}'

# Activar / desactivar
curl -X PATCH http://localhost:8101/api/users/665f0a1b2c3d4e5f60718293/active \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"isActive":false}'

# Eliminar
curl -X DELETE http://localhost:8101/api/users/665f0a1b2c3d4e5f60718293 \
  -H "Authorization: Bearer $TOKEN"
```

No se puede eliminar/desactivar al último superadministrador activo ni a tu propia cuenta.

---

## Clientes (`/clients`)

```bash
# Listar (q, paymentMethod, billingType, isActive, hasWorkspace, tag, ownerId, page, limit, sort)
#
# `ownerId` es el RESPONSABLE DE COBRO del cliente (un usuario). Se manda también
# al crear/actualizar; el backend cachea su nombre en `ownerName` para no resolver
# un lookup en cada fila del listado.
curl "http://localhost:8101/api/clients?q=anderson&isActive=true&billingType=monthly&sort=-createdAt&page=1&limit=50" \
  -H "Authorization: Bearer $TOKEN"

# Estadísticas globales
curl http://localhost:8101/api/clients/stats -H "Authorization: Bearer $TOKEN"

# Detalle
curl http://localhost:8101/api/clients/665f0a1b2c3d4e5f60718293 -H "Authorization: Bearer $TOKEN"

# Crear (cobro único)
#
# Al dar de alta un cliente se genera automáticamente su cobro del período en
# curso, con el mismo motor que el job mensual (respeta `startDate`,
# `billingStartPeriod` y los cobros divididos). Sin esto, un alta a mitad de mes
# se quedaba sin cobro hasta el mes siguiente y su primer pago no tenía contra
# qué registrarse. Si la generación falla no tumba el alta: queda en el log y el
# cobro se puede generar después con `POST /invoices/generate` + `clientIds`.
curl -X POST http://localhost:8101/api/clients \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name":"Restaurante La Casa",
    "contactName":"María Pérez",
    "contactEmail":"maria@lacasa.ec",
    "amount":420,
    "issueDay":1,
    "collectionDay":5,
    "paymentMethod":"transferencia",
    "billingType":"monthly",
    "tags":["restaurante"],
    "startDate":"2026-01-01"
  }'

# Crear (cobro dividido en dos pagos del mismo mes)
curl -X POST http://localhost:8101/api/clients \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name":"Anderson Boscán",
    "amount":420,
    "collectionDayLabel":"Último viernes laborable",
    "billingType":"monthly",
    "splits":[{"label":"Primer pago","amount":210,"day":15},{"label":"Segundo pago","amount":210,"day":null}]
  }'

# Actualizar
curl -X PUT http://localhost:8101/api/clients/665f0a1b2c3d4e5f60718293 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"amount":480,"collectionDay":10}'

# Eliminar — YA NO BORRA: responde 400 y te pide usar la baja
curl -X DELETE http://localhost:8101/api/clients/665f0a1b2c3d4e5f60718293 \
  -H "Authorization: Bearer $TOKEN"

# Activar / desactivar
curl -X PATCH http://localhost:8101/api/clients/665f0a1b2c3d4e5f60718293/active \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"isActive":false,"reason":"Contrato finalizado"}'

# Vincular workspace de métricas
curl -X POST http://localhost:8101/api/clients/665f0a1b2c3d4e5f60718293/link-workspace \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"workspaceId":"6710aa11bb22cc33dd44ee55","workspaceName":"La Casa"}'

# Desvincular workspace
curl -X DELETE http://localhost:8101/api/clients/665f0a1b2c3d4e5f60718293/link-workspace \
  -H "Authorization: Bearer $TOKEN"

# Sugerencias de workspace (top 5 por similitud de nombre; [] si métricas no está configurado)
curl http://localhost:8101/api/clients/665f0a1b2c3d4e5f60718293/workspace-suggestions \
  -H "Authorization: Bearer $TOKEN"

# Backfill histórico: genera facturas desde fromDate y marca pagadas hasta markPaidUntil
curl -X POST http://localhost:8101/api/clients/665f0a1b2c3d4e5f60718293/backfill \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fromDate":"2025-01-01","markPaidUntil":"2026-06-30"}'
```

### Bajas de clientes (archivado, nunca borrado)

El listado normal (`GET /clients`) **excluye** los archivados. Usa `archived=true` para verlos
solo a ellos o `archived=all` para verlos todos. Cada item trae `lifetimeDays` calculado.

```bash
# Listar solo archivados / todos
curl "http://localhost:8101/api/clients?archived=true" -H "Authorization: Bearer $TOKEN"
curl "http://localhost:8101/api/clients?archived=all" -H "Authorization: Bearer $TOKEN"

# Atajo: bajas con motivo, duración e ingreso total, ordenadas por fecha de baja desc
curl "http://localhost:8101/api/clients/archived?limit=100" -H "Authorization: Bearer $TOKEN"

# Dar de baja SIN adjuntos (JSON). "reason" es obligatorio.
# Valores: impago | cancelacion_cliente | cierre_negocio | competencia | precio |
#          insatisfaccion_resultados | pausa_temporal | fin_contrato | decision_bakano |
#          reembolso | garantia_fallida | otro
# `reembolso` y `garantia_fallida` los pone el propio backend al devolver dinero o
# al cerrar una garantía como fracaso; también se pueden elegir a mano.
curl -X POST http://localhost:8101/api/clients/665f0a1b2c3d4e5f60718293/archive \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"impago","notes":"Tres meses sin pagar, no responde WhatsApp"}'

# Dar de baja CON respaldos (multipart, campo "attachments", hasta 10, imágenes o PDF de 10 MB)
curl -X POST http://localhost:8101/api/clients/665f0a1b2c3d4e5f60718293/archive \
  -H "Authorization: Bearer $TOKEN" \
  -F "reason=cancelacion_cliente" \
  -F "notes=Capturas del chat donde pide cancelar" \
  -F "attachments=@/ruta/chat-whatsapp.png" \
  -F "attachments=@/ruta/correo-cancelacion.pdf"

# Dar de baja con FECHA RETROACTIVA. Sin "archivedAt" se usa hoy.
# La fecha define la antigüedad y qué cobros futuros se anulan; no puede ser
# anterior a la fecha de entrada del cliente (400).
curl -X POST http://localhost:8101/api/clients/665f0a1b2c3d4e5f60718293/archive \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"fin_contrato","archivedAt":"2026-07-31"}'

# Corregir las fechas del ciclo de vida (lo usa la project manager desde /bajas).
# Acepta una o ambas. Recalcula `lifetimeDays`, `endDate`, `deactivatedAt` y la
# entrada "archived" del historial, que se derivan de estas fechas —por eso no
# basta con un PUT /clients/:id. Queda registrado en el audit log.
curl -X PATCH http://localhost:8101/api/clients/665f0a1b2c3d4e5f60718293/lifecycle-dates \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"startDate":"2025-03-01","archivedAt":"2026-07-31"}'

# Subir respaldos extra a la última entrada del historial
curl -X POST http://localhost:8101/api/clients/665f0a1b2c3d4e5f60718293/attachments \
  -H "Authorization: Bearer $TOKEN" \
  -F "attachments=@/ruta/acta-cierre.pdf"

# Reactivar (limpia la baja y deja el historial intacto)
curl -X POST http://localhost:8101/api/clients/665f0a1b2c3d4e5f60718293/reactivate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"notes":"Volvió con plan reducido"}'

# Borrado real — solo superadmin y solo si el cliente NUNCA tuvo pagos
curl -X DELETE http://localhost:8101/api/clients/665f0a1b2c3d4e5f60718293/purge \
  -H "Authorization: Bearer $TOKEN"
```

Respuesta de `/archive`:

```json
{
  "client": { "_id": "665f0a1b2c3d4e5f60718293", "isArchived": true, "archiveReason": "impago" },
  "cancelledInvoices": 2,
  "lifetimeDays": 418,
  "lifetimeRevenue": 5460,
  "workspaceStillActive": true,
  "message": "Cliente dado de baja correctamente"
}
```

Notas:

- Se anulan las facturas `pending`/`partial`/`overdue` con vencimiento **futuro**. La mora
  vencida del pasado se conserva porque es deuda histórica real.
- El workspace vinculado **no** se desactiva solo: `workspaceStillActive: true` avisa al
  frontend para ofrecerlo aparte.
- Los adjuntos quedan en Cloudinary (`bakano-finanzas/bajas`) y nunca se borran, ni al reactivar.

`GET /clients/stats` ahora responde además:

```json
{
  "archivedClients": 7,
  "idealMonthlyAmount": 24580
}
```

`idealMonthlyAmount` = suma del cobro mensual de todos los clientes no archivados, activos,
`billingType: "monthly"` y con método distinto de `no_paga` (usa los splits si los hay).

---

## Facturas (`/invoices`)

```bash
# Listar (period, status, clientId, q, overdueOnly, page, limit)
curl "http://localhost:8101/api/invoices?period=2026-08&status=overdue&page=1&limit=50" \
  -H "Authorization: Bearer $TOKEN"

curl "http://localhost:8101/api/invoices?overdueOnly=true" -H "Authorization: Bearer $TOKEN"

# Resumen del período
curl "http://localhost:8101/api/invoices/summary?period=2026-08" -H "Authorization: Bearer $TOKEN"

# Generar facturas del período (idempotente; force reescribe solo las no pagadas)
curl -X POST http://localhost:8101/api/invoices/generate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"period":"2026-08"}'

curl -X POST http://localhost:8101/api/invoices/generate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"period":"2026-08","clientIds":["665f0a1b2c3d4e5f60718293"],"force":true}'

# Recalcular estados (marca overdue lo vencido e impago)
curl -X POST http://localhost:8101/api/invoices/recalc -H "Authorization: Bearer $TOKEN"

# Detalle
curl http://localhost:8101/api/invoices/6712ab34cd56ef7890123456 -H "Authorization: Bearer $TOKEN"

# Editar
curl -X PUT http://localhost:8101/api/invoices/6712ab34cd56ef7890123456 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"amount":390,"dueDate":"2026-08-28","notes":"Descuento acordado"}'

# Condonar
curl -X PATCH http://localhost:8101/api/invoices/6712ab34cd56ef7890123456/waive \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"Cortesía por incidencia de servicio"}'

# Anular
curl -X PATCH http://localhost:8101/api/invoices/6712ab34cd56ef7890123456/cancel \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"Factura duplicada"}'

# Solo facturas con al menos una prórroga registrada
curl "http://localhost:8101/api/invoices?deferredOnly=true" -H "Authorization: Bearer $TOKEN"

# Solo cobros anticipados
curl "http://localhost:8101/api/invoices?advanceOnly=true" -H "Authorization: Bearer $TOKEN"
```

### Prórrogas (acuerdos de pago)

Mueven el vencimiento de **esa factura únicamente**. El `collectionDay` del cliente no cambia,
así que el período siguiente vuelve solo a su fecha habitual. La mora, los días de gracia y la
auto-desactivación se miden siempre contra el `dueDate` vigente (el prorrogado).

```bash
# Registrar el acuerdo: mueve el vencimiento al 15 y reabre los avisos con la fecha nueva
curl -X PATCH http://localhost:8101/api/invoices/6712ab34cd56ef7890123456/defer \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"newDueDate":"2026-08-15","reason":"Acuerdo telefónico","notes":"Confirmado por WhatsApp"}'

# Deshacer la última prórroga (restaura el vencimiento anterior y recalcula el estado)
curl -X DELETE http://localhost:8101/api/invoices/6712ab34cd56ef7890123456/defer \
  -H "Authorization: Bearer $TOKEN"
```

Reglas de `PATCH /invoices/:id/defer`:

- `400` si la factura está `paid`, `cancelled` o `waived`.
- `400` con `"La nueva fecha debe ser posterior al vencimiento actual."` si `newDueDate` no supera el `dueDate` vigente.
- La primera prórroga guarda el vencimiento inicial en `originalDueDate`; las siguientes no lo pisan.
- Cada acuerdo se apila en `deferrals[]` con `previousDueDate`, `newDueDate`, `reason`, `notes`, `agreedAt`, `agreedBy` y `agreedByName`.
- Si estaba `overdue` y la nueva fecha es futura, vuelve a `pending` (o `partial` si ya tenía pagos).
- Se resetean `reminderSentAt`, `overdueNotifiedAt` y `deactivation.warnedAt` para que los avisos se disparen de nuevo.
- Escribe `AuditLog` (`invoice.defer`) y envía el correo `payment_deferred`.

### Cobro anticipado / inicio diferido

Para el caso "me pagan hoy pero el servicio arranca el 1 del mes siguiente": se crea la factura
del período futuro antes de que corra el generador mensual y se le registra el pago hoy.

```bash
# Crear el cobro anticipado (idempotente por clientId + period + splitIndex)
curl -X POST http://localhost:8101/api/invoices/advance \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"clientId":"665f0a1b2c3d4e5f60718293","period":"2026-09"}'

# Con monto, vencimiento, split y notas explícitos
curl -X POST http://localhost:8101/api/invoices/advance \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"clientId":"665f0a1b2c3d4e5f60718293","period":"2026-09","amount":420,"dueDate":"2026-09-01","splitIndex":0,"notes":"Pagado por adelantado en agosto"}'

# Registrar el pago sobre esa factura (el correo indica que es un cobro anticipado del período)
curl -X POST http://localhost:8101/api/payments \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"invoiceId":"6712ab34cd56ef7890123456","amount":420,"method":"transferencia"}'
```

Respuesta: `{ "invoice": { … }, "created": true }` con `201` si se creó, o `created: false` con
`200` si ya existía la factura de ese `(clientId, period, splitIndex)`.

Notas:

- La factura queda con `isAdvance: true` y `autoGenerated: false`.
- `amount` por defecto: el del split indicado, o el del cliente.
- `dueDate` por defecto: el `collectionDay` del cliente dentro de ese período.
- Solo se admite el período actual o uno futuro; los pasados devuelven `400`.
- Clientes archivados (`isArchived: true`) devuelven `400`.
- El generador mensual nunca pisa ni duplica una factura `isAdvance` existente.
- Al pagar una factura `isAdvance` con vencimiento futuro **no** se dispara la reactivación de workspace por mora; la respuesta de `POST /payments` incluye `isAdvance: true`.

### Generación mensual y clientes archivados

`POST /invoices/generate` (y el job mensual) excluyen:

- clientes con `isArchived: true`;
- clientes cuyo `billingStartPeriod` es posterior al período solicitado (comparación de strings `"YYYY-MM"`);
- clientes sin `billingStartPeriod` cuyo `startDate` cae después del último día del período.

`GET /invoices/summary` responde:

```json
{
  "period": "2026-08",
  "total": 24,
  "paid": 18,
  "pending": 4,
  "overdue": 2,
  "collectedAmount": 7560,
  "expectedAmount": 9240,
  "pendingAmount": 1680,
  "collectionRate": 0.8182
}
```

---

## Pagos (`/payments`)

```bash
# Listar (clientId, period, method, from, to, page, limit)
curl "http://localhost:8101/api/payments?period=2026-08&method=transferencia&from=2026-08-01&to=2026-08-31" \
  -H "Authorization: Bearer $TOKEN"

# Registrar pago sin comprobante
curl -X POST http://localhost:8101/api/payments \
  -H "Authorization: Bearer $TOKEN" \
  -F "invoiceId=6712ab34cd56ef7890123456" \
  -F "amount=420" \
  -F "paidAt=2026-08-05" \
  -F "method=transferencia" \
  -F "reference=TRX-99881"

# Registrar pago con comprobante (imagen o PDF, máx 10 MB)
curl -X POST http://localhost:8101/api/payments \
  -H "Authorization: Bearer $TOKEN" \
  -F "invoiceId=6712ab34cd56ef7890123456" \
  -F "amount=210" \
  -F "method=cheque" \
  -F "notes=Primer split" \
  -F "receipt=@/ruta/comprobante.pdf"

# Detalle
curl http://localhost:8101/api/payments/6713cd56ef7890123456abcd -H "Authorization: Bearer $TOKEN"

# Eliminar (revierte paidAmount/estado de la factura y borra el comprobante) — solo superadmin
curl -X DELETE http://localhost:8101/api/payments/6713cd56ef7890123456abcd \
  -H "Authorization: Bearer $TOKEN"
```

```bash
# UN SOLO PAGO que salda varios cobros del mismo cliente.
# Caso típico: cobro dividido de 210 el día 8 y 210 el día 23, pero el cliente
# transfiere los 420 de una. El monto se reparte del cobro MÁS VIEJO al más
# nuevo (primero la mora) y por dentro llama a `register` factura por factura,
# así cada una conserva su correo, su auditoría y la reactivación del workspace.
# Falla con 400 si el monto supera el saldo abierto del cliente.
# `invoiceIds` es opcional: sin él se reparte entre todos los cobros abiertos.
curl -X POST http://localhost:8101/api/payments/settle \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"clientId":"6a776e2a620c78720cb9f719","amount":420,"paidAt":"2026-08-08","method":"transferencia"}'
```

Al registrar un pago: se recalcula el estado de la factura (`paid` o `partial`), se envía el correo de confirmación, se escribe un registro de auditoría y —si el cliente queda sin facturas vencidas y su workspace estaba desactivado— se reactiva el workspace en el backend de métricas.

---

## Reembolsos (`/refunds`)

Plata que ya entró y vuelve a salir.

**El pago original nunca se toca.** Si se editara el `Payment`, la caja del mes en que entró el
dinero cambiaría hacia atrás y el histórico dejaría de cuadrar con el banco. El reembolso es un
asiento nuevo, con su propia fecha, en su propia colección. La factura solo acumula
`refundedAmount`: su `status` sigue siendo `paid`, y el neto del período es
`paidAmount - refundedAmount`.

```bash
# Listar (clientId, period, reason, from, to, page, limit)
curl "http://localhost:8101/api/refunds?period=2026-08" -H "Authorization: Bearer $TOKEN"

# Totales: cuánto se devolvió, cuánto este mes y por qué motivo
curl http://localhost:8101/api/refunds/summary -H "Authorization: Bearer $TOKEN"

# Reembolsos de un cliente
curl http://localhost:8101/api/refunds/client/6a776e2a620c78720cb9f719 \
  -H "Authorization: Bearer $TOKEN"

# Registrar. Manda "paymentId" o "invoiceId"; con el pago salen solos factura,
# cliente y período. Falla con 400 si el monto supera lo cobrado menos lo ya devuelto.
# "reason": garantia | sin_resultados | servicio_no_prestado | cobro_duplicado |
#           error_de_cobro | acuerdo_comercial | otro
curl -X POST http://localhost:8101/api/refunds \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"paymentId":"6713cd56ef7890123456abcd","amount":400,"reason":"sin_resultados","refundedAt":"2026-08-14"}'

# Devolver Y dar de baja en el mismo paso: el cliente queda archivado con
# motivo "reembolso". La baja va DESPUÉS de guardar el asiento: si archivar
# falla, la devolución ya quedó registrada en vez de perderse.
curl -X POST http://localhost:8101/api/refunds \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"invoiceId":"6713aa11ef7890123456abcd","amount":400,"reason":"garantia","archiveClient":true}'

# Con comprobante (multipart, campo "receipt", imagen o PDF de 10 MB)
curl -X POST http://localhost:8101/api/refunds \
  -H "Authorization: Bearer $TOKEN" \
  -F paymentId=6713cd56ef7890123456abcd -F amount=400 -F reason=acuerdo_comercial \
  -F receipt=@/ruta/transferencia.pdf

# Detalle
curl http://localhost:8101/api/refunds/6713ff99ef7890123456abcd -H "Authorization: Bearer $TOKEN"

# Eliminar (descuenta el refundedAmount de la factura y borra el comprobante) — solo superadmin.
# La baja que haya disparado NO se revierte: se reactiva a mano desde la ficha.
curl -X DELETE http://localhost:8101/api/refunds/6713ff99ef7890123456abcd \
  -H "Authorization: Bearer $TOKEN"
```

---

## Garantías (`/guarantees`)

Bakano es agencia y cobra por resultados. Si un cliente antiguo no los vio, se le regala el mes
siguiente: **arranca sin pagarnos**. Si aparecen resultados vuelve a cobrarse (`cumplida`); si no,
la política estira **un segundo mes** (`extendida`). Agotado el tope de dos, la garantía se cierra
como `fallida` — el fracaso — y por defecto da de baja al cliente con motivo `garantia_fallida`.

El mes regalado **no se borra de la facturación**: el cobro se emite igual, en estado `waived` y
marcado con `isGuarantee`, para que el monto que se está regalando siga a la vista. Es el costo
real de la política. La generación mensual consulta la garantía abierta y crea así los cobros de
los períodos cubiertos.

Estados: `abierta` (mes 1) · `extendida` (mes 2) · `cumplida` · `fallida` · `cancelada`.

```bash
# Listar (clientId, status, open, page, limit)
curl "http://localhost:8101/api/guarantees?open=true" -H "Authorization: Bearer $TOKEN"

# Totales: en curso, recuperados, fracasos, regalado y % de recuperación
curl http://localhost:8101/api/guarantees/summary -H "Authorization: Bearer $TOKEN"

# Abrir. "period" es el mes que se regala (por defecto, el siguiente al actual) y
# "triggerPeriod" el que salió sin resultados (por defecto, el actual).
# Falla con 409 si el cliente ya tiene una garantía en curso.
curl -X POST http://localhost:8101/api/guarantees \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"clientId":"6a776e2a620c78720cb9f719","period":"2026-09","triggerPeriod":"2026-08","reason":"No subieron las ventas prometidas"}'

# Extender al segundo mes. Falla con 400 si ya se usaron los dos que permite la política.
curl -X POST http://localhost:8101/api/guarantees/6713bb22ef7890123456abcd/extend \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"period":"2026-10","resultNotes":"Subió el tráfico pero no las ventas"}'

# Cerrar BIEN: hubo resultados, vuelve a facturarse con normalidad
curl -X POST http://localhost:8101/api/guarantees/6713bb22ef7890123456abcd/close \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"outcome":"cumplida","notes":"Duplicó pedidos en octubre"}'

# Cerrar como FRACASO. Por defecto archiva al cliente (archiveClient:false lo evita).
curl -X POST http://localhost:8101/api/guarantees/6713bb22ef7890123456abcd/close \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"outcome":"fallida","notes":"Dos meses sin mover la aguja"}'

# Fracaso CON devolución: crea el reembolso y archiva, todo en una llamada
curl -X POST http://localhost:8101/api/guarantees/6713bb22ef7890123456abcd/close \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"outcome":"fallida","refund":{"invoiceId":"6713aa11ef7890123456abcd","amount":400,"reason":"garantia"}}'

# Cancelar: se abrió por error. Los meses condonados vuelven a `pending`.
curl -X POST http://localhost:8101/api/guarantees/6713bb22ef7890123456abcd/close \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"outcome":"cancelada","notes":"Era otro cliente"}'

# Historial de un cliente + la garantía vigente
curl http://localhost:8101/api/guarantees/client/6a776e2a620c78720cb9f719 \
  -H "Authorization: Bearer $TOKEN"
```

El cliente lleva una copia del estado vigente en `client.guarantee` (`status`, `cycle`, `period`)
para poder pintar la lista de 58 clientes sin una consulta por fila. La verdad vive en
`/guarantees`; esa copia es caché y se reescribe en cada apertura, extensión y cierre.

`GET /dashboard/churn` incluye `byMonth` (bajas agrupadas por mes en hora de Ecuador, orden
cronológico) y devuelve además de las bajas los bloques `guarantees` y `refunds` con
estos mismos totales: antes de perder a un cliente está lo que se invirtió en retenerlo.

---

## Ventas (`/sales`)

Una **venta** es un acuerdo cerrado hoy que se cobra más adelante. Vive aparte de las facturas
porque al cerrarse el cliente puede no existir todavía (`clientId` es opcional). El total se
reparte en cuotas con su fecha; el sobrante del redondeo se acumula en la última para que la
suma cuadre exacta con lo acordado.

El `status` de la venta **se deriva de sus cuotas**, nunca se fija a mano:
`acordada` (ninguna cobrada) → `cobrando` (algunas) → `cobrada` (todas). `perdida` es aparte.
Las cuotas pendientes con fecha pasada se muestran como `vencida` (se calcula al leer, no se
persiste).

```bash
# Listar (status, ownerId, soldBy, clientId, q, overdueOnly, from, to, page, limit)
curl "http://localhost:8101/api/sales?status=acordada&overdueOnly=true" \
  -H "Authorization: Bearer $TOKEN"

# Cuánto dinero debe entrar: recurrente de clientes + ventas nuevas por cobrar,
# con el desglose por responsable de cobro.
curl http://localhost:8101/api/sales/summary -H "Authorization: Bearer $TOKEN"

# Registrar una venta. "frequency": unico | semanal | quincenal | mensual | trimestral
# Con "unico" se ignora installmentsCount. soldBy = quién cerró, ownerId = quién cobra.
#
# "items" es el desglose de lo vendido: el vendedor negocia la mensualidad (400,
# 300, 250…) y suele sumar extras puntuales. Si vienen items, el total sale de su
# suma y "amount" se ignora. "kind": recurrente | unico — separa lo que se repite
# cada mes de lo puntual, que es lo que el resumen reporta por separado.
#
# "billing" son los datos de factura. Van en la venta y no en el cliente porque
# quien cobra casi nunca es quien vendió y necesita razón social y RUC a mano.
curl -X POST http://localhost:8101/api/sales \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "businessName":"Panadería El Trigo",
    "items":[
      {"concept":"Mensualidad","kind":"recurrente","amount":400,
       "description":"12 publicaciones al mes + reunión quincenal"},
      {"concept":"Página web","kind":"unico","amount":500}
    ],
    "billing":{"needsInvoice":true,"legalName":"Panadería El Trigo S.A.",
               "taxId":"0992345678001","email":"factura@eltrigo.ec"},
    "frequency":"mensual",
    "installmentsCount":3,
    "firstChargeDate":"2026-09-05",
    "soldBy":"665f0a1b2c3d4e5f60718293",
    "ownerId":"665f0a1b2c3d4e5f60718294",
    "notes":"Acordado en la reunión del 12/08"
  }'

# Cambiar los conceptos vendidos. Rehace el total y el calendario de cobros, así
# que falla con 400 si ya hay alguna cuota cobrada.
curl -X PATCH http://localhost:8101/api/sales/6790ab12cd34ef5678901234/items \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"items":[{"concept":"Mensualidad","kind":"recurrente","amount":250}]}'

# Completar los datos de factura. Siempre editable, incluso con la venta cobrada:
# el número suele cargarse después. Solo pisa los campos que mandes.
curl -X PATCH http://localhost:8101/api/sales/6790ab12cd34ef5678901234/billing \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"invoiceNumber":"001-001-000000123","issuedAt":"2026-09-06"}'

# Detalle (incluye cuotas e historial completo)
curl http://localhost:8101/api/sales/6790ab12cd34ef5678901234 -H "Authorization: Bearer $TOKEN"

# Registrar el cobro de una cuota (índice base 0). Sin "amount" se cobra completa.
curl -X POST http://localhost:8101/api/sales/6790ab12cd34ef5678901234/installments/0/pay \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"amount":400,"paidAt":"2026-09-05"}'

# Mover la fecha de una cuota. La original queda en `originalDueDate` y en el historial.
curl -X PATCH http://localhost:8101/api/sales/6790ab12cd34ef5678901234/installments/1/reschedule \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"newDueDate":"2026-10-20","reason":"Pidió dos semanas más"}'

# Reasignar quién debe cobrarla
curl -X PATCH http://localhost:8101/api/sales/6790ab12cd34ef5678901234/owner \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"ownerId":"665f0a1b2c3d4e5f60718295"}'

# Dar por perdida. El motivo es obligatorio; falla con 400 si ya tiene cobros registrados.
# Valores: nunca_pago | se_arrepintio | no_contesta | se_fue_competencia | precio |
#          problema_interno | otro
curl -X POST http://localhost:8101/api/sales/6790ab12cd34ef5678901234/lose \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"nunca_pago","notes":"Tres meses sin responder"}'

# Reabrir una venta perdida
curl -X POST http://localhost:8101/api/sales/6790ab12cd34ef5678901234/reopen \
  -H "Authorization: Bearer $TOKEN"
```

### Tipo de cliente y objetivo de venta mensual

Cada venta puede llevar `categoryId` (tipo de cliente: restaurante, gimnasio… las mismas
categorías de `/clients/categories`). Si no se manda y la venta está enlazada a un cliente,
se hereda el tipo del cliente. Sin tipo, la venta queda **sin clasificar** y no suma a ninguna
línea del objetivo hasta que se ubique.

El **objetivo del mes** dice qué tipo de cliente hay que buscar, cuántos y por cuánto. Es uno
por período y se reemplaza completo en cada `PUT`. El avance cruza el objetivo con las ventas
no perdidas cuyo `agreedAt` cae en el mes.

```bash
# Registrar la venta indicando el tipo de cliente
curl -X POST http://localhost:8101/api/sales \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"businessName":"Gym Fuerza","categoryId":"66f1c0ffee0000000000a001","amount":400,"frequency":"unico","firstChargeDate":"2026-09-05","soldBy":"665f0a1b2c3d4e5f60718293","ownerId":"665f0a1b2c3d4e5f60718295"}'

# Ubicar (o reubicar) una venta en un tipo. "categoryId": null la deja sin clasificar.
curl -X PATCH http://localhost:8101/api/sales/6790ab12cd34ef5678901234/category \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"categoryId":"66f1c0ffee0000000000a001"}'

# Listar solo las que faltan ubicar
curl "http://localhost:8101/api/sales?uncategorized=true" -H "Authorization: Bearer $TOKEN"

# Fijar el objetivo del mes (reemplaza las líneas anteriores). Una categoría no se repite;
# cada línea necesita targetCount o targetAmount mayor a cero.
curl -X PUT http://localhost:8101/api/sales/goals/2026-09 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"lines":[
        {"categoryId":"66f1c0ffee0000000000a001","targetCount":5,"targetAmount":2000},
        {"categoryId":"66f1c0ffee0000000000a002","targetCount":3,"targetAmount":1200,"notes":"Prioridad: zona norte"}
      ],"notes":"Meta que pasó ventas para septiembre"}'

# Leer el objetivo tal cual se guardó
curl http://localhost:8101/api/sales/goals/2026-09 -H "Authorization: Bearer $TOKEN"

# Avance del mes
curl http://localhost:8101/api/sales/goals/2026-09/progress -H "Authorization: Bearer $TOKEN"
```

`GET /sales/goals/:period/progress` devuelve:

- `totals`: `targetCount`/`targetAmount` (la meta), `soldCount`/`soldAmount` (todo lo vendido
  en el mes), `inGoalCount`/`inGoalAmount` (solo lo que cae en una línea), `countPct`/`amountPct`
  y `unclassifiedCount`/`unclassifiedAmount`.
- `lines[]`: por tipo de cliente del objetivo, meta vs. vendido, `remainingCount`,
  `remainingAmount`, porcentajes y las ventas que suman (`sales[]`).
- `outside[]`: ventas con un tipo que **no** está en el objetivo, agrupadas por tipo. Cuentan en
  `soldAmount` pero en ninguna línea; sirven para decidir si se abre una línea nueva.
- `unclassified[]`: ventas sin tipo. Hay que ubicarlas con `PATCH /sales/:id/category`.
- `categories[]`: tipos activos, para ubicar ventas o añadir líneas.

`GET /sales/summary` devuelve, dentro de `newSales`: `recurringSold` y `oneOffSold` (lo vendido
separado por naturaleza) y `missingInvoice` (cuántas ventas piden factura y siguen sin número).

Cada mutación deja entrada en el `history` embebido de la venta **y** en el `AuditLog`
(`sale.create`, `sale.installment.paid`, `sale.installment.reschedule`, `sale.owner.change`,
`sale.items.update`, `sale.billing.update`, `sale.category.change`, `sale.lost`; el objetivo
deja `sale.goal.save`). Escribir requiere rol `admin` o
`superadmin`; leer basta con estar autenticado.

---

## Dashboard / Settings / Workspaces / Cron

### Dashboard

Todas las rutas de `/dashboard` requieren token (cualquier rol). El parámetro `period` es opcional y usa el formato `YYYY-MM`; si se omite se toma el período actual.

```bash
# Resumen del período: facturado, cobrado, pendiente, vencido, % cobranza, conteos de clientes/facturas
curl "http://localhost:8101/api/dashboard/summary?period=2026-08" \
  -H "Authorization: Bearer $TOKEN"

# Serie de ingresos por período (por defecto 12 meses, máximo 36)
curl "http://localhost:8101/api/dashboard/revenue-series?months=12" \
  -H "Authorization: Bearer $TOKEN"

# Conteo y monto por estado de factura
curl "http://localhost:8101/api/dashboard/status-breakdown?period=2026-08" \
  -H "Authorization: Bearer $TOKEN"

# Monto cobrado agrupado por método de pago
curl "http://localhost:8101/api/dashboard/method-breakdown?period=2026-08" \
  -H "Authorization: Bearer $TOKEN"

# Top de clientes por monto facturado (limit por defecto 10)
curl "http://localhost:8101/api/dashboard/top-clients?period=2026-08&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# Antigüedad de la mora: 0-7 / 8-15 / 16-30 / 30+ con conteo y monto
curl "http://localhost:8101/api/dashboard/aging" \
  -H "Authorization: Bearer $TOKEN"

# Cobros próximos: facturas pending/partial con dueDate dentro de N días (default 15)
curl "http://localhost:8101/api/dashboard/upcoming?days=15" \
  -H "Authorization: Bearer $TOKEN"

# Pronóstico semanal de lo que DEBE entrar (weeks 1-26, default 8).
# Mezcla las dos fuentes de cobro en los mismos tramos: saldo abierto de las
# facturas (amount - paidAmount) y cuotas sin cobrar de las ventas. Semanas de
# lunes a domingo. Lo vencido NO se mete en ninguna semana: va aparte en
# `overdue`, con su antigüedad en tramos y separado por fuente. Lo que vence más
# allá del horizonte se deja fuera en vez de amontonarlo en la última semana.
curl "http://localhost:8101/api/dashboard/cashflow?weeks=8" \
  -H "Authorization: Bearer $TOKEN"

# Cobrado REAL por semana hacia atrás (weeks 1-26, default 6), separando:
#   newBusiness -> pagos de clientes con menos de un mes + cuotas de ventas
#   recurring   -> pagos de clientes con MÁS de un mes desde su startDate
# La antigüedad se evalúa contra la fecha del cobro, no contra hoy, para que una
# semana pasada no se reclasifique sola con el tiempo.
curl "http://localhost:8101/api/dashboard/collected?weeks=6" \
  -H "Authorization: Bearer $TOKEN"

# Listado de facturas vencidas con datos del cliente y días de mora (limit default 50)
curl "http://localhost:8101/api/dashboard/overdue?limit=50" \
  -H "Authorization: Bearer $TOKEN"

# Reporte de bajas: por qué se van los clientes y cuánto ingreso mensual se perdió
curl http://localhost:8101/api/dashboard/churn -H "Authorization: Bearer $TOKEN"
```

Respuesta de `/churn`:

```json
{
  "byReason": [
    {
      "reason": "impago",
      "label": "Impago / mora",
      "count": 4,
      "lostMonthlyAmount": 1680,
      "avgLifetimeDays": 312,
      "totalLifetimeRevenue": 18400
    }
  ],
  "byMonth": [
    {
      "month": "2026-07",
      "count": 3,
      "lostMonthlyAmount": 1260
    }
  ],
  "totals": {
    "archivedClients": 7,
    "lostMonthlyAmount": 2940,
    "avgLifetimeDays": 366,
    "totalLifetimeRevenue": 31250
  },
  "recent": [
    {
      "clientId": "665f0a1b2c3d4e5f60718293",
      "name": "Restaurante La Casa",
      "archivedAt": "2026-07-30T17:05:00.000Z",
      "reason": "impago",
      "label": "Impago / mora",
      "lifetimeDays": 418,
      "lifetimeRevenue": 5460,
      "amount": 420,
      "attachmentsCount": 2
    }
  ]
}
```

Respuesta de `/summary`:

```json
{
  "period": "2026-08",
  "label": "Agosto de 2026",
  "expectedAmount": 24580,
  "collectedAmount": 19120,
  "pendingAmount": 3210,
  "overdueAmount": 2250,
  "collectionRate": 77.8,
  "invoicesTotal": 62,
  "invoicesPaid": 41,
  "invoicesPending": 15,
  "invoicesOverdue": 6,
  "idealMonthlyAmount": 24580,
  "clientsTotal": 60,
  "clientsActive": 54,
  "archivedClients": 7,
  "clientsOverdue": 6,
  "workspacesDeactivated": 2
}
```

`idealMonthlyAmount` es la cifra clave: cuánto debería ingresar Bakano cada mes si todos los
clientes activos no archivados pagaran. Los conteos de clientes excluyen a los archivados.

### Settings

Lectura: cualquier rol autenticado. Escritura (`PUT`, `POST`): `superadmin` o `admin`.

```bash
# Preferencias de notificaciones (se crea con defaults si no existe)
curl http://localhost:8101/api/settings/notifications \
  -H "Authorization: Bearer $TOKEN"

# Actualizar preferencias: destinatarios, toggles, días de gracia, etc.
curl -X PUT http://localhost:8101/api/settings/notifications \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "recipients": ["financiero@bakano.ec", "gerencia@bakano.ec"],
    "ccEmails": [],
    "replyTo": "financiero@bakano.ec",
    "toggles": {
      "paymentRegistered": true,
      "reminderBefore": true,
      "overdue": true,
      "deactivation": true,
      "monthlySummary": true
    },
    "reminderDaysBefore": 3,
    "graceDays": 5,
    "warnBeforeDeactivationDays": 2,
    "autoDeactivateEnabled": true,
    "sendHour": 8
  }'

# Enviar un correo de prueba (si se omite "to" se usan los destinatarios configurados)
curl -X POST http://localhost:8101/api/settings/notifications/test \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"dreyes@bakano.ec"}'

# Configuración de marca de la app
curl http://localhost:8101/api/settings/app \
  -H "Authorization: Bearer $TOKEN"

curl -X PUT http://localhost:8101/api/settings/app \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "appName": "Bakano Finanzas",
    "currency": "USD",
    "timezone": "America/Guayaquil",
    "brandColors": { "primary": "#e6285c", "secondary": "#85529c" }
  }'

# Subir el logo (multipart, campo "logo", máximo 5 MB, solo imágenes)
curl -X POST http://localhost:8101/api/settings/app/logo \
  -H "Authorization: Bearer $TOKEN" \
  -F "logo=@./logo-bakano.png"
```

`alwaysTo` siempre incluye `dreyes@bakano.ec`; los destinatarios finales de cada envío son `recipients + alwaysTo` deduplicados en minúsculas. Si un toggle está en `false`, ese tipo de correo no se envía (queda registrado en consola). Todos los envíos —exitosos o fallidos— quedan en la colección `EmailLog`.

### Workspaces (proxy al backend de métricas)

Requiere `METRICS_API_URL` y `FINANCE_API_KEY`. La escritura es `superadmin` o `admin`.

```bash
# Estado de la conexión con el backend de métricas
curl http://localhost:8101/api/workspaces/health \
  -H "Authorization: Bearer $TOKEN"

# Lista de workspaces cruzada con el cliente de finanzas asociado (Client.workspaceId)
curl http://localhost:8101/api/workspaces \
  -H "Authorization: Bearer $TOKEN"

# Detalle de un workspace + su cliente
curl http://localhost:8101/api/workspaces/6713aa11bb22cc33dd44ee55 \
  -H "Authorization: Bearer $TOKEN"

# Activar / desactivar manualmente (escribe AuditLog y actualiza Client.workspaceIsActive)
curl -X PATCH http://localhost:8101/api/workspaces/6713aa11bb22cc33dd44ee55/active \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isActive": false, "reason": "Mora de dos períodos"}'
```

`GET /workspaces` devuelve además `orphanClients`: clientes de finanzas con `workspaceId` que ya no existe en métricas. Si el backend de métricas no responde, el listado devuelve `items: []` y registra el error en `AuditLog`; el resto de operaciones devuelve `502` con un mensaje en español.

### Cron

Se autentica con el header `x-cron-secret` (valor de `CRON_SECRET`) **o** con un token JWT de `superadmin`.

```bash
export CRON_SECRET=tu_secreto

# Job diario: recalcula estados, envía recordatorios, alertas de mora,
# avisos previos y ejecuta las auto-desactivaciones
curl -X POST http://localhost:8101/api/cron/run/daily \
  -H "x-cron-secret: $CRON_SECRET"

# Job mensual: genera las facturas del período actual y envía el resumen del período anterior
curl -X POST http://localhost:8101/api/cron/run/monthly \
  -H "x-cron-secret: $CRON_SECRET"

# Generar facturas de un período específico
curl -X POST http://localhost:8101/api/cron/run/generate/2026-08 \
  -H "x-cron-secret: $CRON_SECRET"

# Alternativa con token de superadmin
curl -X POST http://localhost:8101/api/cron/run/daily \
  -H "Authorization: Bearer $TOKEN"
```

Respuesta del job diario:

```json
{
  "startedAt": "2026-08-08T13:00:00.000Z",
  "finishedAt": "2026-08-08T13:00:04.180Z",
  "recalculated": 3,
  "remindersSent": 7,
  "overdueAlerts": 2,
  "warnings": 1,
  "deactivated": 1,
  "errors": []
}
```

Cada paso corre en su propio `try/catch`: un fallo se acumula en `errors` sin abortar el resto del job.

### Schedulers automáticos

Con `CRON_ENABLED=true` (valor por defecto) se registran al arrancar el servidor, en la zona horaria de `TZ`:

| Expresión     | Job      | Qué hace                                                                  |
| ------------- | -------- | ------------------------------------------------------------------------- |
| `0 8 * * *`   | Diario   | Recalcula estados, recordatorios, alertas de mora, avisos y desactivaciones |
| `5 1 1 * *`   | Mensual  | Genera las facturas del mes y envía el resumen del mes anterior             |

### Correos que envía el sistema

| Tipo                    | Disparador                                             | Toggle              |
| ----------------------- | ------------------------------------------------------ | ------------------- |
| `payment_registered`    | Al registrar un pago                                   | `paymentRegistered` |
| `reminder_before_due`   | `reminderDaysBefore` días antes del cobro              | `reminderBefore`    |
| `overdue_alert`         | Primera vez que la factura pasa a `overdue`            | `overdue`           |
| `overdue_alert` (aviso) | Mora ≥ `graceDays - warnBeforeDeactivationDays`        | `deactivation`      |
| `workspace_deactivated` | Auto-desactivación por mora superior a `graceDays`     | `deactivation`      |
| `workspace_reactivated` | Al regularizar el pago y reactivar el workspace        | `deactivation`      |
| `monthly_summary`       | Job mensual (`5 1 1 * *`)                              | `monthlySummary`    |
| `payment_deferred`      | `PATCH /invoices/:id/defer` (acuerdo de pago)          | `paymentRegistered` |
| `client_archived`       | Al dar de baja a un cliente                            | `overdue`           |
| `test`                  | `POST /settings/notifications/test`                    | —                   |

**Toggles reutilizados.** `NotificationSetting.toggles` no se amplió para los dos tipos nuevos:
se mantiene el esquema original y `payment_deferred` reutiliza el toggle `paymentRegistered`
(es un evento del mismo flujo de cobro) y `client_archived` reutiliza `overdue`. Así no hace
falta migrar los documentos existentes ni el formulario de preferencias.

Si `RESEND_API_KEY` está vacío no se envía nada: se loguea `[email] Resend no configurado` y se registra un `EmailLog` con `status: "failed"`. El servicio de correo nunca lanza excepciones hacia el controlador.

### Scripts de seed

```bash
pnpm seed:admin    # crea/asegura el superadmin dreyes@bakano.ec
pnpm seed:clients  # carga los 60 clientes reales (idempotente por nombre)
```


## Imagen del espacio de trabajo

Cada workspace de métricas trae su identidad visual (logo del cliente o foto de su página de
Meta). El backend la reexpone tal cual y además **cachea** la mejor imagen disponible en
`client.workspaceImageUrl`.

Campos que `GET /workspaces` y `GET /workspaces/:id` devuelven por item, tal como llegan de
métricas: `imageUrl`, `logoUrl`, `pictureUrl`, `images[]` (`{name, url, categoria, tipo}`),
`pageName`, `instagramAccountName`, `tipoNegocio`, `vertical`, `adminPhotoUrl`, `adminName`,
`adminEmail`. Se agrega `resolvedImageUrl` con la primera imagen no vacía en ese orden de
preferencia (`imageUrl` → `logoUrl` → `pictureUrl` → `images[0].url` → `adminPhotoUrl`).

`POST /clients/:id/link-workspace` consulta métricas al vincular y guarda `workspaceImageUrl`,
`workspaceName` y `workspaceIsActive` en el cliente. Si métricas no responde el vínculo se crea
igual y la imagen queda en `null` hasta la próxima sincronización.

`GET /clients/:id/workspace-suggestions` devuelve `imageUrl` en cada sugerencia para que el
modal de vinculación las muestre.

```bash
# Refrescar imagen, nombre y estado de TODOS los clientes vinculados con una sola llamada a
# métricas (no una por cliente). Solo admin y superadmin.
curl -X POST http://localhost:8101/api/clients/sync-workspace-images \
  -H "Authorization: Bearer $TOKEN"
# → { "updated": 74, "notFound": 3, "total": 77, "configured": true }
```

## Acceso abierto por excepción

### `shouldBeClosed` — el espacio debería estar cerrado

Estado **derivado**, nunca guardado en la base. Un cliente tiene `shouldBeClosed: true` cuando:

1. tiene al menos una factura en estado `overdue`, **y**
2. su mora máxima supera sus días de gracia efectivos (`client.graceDays ?? settings.graceDays`), **y**
3. su espacio de trabajo sigue abierto (`workspaceIsActive !== false`).

Se calcula con una agregación sobre `Client` + `Invoice` y viaja junto a `overdueAmount`,
`maxDaysOverdue`, `overdueInvoices` y `effectiveGraceDays` en:

| Endpoint                | Dónde aparece                                            |
| ----------------------- | -------------------------------------------------------- |
| `GET /clients`          | en cada item de `items[]`                                 |
| `GET /clients/:id`      | en la raíz del detalle                                    |
| `GET /workspaces`       | en cada item y en cada `orphanClients[]`                  |
| `GET /workspaces/:id`   | en la raíz                                                |
| `GET /dashboard/summary`| como contadores `shouldBeClosedCount` y `accessOverridesCount` |

### `accessOverride` — la excepción explícita

Cuando se abre el acceso a un moroso a propósito, el cliente guarda:

```jsonc
{
  "accessOverride": {
    "enabled": true,
    "reason": "Firmó acuerdo de pago para el viernes",
    "grantedAt": "2026-08-08T15:20:00.000Z",
    "grantedBy": "68a1...",
    "grantedByName": "Diego Reyes",
    "until": "2026-08-15T00:00:00.000Z", // null = indefinida, hay que revocarla a mano
    "revokedAt": null,
    "revokedByName": null
  }
}
```

`shouldBeClosed` **sigue en `true`** mientras la excepción esté vigente: la excepción no
"arregla" la mora, solo autoriza el acceso. Por eso el frontend debe pintarlo en rojo. El
booleano `accessOverrideActive` (`enabled === true && (until == null || until > ahora)`)
acompaña a `shouldBeClosed` en todas las respuestas anteriores.

### Endpoints

```bash
# Abrir el acceso. "reason" es OBLIGATORIO → 400 "Debes indicar por qué se abre el acceso."
# "until" es opcional; si se omite o va en null la excepción es indefinida.
# El cliente debe tener workspaceId vinculado o responde 400.
curl -X POST http://localhost:8101/api/clients/68b0.../grant-access \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Firmó acuerdo de pago para el viernes","until":"2026-08-15"}'

# Excepción indefinida
curl -X POST http://localhost:8101/api/clients/68b0.../grant-access \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Cliente estratégico, lo autoriza gerencia"}'

# Revocar la excepción y cerrar el espacio si sigue en mora (comportamiento por defecto)
curl -X DELETE http://localhost:8101/api/clients/68b0.../grant-access \
  -H "Authorization: Bearer $TOKEN"

# Revocar SIN cerrar el espacio
curl -X DELETE http://localhost:8101/api/clients/68b0.../grant-access \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"closeWorkspace":false}'

# Listado de todos los abiertos por excepción, con deuda, mora y días restantes
curl http://localhost:8101/api/clients/access-overrides \
  -H "Authorization: Bearer $TOKEN"
```

`POST /clients/:id/grant-access` activa el espacio en métricas con el motivo
`"Acceso abierto por excepción: <reason>"`, limpia `deactivatedAt` / `deactivationReason`,
marca `deactivation.reactivatedAt` en las facturas vencidas que el cron había desactivado,
registra un `AuditLog` con `level: "warn"` y dispara el correo `access_granted`.

Respuesta de `GET /clients/access-overrides`:

```json
{
  "total": 2,
  "items": [
    {
      "_id": "68b0...",
      "name": "Casa Fiori",
      "workspaceId": "6712...",
      "workspaceName": "Casa Fiori",
      "workspaceImageUrl": "https://scontent.xx.fbcdn.net/...",
      "workspaceIsActive": true,
      "reason": "Firmó acuerdo de pago para el viernes",
      "grantedAt": "2026-08-08T15:20:00.000Z",
      "grantedByName": "Diego Reyes",
      "until": "2026-08-15T00:00:00.000Z",
      "daysLeft": 7,
      "expired": false,
      "overdueAmount": 420,
      "maxDaysOverdue": 19,
      "overdueInvoices": 2,
      "currency": "USD"
    }
  ]
}
```

### Qué hace el cron con las excepciones

El job diario (`0 8 * * *`) suma dos pasos:

1. **Excepciones vencidas** — corre *antes* de la auto-desactivación. Busca los clientes con
   `accessOverride.enabled === true` y `until != null && until <= hoy`, apaga la excepción
   (`revokedByName: "Proceso automático (excepción vencida)"`) y, si el cliente **sigue en
   mora**, desactiva el espacio en métricas y envía el correo `workspace_deactivated`
   indicando que venció la excepción. Se cuenta en `expiredOverrides`.
2. **Auto-desactivación** — salta a los clientes con excepción vigente (`isOverrideActive`) y
   los cuenta en `skippedByOverride` en lugar de cerrarles el espacio.

Resumen del job diario con los campos nuevos:

```json
{
  "recalculated": 3,
  "remindersSent": 7,
  "overdueAlerts": 2,
  "warnings": 1,
  "deactivated": 1,
  "skippedByOverride": 4,
  "expiredOverrides": 1,
  "errors": []
}
```

### Correos nuevos

| Tipo             | Disparador                                    | Toggle         |
| ---------------- | --------------------------------------------- | -------------- |
| `access_granted` | `POST /clients/:id/grant-access`              | `deactivation` |
| `access_revoked` | `DELETE /clients/:id/grant-access`            | `deactivation` |

Ambos reutilizan el toggle `deactivation`: es el mismo canal por el que se avisan los cierres
de espacio, así que el esquema de `NotificationSetting` no cambia. El correo `access_granted`
deja explícito que el espacio **debería estar cerrado** y que se abrió a propósito, con monto
adeudado, días de mora, motivo, quién lo autorizó y hasta cuándo.

El resumen mensual (`monthly_summary`) incluye una sección **"Abiertos por excepción"** con
todos los clientes en esa situación, si los hay.

---

## Banco / Mercury (`/mercury`) — solo lectura

Integración **read-only** con la API de Mercury (`https://api.mercury.com/api/v1`). El backend
solo emite `GET`: no existe ninguna ruta que mueva dinero. Requiere rol `superadmin` o `admin`.

Configuración (`.env`):

```
MERCURY_API_URL=https://api.mercury.com/api/v1
MERCURY_API_TOKEN=secret-token:mercury_production_...   # incluye el prefijo "secret-token:"
MERCURY_TIMEOUT_MS=20000
MERCURY_CACHE_TTL=60      # segundos de caché en memoria
```

> Usar un token **`Read Only` y sin IPs en el whitelist**: Mercury solo exige whitelist a los
> tokens con escritura, y Vercel no tiene IP de salida fija. Si el token tiene alguna IP en la
> lista, Mercury la aplica y responde `401 ipNotWhitelisted`; el backend lo traduce a `502` con
> el mensaje y la IP rechazada (visible en `GET /mercury/health`).

Todas las rutas aceptan `?refresh=true` para saltarse la caché.

| Método | Ruta                                     | Qué devuelve                                              |
| ------ | ---------------------------------------- | --------------------------------------------------------- |
| GET    | `/mercury/health`                        | `{ configured, reachable, message, errorCode, ip }`        |
| GET    | `/mercury/overview?days=180`             | Cuentas, totales, flujo mensual, contrapartes y últimos 15 |
| GET    | `/mercury/subscriptions?days=365`        | Suscripciones inferidas de los cargos recurrentes          |
| GET    | `/mercury/accounts`                      | `{ configured, total, currentBalance, availableBalance, items }` |
| GET    | `/mercury/accounts/:id`                  | Cuenta por ID                                              |
| GET    | `/mercury/accounts/:id/transactions`     | `{ total, limit, offset, items }`                          |
| GET    | `/mercury/accounts/:id/cards`            | `{ total, items }`                                         |
| GET    | `/mercury/accounts/:id/statements`       | `{ total, items }` (incluye `downloadUrl` del PDF)         |
| GET    | `/mercury/treasury`                      | Cuentas de tesorería y su saldo                            |

Filtros de `/transactions`: `limit` (1–500), `offset`, `order` (`asc|desc`), `start`, `end`
(`YYYY-MM-DD`), `search`, `status` (`pending|sent|cancelled|failed|reversed|blocked`),
`mercuryCategory`, `categoryId`, y `onlySubscriptions=true`.

Cada movimiento vuelve con `subscription`: `null`, o `{ key, name, cadenceLabel, status,
monthlyCost }` si el cargo pertenece a una suscripción detectada. Con `onlySubscriptions=true`
el filtrado y la paginación se hacen en el backend (Mercury no conoce esa marca).

> El `total` que devuelve Mercury en `/transactions` es el tamaño de la página, **no** el total
> real de movimientos. Por eso la respuesta expone `hasMore` (se pide un registro extra para
> saber si hay página siguiente) en lugar de un total y un número de páginas.

### Suscripciones

Mercury no marca qué cobro es una suscripción. `/mercury/subscriptions` las **infiere**:
agrupa los cargos de salida por comercio normalizado **y monto exacto**, colapsa los reintentos
(un cobro rechazado se reintenta varios días seguidos y no debe contarse como cobros distintos)
y se queda con los grupos donde ese monto domina el gasto del comercio. Los gastos de monto
variable (Uber, comida, publicidad) quedan fuera y se devuelven aparte en `candidates`.

Estados: `active` (al día) · `due` (ya debía haber cobrado) · `failing` (el banco rechazó el
último cobro; el servicio se va a cortar) · `stale` (sin cobros hace más de dos ciclos).

`history` informa cuántos días de movimientos había realmente disponibles: con pocas semanas de
cuenta, la frecuencia y el costo mensual salen marcados como `estimated`.

```bash
curl "http://localhost:8101/api/mercury/health" -H "Authorization: Bearer $TOKEN"
curl "http://localhost:8101/api/mercury/overview?days=180" -H "Authorization: Bearer $TOKEN"
curl "http://localhost:8101/api/mercury/accounts/$ACCOUNT_ID/transactions?limit=50&status=sent" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Stripe (`/stripe`)

Conexión con Stripe para pagos con tarjeta. La clave (`STRIPE_SECRET_KEY`, acepta `sk_` o `rk_`
restricted) y el `STRIPE_WEBHOOK_SECRET` van por entorno; sin ellas los endpoints responden 503.

### Webhook (público, firma verificada)

`POST /api/stripe/webhook` se monta **antes** del `express.json` global porque la firma se
verifica sobre el body crudo. Maneja `checkout.session.completed` y `charge.succeeded`; es
idempotente por `eventId` (modelo `StripeEvent`) y por `stripeChargeId` único en `Payment`.
Un cargo de un customer sin vincular queda como `unmatched` (no crea pagos huérfanos) y se
audita en `AuditLog` con `stripe.charge_unmatched`.

```bash
# En local, reenviar eventos de prueba:
stripe listen --forward-to localhost:8101/api/stripe/webhook
stripe trigger charge.succeeded
```

### Vinculación e importación (admin)

```bash
# Estado de la integración
curl "http://localhost:8101/api/stripe/status" -H "Authorization: Bearer $TOKEN"

# Customers de Stripe con sugerencias de cliente por similitud de nombre (score 0-1)
curl "http://localhost:8101/api/stripe/import/customers" -H "Authorization: Bearer $TOKEN"

# Vincular un perfil (falla 409 si el customer ya es de otro cliente).
# Un cliente puede acumular VARIOS perfiles (customers duplicados en Stripe);
# el primero vinculado queda como principal y es el que usa el Checkout.
curl -X POST "http://localhost:8101/api/stripe/import/link" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"clientId":"<id>","stripeCustomerId":"cus_..."}'

# Desvincular UN perfil (los demás se conservan)
curl -X DELETE "http://localhost:8101/api/stripe/import/link/<clientId>/<cus_...>" \
  -H "Authorization: Bearer $TOKEN"

# Desvincular TODOS los perfiles del cliente
curl -X DELETE "http://localhost:8101/api/stripe/import/link/<clientId>" \
  -H "Authorization: Bearer $TOKEN"

# Importar cargos históricos del cliente (recorre TODOS sus perfiles vinculados;
# idempotente por stripeChargeId, sin correos masivos). Devuelve imported / skipped / unmatched.
curl -X POST "http://localhost:8101/api/stripe/import/charges" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"clientId":"<id>"}'
```

El match de factura para un cargo histórico: período del mes del cobro → misma deuda por monto →
la abierta más vieja. Lo que no calza se devuelve en `unmatched` para aplicarlo a mano.

---

## Comprobantes del portal (`/payment-submissions`)

Transferencias subidas por el CLIENTE desde metrics. Flujo de aprobación manual con SLA de
**48 horas laborables** (`reviewDueAt`). El fee bancario lo asume el cliente: al aprobar, el
pago se registra por el **neto** (`netAmount`) y la factura puede quedar `partial`.

```bash
# Pendientes (admin)
curl "http://localhost:8101/api/payment-submissions?status=pending" -H "Authorization: Bearer $TOKEN"

# Aprobar: crea el Payment real (method transferencia, source client_submission).
# Si la submission no traía factura, se aplica a la abierta más vieja o a la indicada.
curl -X POST "http://localhost:8101/api/payment-submissions/<id>/approve" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"invoiceId":"<opcional>","reviewNote":"ok"}'

# Rechazar (motivo obligatorio: el cliente lo ve en su portal)
curl -X POST "http://localhost:8101/api/payment-submissions/<id>/reject" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reviewNote":"El comprobante no corresponde al monto"}'
```

Ambas acciones notifican a la empresa por Resend (toggle `paymentSubmission`).

---

## Portal del cliente (`/portal`) — solo servidor a servidor

Consumido únicamente por `ads-bakano-clients-backapp` con el header `x-metrics-key`
(`METRICS_PROXY_KEY`, clave distinta de `FINANCE_API_KEY`). metrics ya validó el JWT del
cliente y su pertenencia al workspace.

```bash
# Foto de facturación del workspace: cliente, resumen, facturas, pagos, submissions y
# consumo CRM acumulado (crmConsumption.items + totals{total, currentMonth, byMonth})
curl "http://localhost:8101/api/portal/workspaces/<workspaceId>/billing" \
  -H "x-metrics-key: $METRICS_PROXY_KEY"

# Link de pago con tarjeta (Checkout Session) por el saldo de la factura
curl -X POST "http://localhost:8101/api/portal/workspaces/<workspaceId>/checkout-session" \
  -H "x-metrics-key: $METRICS_PROXY_KEY" -H "Content-Type: application/json" \
  -d '{"invoiceId":"<id>","returnUrl":"https://metrics.bakano.ec/workspaces/<id>/facturacion"}'

# Subir comprobante de transferencia (multipart)
curl -X POST "http://localhost:8101/api/portal/workspaces/<workspaceId>/submissions" \
  -H "x-metrics-key: $METRICS_PROXY_KEY" \
  -F "receipt=@comprobante.pdf" -F "grossAmount=500" -F "feeAmount=15" \
  -F "submittedByName=Juan Pérez" -F "submittedByEmail=juan@cliente.com"
```

---

## Consumo CRM (`/crm-consumption`)

Cargos de Stripe de clientes vinculados que NO calzan con ninguna factura: es el consumo del
CRM (GoHighLevel) que Bakano provee. Se guardan solos — desde el webhook y desde la importación —
para que ese dinero quede a la vista en su propia sección en vez de perderse como "sin factura".

```bash
# Listado con totales (mes actual, histórico y ranking por cliente)
curl "http://localhost:8101/api/crm-consumption?clientId=&period=2026-08" \
  -H "Authorization: Bearer $TOKEN"

# Reclasificar: el cargo era una mensualidad → se convierte en Payment de esa factura
# (con todos sus efectos) y sale de consumo CRM
curl -X POST "http://localhost:8101/api/crm-consumption/<id>/apply" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"invoiceId":"<id>"}'

# Eliminar el registro (solo superadmin; el cargo sigue existiendo en Stripe)
curl -X DELETE "http://localhost:8101/api/crm-consumption/<id>" \
  -H "Authorization: Bearer $TOKEN"
```

La respuesta de `POST /api/stripe/import/charges` ahora devuelve `crmSaved` en lugar de
`unmatched`: los cargos sin factura quedan registrados como consumo, no requieren acción manual.
