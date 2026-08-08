# Bakano Finanzas — API

Base URL local: `http://localhost:8200/api`

Todas las rutas requieren `Authorization: Bearer <token>` excepto `POST /auth/login`.

Roles: `superadmin` (todo), `admin` (lectura + escritura de clientes/facturas/pagos), `viewer` (solo lectura).

Respuestas de error: `{ "message": "..." }`, y en validaciones `{ "message": "Datos inválidos en la solicitud", "details": [{ "field": "...", "message": "..." }] }`.

Listados paginados: `{ "items": [], "total": 0, "page": 1, "limit": 50, "pages": 1 }`.

---

## Auth

### Login (empieza por aquí)

```bash
curl -X POST http://localhost:8200/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dreyes@bakano.ec","password":"***REMOVED***"}'
```

Guarda el token para el resto de llamadas:

```bash
export TOKEN=$(curl -s -X POST http://localhost:8200/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dreyes@bakano.ec","password":"***REMOVED***"}' | jq -r .token)
```

### Perfil autenticado

```bash
curl http://localhost:8200/api/auth/me -H "Authorization: Bearer $TOKEN"
```

### Cambiar contraseña

```bash
curl -X POST http://localhost:8200/api/auth/change-password \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"currentPassword":"***REMOVED***","newPassword":"nuevaClave2026"}'
```

---

## Usuarios (`/users`) — solo `superadmin`, salvo `GET /users/me`

```bash
# Mi perfil (cualquier rol autenticado)
curl http://localhost:8200/api/users/me -H "Authorization: Bearer $TOKEN"

# Listar con filtros
curl "http://localhost:8200/api/users?q=diego&role=admin&isActive=true&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Detalle
curl http://localhost:8200/api/users/665f0a1b2c3d4e5f60718293 -H "Authorization: Bearer $TOKEN"

# Crear
curl -X POST http://localhost:8200/api/users \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Ana Torres","email":"ana@bakano.ec","password":"claveSegura1","role":"admin","receivesNotifications":true}'

# Actualizar (si mandas password se re-hashea)
curl -X PUT http://localhost:8200/api/users/665f0a1b2c3d4e5f60718293 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Ana T.","role":"viewer"}'

# Activar / desactivar
curl -X PATCH http://localhost:8200/api/users/665f0a1b2c3d4e5f60718293/active \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"isActive":false}'

# Eliminar
curl -X DELETE http://localhost:8200/api/users/665f0a1b2c3d4e5f60718293 \
  -H "Authorization: Bearer $TOKEN"
```

No se puede eliminar/desactivar al último superadministrador activo ni a tu propia cuenta.

---

## Clientes (`/clients`)

```bash
# Listar (q, paymentMethod, billingType, isActive, hasWorkspace, tag, page, limit, sort)
curl "http://localhost:8200/api/clients?q=anderson&isActive=true&billingType=monthly&sort=-createdAt&page=1&limit=50" \
  -H "Authorization: Bearer $TOKEN"

# Estadísticas globales
curl http://localhost:8200/api/clients/stats -H "Authorization: Bearer $TOKEN"

# Detalle
curl http://localhost:8200/api/clients/665f0a1b2c3d4e5f60718293 -H "Authorization: Bearer $TOKEN"

# Crear (cobro único)
curl -X POST http://localhost:8200/api/clients \
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
curl -X POST http://localhost:8200/api/clients \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name":"Anderson Boscán",
    "amount":420,
    "collectionDayLabel":"Último viernes laborable",
    "billingType":"monthly",
    "splits":[{"label":"Primer pago","amount":210,"day":15},{"label":"Segundo pago","amount":210,"day":null}]
  }'

# Actualizar
curl -X PUT http://localhost:8200/api/clients/665f0a1b2c3d4e5f60718293 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"amount":480,"collectionDay":10}'

# Eliminar — YA NO BORRA: responde 400 y te pide usar la baja
curl -X DELETE http://localhost:8200/api/clients/665f0a1b2c3d4e5f60718293 \
  -H "Authorization: Bearer $TOKEN"

# Activar / desactivar
curl -X PATCH http://localhost:8200/api/clients/665f0a1b2c3d4e5f60718293/active \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"isActive":false,"reason":"Contrato finalizado"}'

# Vincular workspace de métricas
curl -X POST http://localhost:8200/api/clients/665f0a1b2c3d4e5f60718293/link-workspace \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"workspaceId":"6710aa11bb22cc33dd44ee55","workspaceName":"La Casa"}'

# Desvincular workspace
curl -X DELETE http://localhost:8200/api/clients/665f0a1b2c3d4e5f60718293/link-workspace \
  -H "Authorization: Bearer $TOKEN"

# Sugerencias de workspace (top 5 por similitud de nombre; [] si métricas no está configurado)
curl http://localhost:8200/api/clients/665f0a1b2c3d4e5f60718293/workspace-suggestions \
  -H "Authorization: Bearer $TOKEN"

# Backfill histórico: genera facturas desde fromDate y marca pagadas hasta markPaidUntil
curl -X POST http://localhost:8200/api/clients/665f0a1b2c3d4e5f60718293/backfill \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fromDate":"2025-01-01","markPaidUntil":"2026-06-30"}'
```

### Bajas de clientes (archivado, nunca borrado)

El listado normal (`GET /clients`) **excluye** los archivados. Usa `archived=true` para verlos
solo a ellos o `archived=all` para verlos todos. Cada item trae `lifetimeDays` calculado.

```bash
# Listar solo archivados / todos
curl "http://localhost:8200/api/clients?archived=true" -H "Authorization: Bearer $TOKEN"
curl "http://localhost:8200/api/clients?archived=all" -H "Authorization: Bearer $TOKEN"

# Atajo: bajas con motivo, duración e ingreso total, ordenadas por fecha de baja desc
curl "http://localhost:8200/api/clients/archived?limit=100" -H "Authorization: Bearer $TOKEN"

# Dar de baja SIN adjuntos (JSON). "reason" es obligatorio.
# Valores: impago | cancelacion_cliente | cierre_negocio | competencia | precio |
#          insatisfaccion_resultados | pausa_temporal | fin_contrato | decision_bakano | otro
curl -X POST http://localhost:8200/api/clients/665f0a1b2c3d4e5f60718293/archive \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"impago","notes":"Tres meses sin pagar, no responde WhatsApp"}'

# Dar de baja CON respaldos (multipart, campo "attachments", hasta 10, imágenes o PDF de 10 MB)
curl -X POST http://localhost:8200/api/clients/665f0a1b2c3d4e5f60718293/archive \
  -H "Authorization: Bearer $TOKEN" \
  -F "reason=cancelacion_cliente" \
  -F "notes=Capturas del chat donde pide cancelar" \
  -F "attachments=@/ruta/chat-whatsapp.png" \
  -F "attachments=@/ruta/correo-cancelacion.pdf"

# Subir respaldos extra a la última entrada del historial
curl -X POST http://localhost:8200/api/clients/665f0a1b2c3d4e5f60718293/attachments \
  -H "Authorization: Bearer $TOKEN" \
  -F "attachments=@/ruta/acta-cierre.pdf"

# Reactivar (limpia la baja y deja el historial intacto)
curl -X POST http://localhost:8200/api/clients/665f0a1b2c3d4e5f60718293/reactivate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"notes":"Volvió con plan reducido"}'

# Borrado real — solo superadmin y solo si el cliente NUNCA tuvo pagos
curl -X DELETE http://localhost:8200/api/clients/665f0a1b2c3d4e5f60718293/purge \
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
curl "http://localhost:8200/api/invoices?period=2026-08&status=overdue&page=1&limit=50" \
  -H "Authorization: Bearer $TOKEN"

curl "http://localhost:8200/api/invoices?overdueOnly=true" -H "Authorization: Bearer $TOKEN"

# Resumen del período
curl "http://localhost:8200/api/invoices/summary?period=2026-08" -H "Authorization: Bearer $TOKEN"

# Generar facturas del período (idempotente; force reescribe solo las no pagadas)
curl -X POST http://localhost:8200/api/invoices/generate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"period":"2026-08"}'

curl -X POST http://localhost:8200/api/invoices/generate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"period":"2026-08","clientIds":["665f0a1b2c3d4e5f60718293"],"force":true}'

# Recalcular estados (marca overdue lo vencido e impago)
curl -X POST http://localhost:8200/api/invoices/recalc -H "Authorization: Bearer $TOKEN"

# Detalle
curl http://localhost:8200/api/invoices/6712ab34cd56ef7890123456 -H "Authorization: Bearer $TOKEN"

# Editar
curl -X PUT http://localhost:8200/api/invoices/6712ab34cd56ef7890123456 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"amount":390,"dueDate":"2026-08-28","notes":"Descuento acordado"}'

# Condonar
curl -X PATCH http://localhost:8200/api/invoices/6712ab34cd56ef7890123456/waive \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"Cortesía por incidencia de servicio"}'

# Anular
curl -X PATCH http://localhost:8200/api/invoices/6712ab34cd56ef7890123456/cancel \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"Factura duplicada"}'

# Solo facturas con al menos una prórroga registrada
curl "http://localhost:8200/api/invoices?deferredOnly=true" -H "Authorization: Bearer $TOKEN"

# Solo cobros anticipados
curl "http://localhost:8200/api/invoices?advanceOnly=true" -H "Authorization: Bearer $TOKEN"
```

### Prórrogas (acuerdos de pago)

Mueven el vencimiento de **esa factura únicamente**. El `collectionDay` del cliente no cambia,
así que el período siguiente vuelve solo a su fecha habitual. La mora, los días de gracia y la
auto-desactivación se miden siempre contra el `dueDate` vigente (el prorrogado).

```bash
# Registrar el acuerdo: mueve el vencimiento al 15 y reabre los avisos con la fecha nueva
curl -X PATCH http://localhost:8200/api/invoices/6712ab34cd56ef7890123456/defer \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"newDueDate":"2026-08-15","reason":"Acuerdo telefónico","notes":"Confirmado por WhatsApp"}'

# Deshacer la última prórroga (restaura el vencimiento anterior y recalcula el estado)
curl -X DELETE http://localhost:8200/api/invoices/6712ab34cd56ef7890123456/defer \
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
curl -X POST http://localhost:8200/api/invoices/advance \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"clientId":"665f0a1b2c3d4e5f60718293","period":"2026-09"}'

# Con monto, vencimiento, split y notas explícitos
curl -X POST http://localhost:8200/api/invoices/advance \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"clientId":"665f0a1b2c3d4e5f60718293","period":"2026-09","amount":420,"dueDate":"2026-09-01","splitIndex":0,"notes":"Pagado por adelantado en agosto"}'

# Registrar el pago sobre esa factura (el correo indica que es un cobro anticipado del período)
curl -X POST http://localhost:8200/api/payments \
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
curl "http://localhost:8200/api/payments?period=2026-08&method=transferencia&from=2026-08-01&to=2026-08-31" \
  -H "Authorization: Bearer $TOKEN"

# Registrar pago sin comprobante
curl -X POST http://localhost:8200/api/payments \
  -H "Authorization: Bearer $TOKEN" \
  -F "invoiceId=6712ab34cd56ef7890123456" \
  -F "amount=420" \
  -F "paidAt=2026-08-05" \
  -F "method=transferencia" \
  -F "reference=TRX-99881"

# Registrar pago con comprobante (imagen o PDF, máx 10 MB)
curl -X POST http://localhost:8200/api/payments \
  -H "Authorization: Bearer $TOKEN" \
  -F "invoiceId=6712ab34cd56ef7890123456" \
  -F "amount=210" \
  -F "method=cheque" \
  -F "notes=Primer split" \
  -F "receipt=@/ruta/comprobante.pdf"

# Detalle
curl http://localhost:8200/api/payments/6713cd56ef7890123456abcd -H "Authorization: Bearer $TOKEN"

# Eliminar (revierte paidAmount/estado de la factura y borra el comprobante) — solo superadmin
curl -X DELETE http://localhost:8200/api/payments/6713cd56ef7890123456abcd \
  -H "Authorization: Bearer $TOKEN"
```

Al registrar un pago: se recalcula el estado de la factura (`paid` o `partial`), se envía el correo de confirmación, se escribe un registro de auditoría y —si el cliente queda sin facturas vencidas y su workspace estaba desactivado— se reactiva el workspace en el backend de métricas.

---

## Dashboard / Settings / Workspaces / Cron

### Dashboard

Todas las rutas de `/dashboard` requieren token (cualquier rol). El parámetro `period` es opcional y usa el formato `YYYY-MM`; si se omite se toma el período actual.

```bash
# Resumen del período: facturado, cobrado, pendiente, vencido, % cobranza, conteos de clientes/facturas
curl "http://localhost:8200/api/dashboard/summary?period=2026-08" \
  -H "Authorization: Bearer $TOKEN"

# Serie de ingresos por período (por defecto 12 meses, máximo 36)
curl "http://localhost:8200/api/dashboard/revenue-series?months=12" \
  -H "Authorization: Bearer $TOKEN"

# Conteo y monto por estado de factura
curl "http://localhost:8200/api/dashboard/status-breakdown?period=2026-08" \
  -H "Authorization: Bearer $TOKEN"

# Monto cobrado agrupado por método de pago
curl "http://localhost:8200/api/dashboard/method-breakdown?period=2026-08" \
  -H "Authorization: Bearer $TOKEN"

# Top de clientes por monto facturado (limit por defecto 10)
curl "http://localhost:8200/api/dashboard/top-clients?period=2026-08&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# Antigüedad de la mora: 0-7 / 8-15 / 16-30 / 30+ con conteo y monto
curl "http://localhost:8200/api/dashboard/aging" \
  -H "Authorization: Bearer $TOKEN"

# Cobros próximos: facturas pending/partial con dueDate dentro de N días (default 15)
curl "http://localhost:8200/api/dashboard/upcoming?days=15" \
  -H "Authorization: Bearer $TOKEN"

# Listado de facturas vencidas con datos del cliente y días de mora (limit default 50)
curl "http://localhost:8200/api/dashboard/overdue?limit=50" \
  -H "Authorization: Bearer $TOKEN"

# Reporte de bajas: por qué se van los clientes y cuánto ingreso mensual se perdió
curl http://localhost:8200/api/dashboard/churn -H "Authorization: Bearer $TOKEN"
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
curl http://localhost:8200/api/settings/notifications \
  -H "Authorization: Bearer $TOKEN"

# Actualizar preferencias: destinatarios, toggles, días de gracia, etc.
curl -X PUT http://localhost:8200/api/settings/notifications \
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
curl -X POST http://localhost:8200/api/settings/notifications/test \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"dreyes@bakano.ec"}'

# Configuración de marca de la app
curl http://localhost:8200/api/settings/app \
  -H "Authorization: Bearer $TOKEN"

curl -X PUT http://localhost:8200/api/settings/app \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "appName": "Bakano Finanzas",
    "currency": "USD",
    "timezone": "America/Guayaquil",
    "brandColors": { "primary": "#e6285c", "secondary": "#85529c" }
  }'

# Subir el logo (multipart, campo "logo", máximo 5 MB, solo imágenes)
curl -X POST http://localhost:8200/api/settings/app/logo \
  -H "Authorization: Bearer $TOKEN" \
  -F "logo=@./logo-bakano.png"
```

`alwaysTo` siempre incluye `dreyes@bakano.ec`; los destinatarios finales de cada envío son `recipients + alwaysTo` deduplicados en minúsculas. Si un toggle está en `false`, ese tipo de correo no se envía (queda registrado en consola). Todos los envíos —exitosos o fallidos— quedan en la colección `EmailLog`.

### Workspaces (proxy al backend de métricas)

Requiere `METRICS_API_URL` y `FINANCE_API_KEY`. La escritura es `superadmin` o `admin`.

```bash
# Estado de la conexión con el backend de métricas
curl http://localhost:8200/api/workspaces/health \
  -H "Authorization: Bearer $TOKEN"

# Lista de workspaces cruzada con el cliente de finanzas asociado (Client.workspaceId)
curl http://localhost:8200/api/workspaces \
  -H "Authorization: Bearer $TOKEN"

# Detalle de un workspace + su cliente
curl http://localhost:8200/api/workspaces/6713aa11bb22cc33dd44ee55 \
  -H "Authorization: Bearer $TOKEN"

# Activar / desactivar manualmente (escribe AuditLog y actualiza Client.workspaceIsActive)
curl -X PATCH http://localhost:8200/api/workspaces/6713aa11bb22cc33dd44ee55/active \
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
curl -X POST http://localhost:8200/api/cron/run/daily \
  -H "x-cron-secret: $CRON_SECRET"

# Job mensual: genera las facturas del período actual y envía el resumen del período anterior
curl -X POST http://localhost:8200/api/cron/run/monthly \
  -H "x-cron-secret: $CRON_SECRET"

# Generar facturas de un período específico
curl -X POST http://localhost:8200/api/cron/run/generate/2026-08 \
  -H "x-cron-secret: $CRON_SECRET"

# Alternativa con token de superadmin
curl -X POST http://localhost:8200/api/cron/run/daily \
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
curl -X POST http://localhost:8200/api/clients/sync-workspace-images \
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
curl -X POST http://localhost:8200/api/clients/68b0.../grant-access \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Firmó acuerdo de pago para el viernes","until":"2026-08-15"}'

# Excepción indefinida
curl -X POST http://localhost:8200/api/clients/68b0.../grant-access \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Cliente estratégico, lo autoriza gerencia"}'

# Revocar la excepción y cerrar el espacio si sigue en mora (comportamiento por defecto)
curl -X DELETE http://localhost:8200/api/clients/68b0.../grant-access \
  -H "Authorization: Bearer $TOKEN"

# Revocar SIN cerrar el espacio
curl -X DELETE http://localhost:8200/api/clients/68b0.../grant-access \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"closeWorkspace":false}'

# Listado de todos los abiertos por excepción, con deuda, mora y días restantes
curl http://localhost:8200/api/clients/access-overrides \
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
