import { Types } from "mongoose";
import { AuditLog, Client, IClient, Invoice, Payment, Sale, User } from "../models";
import { CustomError } from "../errors/customError.error";
import { JwtPayload, UserRole } from "../types/AuthRequest";
import { PAYMENT_METHODS, PaymentMethod } from "../types/finance.types";
import { isValidPeriod, startOfDay, toPeriod } from "../utils/date.util";
import { accessStatusFor, accessStatusMap, globalGraceDays, isOverrideActive } from "./access.status.service";
import { accessService } from "./access.service";
import { clientWorkspaceService } from "./client.workspace.service";
import { clientService } from "./client.service";
import { invoiceDeferralService } from "./invoice.deferral.service";
import { invoiceQueryService } from "./invoice.query.service";
import { resolveGraceDays } from "./scheduler.access";
import { lifetimeRevenueOf } from "./client.lifecycle.service";
import { dashboardService } from "./dashboard.service";
import { invoiceGenerationService } from "./invoice.generation.service";
import { paymentService } from "./payment.service";
import { elegirCobros, saldoDe, validarSelector } from "./payment.allocation";
import { receiptUploadService } from "./receiptUpload.service";

/**
 * Bakano Finanzas desde el MCP del equipo (mcp.bakano.ec).
 *
 * Metrics autentica a la persona y la manda en `x-actor-email`; aquí se decide
 * con SU usuario de Finanzas: si no tiene cuenta activa, no ve nada; `viewer`
 * solo lee; registrar pagos es de superadmin, admin y vendedor, igual que en la
 * plataforma. Así el MCP nunca da más acceso del que la persona ya tiene.
 */

const OPEN = ["pending", "partial", "overdue"];
const ESCRIBEN: UserRole[] = ["superadmin", "admin", "vendedor"];

export interface ActorMcp {
  payload: JwtPayload;
  role: UserRole;
}

async function actor(email: string | undefined, superadminMetrics = false): Promise<ActorMcp> {
  const correo = String(email || "").trim().toLowerCase();
  if (!correo) throw new CustomError("Falta la persona que hace la consulta.", 401);
  const user = await User.findOne({ email: correo, isActive: true }).select("_id name email role").lean();
  if (!user && superadminMetrics) {
    // Pedido de Diego (2026-11-13): cualquier superadmin de Metrics registra pagos. Metrics ya validó
    // el rol y la llamada viene con METRICS_PROXY_KEY; el pago queda a su nombre (sin id de Finanzas).
    return {
      role: "superadmin" as UserRole,
      payload: { _id: undefined as unknown as string, email: correo, name: `${correo} (superadmin Metrics)`, role: "superadmin" as UserRole },
    };
  }
  if (!user) {
    throw new CustomError(
      `${correo} no tiene usuario activo en Bakano Finanzas (finances.bakano.ec). Pídele a Diego que te cree uno.`,
      403
    );
  }
  return {
    role: user.role as UserRole,
    payload: { _id: String(user._id), email: user.email, name: user.name, role: user.role as UserRole },
  };
}

function dinero(n: number | null | undefined): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function fila(c: IClient | Record<string, any>) {
  return {
    id: String(c._id),
    nombre: c.name,
    activo: c.isActive && !c.isArchived,
    deBaja: Boolean(c.isArchived),
    tipoCobro: c.billingType,
    mensualidad: dinero(c.amount),
    metodo: c.paymentMethod,
    diaCobro: c.collectionDay ?? c.collectionDayLabel ?? "sin día fijo",
    desde: c.startDate,
    rubro: c.categoryName ?? null,
    responsableCobro: c.ownerName ?? null,
    entornoMetrics: c.workspaceName ?? null,
  };
}

async function buscarCliente(texto: string): Promise<IClient> {
  const t = String(texto || "").trim();
  if (!t) throw new CustomError("Dime qué cliente.", 400);
  if (Types.ObjectId.isValid(t)) {
    const porId = await Client.findById(t);
    if (porId) return porId;
    const porEntorno = await Client.findOne({ workspaceId: t, isArchived: { $ne: true } });
    if (porEntorno) return porEntorno;
  }
  const regex = { $regex: t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  const encontrados = await Client.find({
    $or: [{ name: regex }, { legalName: regex }, { workspaceName: regex }, { contactName: regex }],
  })
    .sort({ isArchived: 1, name: 1 })
    .limit(10);
  if (!encontrados.length) throw new CustomError(`No encontré ningún cliente en Finanzas que se parezca a "${t}".`, 404);
  const exacto = encontrados.filter((c) => c.name.toLowerCase() === t.toLowerCase());
  if (exacto.length === 1) return exacto[0];
  const vivos = encontrados.filter((c) => !c.isArchived);
  if (vivos.length === 1) return vivos[0];
  if (encontrados.length === 1) return encontrados[0];
  throw new CustomError(
    `"${t}" coincide con varios clientes: ${encontrados.map((c) => `${c.name} (${c._id})`).join(", ")}. Usa el id.`,
    409
  );
}

async function clientes(email: string | undefined, q?: string, soloDeben?: boolean) {
  await actor(email);
  const filtro: Record<string, unknown> = { isArchived: { $ne: true } };
  if (q) {
    const regex = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filtro.$or = [{ name: regex }, { legalName: regex }, { workspaceName: regex }];
  }
  const docs = await Client.find(filtro).sort({ name: 1 }).limit(200).lean();
  const estados = await accessStatusMap(docs.map((c) => c._id));
  const filas = docs.map((c) => {
    const estado = estados.get(String(c._id));
    return {
      ...fila(c),
      vencido: dinero(estado?.overdueAmount),
      cobrosVencidos: estado?.overdueInvoices ?? 0,
      diasMora: estado?.maxDaysOverdue ?? 0,
    };
  });
  const lista = soloDeben ? filas.filter((f) => f.vencido > 0) : filas;
  return { total: lista.length, clientes: lista };
}

async function cliente(email: string | undefined, texto: string) {
  await actor(email);
  const c = await buscarCliente(texto);
  const [estado, cobrado, cobros, pagos, ventas] = await Promise.all([
    accessStatusFor(c._id),
    lifetimeRevenueOf(c._id),
    Invoice.find({ clientId: c._id }).sort({ dueDate: -1 }).limit(12).lean(),
    Payment.find({ clientId: c._id }).sort({ paidAt: -1 }).limit(10).lean(),
    Sale.find({ clientId: c._id }).sort({ createdAt: -1 }).limit(5).lean(),
  ]);
  return {
    ...fila(c),
    totalCobradoHistorico: cobrado,
    vencido: dinero(estado.overdueAmount),
    diasMora: estado.maxDaysOverdue,
    cobros: cobros.map((i) => ({
      id: String(i._id),
      periodo: i.period,
      cuota: i.splitLabel ?? null,
      monto: dinero(i.amount),
      pagado: dinero(i.paidAmount),
      estado: i.status,
      vence: i.dueDate,
    })),
    pagos: pagos.map((p) => ({
      monto: dinero(p.amount),
      fecha: p.paidAt,
      metodo: p.method,
      referencia: p.reference ?? null,
      periodo: p.period,
      registradoPor: p.registeredByName ?? null,
    })),
    ventas: ventas.map((s: any) => ({
      id: String(s._id),
      negocio: s.businessName,
      total: dinero(s.amount),
      estado: s.status,
      cuotas: (s.installments || []).map((i: any) => ({ n: i.index + 1, monto: dinero(i.amount), vence: i.dueDate, estado: i.status })),
    })),
  };
}

async function resumen(email: string | undefined, periodo?: string) {
  await actor(email);
  if (periodo && !isValidPeriod(periodo)) throw new CustomError("El período va como AAAA-MM.", 400);
  const [r, vencidos] = await Promise.all([dashboardService.summary(periodo), dashboardService.overdueList(30)]);
  return { resumen: r, vencidos };
}

/**
 * Registra un pago. Se reparte entre los cobros abiertos (el más viejo
 * primero), igual que "Registrar pago" en la plataforma. Si el cliente no
 * tiene ningún cobro abierto:
 *  - mensual: se genera el cobro del mes del pago (lo que haría el job del día 1);
 *  - pago único / a convenir: se crea el cobro de ese mes por el monto pagado.
 * Así el pago siempre queda en el historial del cliente ("Total cobrado").
 * Con `mes` (AAAA-MM) o `cobro_id` va SOLO a ese cobro; si está anulado,
 * superadmin lo reactiva con `motivo` (caso Eventos la Colonia, oct 2026).
 */
async function registrarPago(
  email: string | undefined,
  input: {
    cliente: string;
    monto: number;
    fecha?: string;
    metodo?: PaymentMethod;
    referencia?: string;
    notas?: string;
    mes?: string;
    cobro_id?: string;
    motivo?: string;
    confirmar?: boolean;
  },
  baseUrl?: string,
  superadminMetrics = false
) {
  const quien = await actor(email, superadminMetrics);
  if (!ESCRIBEN.includes(quien.role)) {
    throw new CustomError(`Tu usuario de Finanzas es "${quien.role}": solo puede consultar, no registrar pagos.`, 403);
  }
  const c = await buscarCliente(input.cliente);
  if (c.isArchived) throw new CustomError(`${c.name} está dado de baja en Finanzas.`, 409);

  const monto = dinero(input.monto);
  if (!(monto > 0)) throw new CustomError("El monto tiene que ser mayor a cero.", 400);
  const fecha = input.fecha ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(input.fecha) ? `${input.fecha}T12:00:00-05:00` : input.fecha) : new Date();
  if (Number.isNaN(fecha.getTime())) throw new CustomError("La fecha va como AAAA-MM-DD.", 400);
  if (fecha.getTime() > Date.now() + 86_400_000) throw new CustomError("La fecha del pago no puede ser futura.", 400);
  if (input.metodo && !PAYMENT_METHODS.includes(input.metodo)) {
    throw new CustomError(`Método inválido. Opciones: ${PAYMENT_METHODS.join(", ")}.`, 400);
  }

  const referencia = input.referencia?.trim();
  if (referencia) {
    const repetido = await Payment.findOne({ reference: referencia }).lean();
    if (repetido) {
      throw new CustomError(
        `Ya hay un pago con la referencia ${referencia} (${repetido.clientName}, $${repetido.amount}, ${repetido.paidAt.toISOString().slice(0, 10)}). No lo registro dos veces.`,
        409
      );
    }
  }

  const mes = input.mes?.trim() || undefined;
  const cobroId = input.cobro_id?.trim() || undefined;
  validarSelector(mes, cobroId);
  if (cobroId && !Types.ObjectId.isValid(cobroId)) throw new CustomError(`El cobro_id ${cobroId} no es un id válido.`, 400);
  const motivo = input.motivo?.trim();
  const eleccion =
    mes || cobroId
      ? elegirCobros(
          await Invoice.find({ clientId: c._id, ...(cobroId ? { _id: cobroId } : { period: mes }) }).sort({ dueDate: 1, splitIndex: 1 }).lean(),
          { cliente: c.name, mes, cobroId, motivo, esSuperadmin: quien.role === "superadmin" }
        )
      : null;

  let abiertos = eleccion
    ? eleccion.objetivos
    : await Invoice.find({ clientId: c._id, status: { $in: OPEN } }).sort({ dueDate: 1, splitIndex: 1 }).lean();
  const periodo = toPeriod(fecha);
  let plan: string;
  if (eleccion) {
    plan =
      `Se aplica SOLO a ${abiertos.map((i) => `${i.period}${i.splitLabel ? ` ${i.splitLabel}` : ""} ($${dinero(saldoDe(i))} pendiente)`).join(", ")}, no al cobro abierto más viejo.` +
      (eleccion.reactivar.length ? ` El cobro está ANULADO: se reactiva con motivo "${motivo}" y queda en el historial.` : "");
  } else if (abiertos.length) {
    plan = `Se reparte entre ${abiertos.length} cobro(s) abierto(s): ${abiertos.map((i) => `${i.period} ($${dinero(i.amount - (i.paidAmount || 0))} pendiente)`).join(", ")}.`;
  } else if (c.billingType === "monthly") {
    plan = `No tiene cobros abiertos: se genera el cobro de ${periodo} (mensual de $${dinero(c.amount)}) y se registra ahí.`;
  } else {
    const total = Math.max(dinero(c.amount), monto);
    plan =
      total > monto
        ? `No tiene cobros abiertos: se crea el cobro de ${periodo} por $${total} (lo acordado) y se registra un ABONO de $${monto}. Quedan $${dinero(total - monto)} pendientes.`
        : `No tiene cobros abiertos y es ${c.billingType === "special" ? "pago único / a convenir" : c.billingType}: se crea el cobro de ${periodo} por $${monto} y se registra ahí.`;
  }

  const pendienteHoy = abiertos.reduce((a, i) => a + saldoDe(i), 0);
  if (abiertos.length && monto > pendienteHoy + 0.009) {
    const deQue = eleccion ? `el cobro de ${abiertos[0].period}` : c.name;
    throw new CustomError(`El monto ($${monto}) supera lo pendiente de ${deQue} ($${dinero(pendienteHoy)}). Revisa el monto o los cobros.`, 400);
  }

  const resumenPago = {
    cliente: c.name,
    monto,
    fecha: fecha.toISOString().slice(0, 10),
    metodo: input.metodo || c.paymentMethod,
    referencia: referencia ?? null,
    ...(eleccion ? { cobro: mes ?? cobroId } : {}),
    plan,
  };
  if (!input.confirmar) {
    return { paraConfirmar: resumenPago, siguiente: "Muéstraselo a la persona. Si confirma, vuelve a llamar con confirmar=true." };
  }

  if (!abiertos.length) {
    if (c.billingType === "monthly") {
      await invoiceGenerationService.generateForPeriod(periodo, { clientIds: [String(c._id)] });
    } else {
      const ocupado = await Invoice.findOne({ clientId: c._id, period: periodo, splitIndex: 0 }).lean();
      if (ocupado) {
        throw new CustomError(
          `${c.name} ya tiene un cobro de ${periodo} (${ocupado.status}). Regístralo desde finances.bakano.ec para elegir el cobro correcto.`,
          409
        );
      }
      await Invoice.create({
        clientId: c._id,
        clientName: c.name,
        period: periodo,
        splitIndex: 0,
        // Lo acordado, no lo pagado: un abono deja el cobro "partial" con el saldo a la vista.
        amount: Math.max(dinero(c.amount), monto),
        currency: c.currency || "USD",
        issueDate: fecha,
        dueDate: startOfDay(fecha),
        status: "pending",
        autoGenerated: false,
        workspaceId: c.workspaceId || null,
        notes: `Cobro creado desde el MCP por ${quien.payload.name} para registrar el pago`,
      });
    }
    abiertos = await Invoice.find({ clientId: c._id, status: { $in: OPEN } }).lean();
    if (!abiertos.length) {
      throw new CustomError(`No pude crear el cobro de ${periodo} para ${c.name}. Regístralo desde finances.bakano.ec.`, 409);
    }
  }

  // Reactivar el anulado ANTES de pagar: settle solo ve cobros abiertos.
  for (const inv of eleccion?.reactivar ?? []) {
    const status = (inv.paidAmount || 0) > 0 ? "partial" : inv.dueDate < startOfDay(new Date()) ? "overdue" : "pending";
    const nota = `Reactivada por ${quien.payload.name} para registrar un pago: ${motivo}`;
    await Invoice.updateOne({ _id: inv._id, status: "cancelled" }, { status, notes: [inv.notes, nota].filter(Boolean).join(" | ") });
    await AuditLog.create({
      action: "invoice.reactivate",
      entity: "Invoice",
      entityId: String(inv._id),
      userId: quien.payload._id,
      userName: quien.payload.name,
      level: "warn",
      meta: { clientId: String(c._id), period: inv.period, motivo, status, desde: "mcp" },
    });
  }

  const r = await paymentService.settle(
    {
      clientId: String(c._id),
      amount: monto,
      paidAt: fecha,
      method: input.metodo,
      reference: referencia,
      notes: [input.notas?.trim(), "Registrado desde el MCP"].filter(Boolean).join(" · "),
      ...(eleccion ? { invoiceIds: abiertos.map((i) => String(i._id)) } : {}),
    },
    quien.payload
  );
  const pagoIds = r.applied.map((a) => a.paymentId).filter(Boolean);
  return {
    listo: true,
    ...resumenPago,
    aplicado: r.applied,
    totalCobradoHistorico: await lifetimeRevenueOf(c._id),
    ...(baseUrl && pagoIds.length
      ? {
          comprobante: {
            subir: receiptUploadService.linkPara(baseUrl, pagoIds, quien.payload.name),
            nota: `Enlace para subir la imagen o PDF del comprobante (vence en ${receiptUploadService.VIGENCIA_TEXTO}). Compártelo con la persona: lo abre, arrastra el archivo y queda pegado al pago.`,
          },
        }
      : {}),
  };
}

/**
 * ¿Esta persona tiene usuario activo en Finanzas? Lo usa el MCP de metrics
 * para decidir si le muestra las herramientas de Finanzas que no son solo de
 * superadmin (p. ej. subir comprobantes). Nunca lanza 403: es una consulta.
 */
async function actorExiste(email: string | undefined) {
  const correo = String(email || "").trim().toLowerCase();
  if (!correo) return { existe: false };
  const user = await User.findOne({ email: correo, isActive: true }).select("role").lean();
  return user ? { existe: true, role: user.role } : { existe: false };
}

/**
 * Enlace para subir el comprobante de un pago YA registrado. Con `pago_id` o
 * `referencia` va directo; con solo `cliente` toma su último pago. Un pago
 * repartido entre varios cobros (misma referencia) recibe el mismo comprobante.
 */
async function comprobante(
  email: string | undefined,
  input: { cliente?: string; pago_id?: string; referencia?: string },
  baseUrl: string,
  superadminMetrics = false
) {
  const quien = await escritor(email, superadminMetrics);

  let pagos;
  const referencia = input.referencia?.trim();
  if (input.pago_id) {
    if (!Types.ObjectId.isValid(input.pago_id)) throw new CustomError("pago_id no es un id válido.", 400);
    const pago = await Payment.findById(input.pago_id).lean();
    if (!pago) throw new CustomError("No encontré ese pago en Finanzas.", 404);
    pagos = pago.reference
      ? await Payment.find({ clientId: pago.clientId, reference: pago.reference }).lean()
      : [pago];
  } else if (referencia) {
    pagos = await Payment.find({ reference: referencia }).lean();
    if (!pagos.length) throw new CustomError(`No encontré pagos con la referencia ${referencia}.`, 404);
  } else if (input.cliente) {
    const c = await buscarCliente(input.cliente);
    const ultimo = await Payment.findOne({ clientId: c._id }).sort({ paidAt: -1, createdAt: -1 }).lean();
    if (!ultimo) throw new CustomError(`${c.name} no tiene pagos registrados en Finanzas todavía.`, 404);
    pagos = ultimo.reference
      ? await Payment.find({ clientId: c._id, reference: ultimo.reference, paidAt: ultimo.paidAt }).lean()
      : [ultimo];
  } else {
    throw new CustomError("Dime el cliente, el pago_id o la referencia del pago.", 400);
  }

  const ids = pagos.map((p) => String(p._id));
  return {
    pagos: pagos.map((p) => ({
      id: String(p._id),
      cliente: p.clientName,
      monto: dinero(p.amount),
      periodo: p.period,
      fecha: p.paidAt,
      referencia: p.reference ?? null,
      yaTieneComprobante: Boolean(p.receiptUrl),
    })),
    subir: receiptUploadService.linkPara(baseUrl, ids, quien.payload.name),
    nota: `El enlace vence en ${receiptUploadService.VIGENCIA_TEXTO}. La persona lo abre, arrastra la imagen o el PDF y queda pegado al pago. Si el pago ya tenía comprobante, el nuevo lo reemplaza.`,
  };
}

/** Escribir en Finanzas: mismo permiso que en la plataforma. */
async function escritor(email: string | undefined, superadminMetrics = false): Promise<ActorMcp> {
  const quien = await actor(email, superadminMetrics);
  if (!ESCRIBEN.includes(quien.role)) {
    throw new CustomError(`Tu usuario de Finanzas es "${quien.role}": solo puede consultar.`, 403);
  }
  return quien;
}

function leerFecha(texto: string, etiqueta: string): Date {
  const t = String(texto || "").trim();
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T12:00:00-05:00` : t);
  if (Number.isNaN(d.getTime())) throw new CustomError(`${etiqueta}: usa AAAA-MM-DD.`, 400);
  return d;
}

const DIA = 86_400_000;

/**
 * Cuándo se le corta el acceso a cada cliente que debe. El cron corta cuando
 * la mora SUPERA la gracia: fecha de corte = vencimiento + gracia + 1 día.
 * Con excepción vigente, el corte es cuando vence la excepción.
 */
async function bloqueos(email: string | undefined) {
  await actor(email);
  const gracia = resolveGraceDays(await globalGraceDays());
  const abiertos = await Invoice.find({ status: "overdue" }).sort({ dueDate: 1 }).lean();
  const porCliente = new Map<string, typeof abiertos>();
  for (const i of abiertos) {
    const k = String(i.clientId);
    porCliente.set(k, [...(porCliente.get(k) || []), i]);
  }
  const clientes = await Client.find({ _id: { $in: [...porCliente.keys()] }, isArchived: { $ne: true } }).lean();
  const ahora = new Date();
  const filas = clientes.map((c) => {
    const cobros = porCliente.get(String(c._id)) || [];
    const masViejo = cobros[0];
    const g = resolveGraceDays(c.graceDays ?? gracia);
    const corte = new Date(startOfDay(masViejo.dueDate).getTime() + (g + 1) * DIA);
    const excepcion = isOverrideActive(c as any, ahora);
    const bloqueado = c.workspaceIsActive === false || Boolean(cobros.find((i) => i.deactivation?.deactivatedAt && !i.deactivation?.reactivatedAt));
    let estado: string;
    let fechaBloqueo: Date | null = null;
    if (!c.workspaceId) estado = "sin entorno vinculado: no se puede bloquear";
    else if (excepcion) {
      fechaBloqueo = c.accessOverride?.until ? new Date(c.accessOverride.until) : null;
      estado = fechaBloqueo ? "acceso abierto por excepción hasta esa fecha" : "acceso abierto por excepción SIN fecha (no se bloquea solo)";
    } else if (bloqueado) estado = "bloqueado";
    else if (!c.autoDeactivate) estado = "bloqueo automático apagado: no se corta solo";
    else {
      fechaBloqueo = corte;
      estado = corte <= ahora ? "se bloquea en la próxima corrida del cron" : "se bloquea en esa fecha si no paga";
    }
    return {
      id: String(c._id),
      cliente: c.name,
      entorno: c.workspaceName ?? null,
      debe: dinero(cobros.reduce((a, i) => a + Math.max(i.amount - (i.paidAmount || 0), 0), 0)),
      cobrosVencidos: cobros.map((i) => ({ id: String(i._id), periodo: i.period, saldo: dinero(i.amount - (i.paidAmount || 0)), vencio: i.dueDate, prorrogas: i.deferrals?.length || 0 })),
      diasGracia: g,
      estado,
      fechaBloqueo,
      excepcion: excepcion ? { motivo: c.accessOverride?.reason, hasta: c.accessOverride?.until ?? null, por: c.accessOverride?.grantedByName } : null,
    };
  });
  filas.sort((a, b) => (a.fechaBloqueo?.getTime() ?? Infinity) - (b.fechaBloqueo?.getTime() ?? Infinity));
  return { diasGraciaGeneral: gracia, total: filas.length, clientes: filas };
}

/** Vincula (o desvincula con workspaceId null) el entorno de Metrics. Sin workspaceId sugiere. */
async function vincular(email: string | undefined, input: { cliente: string; workspaceId?: string | null; desvincular?: boolean; confirmar?: boolean }) {
  await escritor(email);
  const c = await buscarCliente(input.cliente);
  if (input.desvincular) {
    if (!input.confirmar) return { paraConfirmar: `Desvincular ${c.name} del entorno ${c.workspaceName ?? c.workspaceId ?? "(ninguno)"}.` };
    await clientWorkspaceService.unlinkWorkspace(String(c._id));
    return { listo: true, cliente: c.name, entorno: null };
  }
  if (!input.workspaceId) {
    return {
      cliente: c.name,
      vinculadoA: c.workspaceId ? { id: c.workspaceId, nombre: c.workspaceName } : null,
      sugerencias: await clientWorkspaceService.suggestWorkspaceMatches(String(c._id)),
      siguiente: "Elige el entorno con la persona y vuelve a llamar con workspace_id.",
    };
  }
  const ocupado = await Client.findOne({ workspaceId: input.workspaceId, _id: { $ne: c._id } }).lean();
  if (ocupado) throw new CustomError(`Ese entorno ya está vinculado a "${ocupado.name}".`, 409);
  if (!input.confirmar) {
    return { paraConfirmar: `Vincular ${c.name} con el entorno ${input.workspaceId}${c.workspaceId ? ` (hoy está con ${c.workspaceName ?? c.workspaceId})` : ""}. Sus cobros abiertos quedan con ese entorno y el bloqueo por mora pasa a aplicarse ahí.` };
  }
  const r = await clientWorkspaceService.linkWorkspace(String(c._id), input.workspaceId);
  return { listo: true, cliente: r.name, entorno: { id: r.workspaceId, nombre: r.workspaceName, activo: r.workspaceIsActive } };
}

/** Abre el acceso por excepción (con motivo y hasta cuándo) o lo vuelve a cerrar. */
async function acceso(
  email: string | undefined,
  input: { cliente: string; accion: "abrir" | "cerrar"; motivo?: string; hasta?: string | null; confirmar?: boolean }
) {
  const quien = await escritor(email);
  const c = await buscarCliente(input.cliente);
  const estado = await accessStatusFor(c._id);
  if (input.accion === "abrir") {
    const motivo = String(input.motivo || "").trim();
    if (motivo.length < 3) throw new CustomError("Dime por qué se le abre el acceso (queda registrado y le llega al equipo).", 400);
    const hasta = input.hasta ? leerFecha(input.hasta, "Hasta cuándo") : null;
    if (!input.confirmar) {
      return {
        paraConfirmar: `Abrir el acceso de ${c.name} ${hasta ? `hasta el ${hasta.toISOString().slice(0, 10)}` : "SIN fecha de fin (hay que cerrarlo a mano)"}. Motivo: ${motivo}. Debe $${dinero(estado.overdueAmount)} con ${estado.maxDaysOverdue} días de mora.`,
        ...(hasta ? {} : { ojo: "Sin fecha nunca se vuelve a bloquear solo. Mejor dar una fecha." }),
      };
    }
    const r = await accessService.grantAccess(String(c._id), { reason: motivo, until: hasta }, quien.payload);
    return { listo: true, cliente: c.name, abiertoHasta: r.until, motivo, debe: dinero(r.overdueAmount), mensaje: r.message };
  }
  if (!input.confirmar) {
    return { paraConfirmar: `Quitar la excepción de ${c.name}${estado.overdueInvoices ? " y volver a bloquear su entorno (sigue debiendo)" : ""}.` };
  }
  const r = await accessService.revokeAccess(String(c._id), {}, quien.payload);
  return { listo: true, cliente: c.name, entornoCerrado: r.closedWorkspace, mensaje: r.message };
}

/**
 * Plazo de pago: mueve el vencimiento de un cobro (el más viejo abierto si no
 * se dice cuál). Eso corre la fecha de bloqueo a nueva fecha + gracia. Si ya
 * estaba bloqueado y la fecha nueva es futura, se le abre el acceso hasta ahí.
 */
async function plazo(
  email: string | undefined,
  input: { cliente: string; nueva_fecha: string; motivo: string; cobro_id?: string; reabrir?: boolean; confirmar?: boolean }
) {
  const quien = await escritor(email);
  const c = await buscarCliente(input.cliente);
  const motivo = String(input.motivo || "").trim();
  if (motivo.length < 3) throw new CustomError("Dime por qué se le da el plazo (queda registrado).", 400);
  const nueva = leerFecha(input.nueva_fecha, "Nueva fecha");
  const cobro = input.cobro_id
    ? await Invoice.findOne({ _id: input.cobro_id, clientId: c._id })
    : await Invoice.findOne({ clientId: c._id, status: { $in: OPEN } }).sort({ dueDate: 1 });
  if (!cobro) throw new CustomError(`${c.name} no tiene cobros abiertos para darle plazo.`, 404);
  const gracia = resolveGraceDays(c.graceDays ?? (await globalGraceDays()));
  const corte = new Date(startOfDay(nueva).getTime() + (gracia + 1) * DIA);
  const bloqueado = c.workspaceIsActive === false;
  const reabrir = input.reabrir !== false && bloqueado && Boolean(c.workspaceId);
  if (!input.confirmar) {
    return {
      paraConfirmar: `Plazo a ${c.name}: el cobro de ${cobro.period} ($${dinero(cobro.amount - (cobro.paidAmount || 0))} pendiente) pasa de vencer el ${cobro.dueDate.toISOString().slice(0, 10)} al ${nueva.toISOString().slice(0, 10)}. Motivo: ${motivo}. Si no paga, se bloquea el ${corte.toISOString().slice(0, 10)}.` +
        (reabrir ? " Hoy está bloqueado: se le abre el acceso hasta esa fecha de bloqueo." : ""),
      ojo: "Finanzas le manda al cliente el correo del acuerdo de pago con la fecha nueva.",
    };
  }
  await invoiceDeferralService.deferInvoice(String(cobro._id), { newDueDate: nueva, reason: motivo }, quien.payload);
  let abierto: Date | null = null;
  if (reabrir) {
    const r = await accessService.grantAccess(String(c._id), { reason: `Plazo de pago: ${motivo}`, until: corte }, quien.payload);
    abierto = r.until;
  }
  return { listo: true, cliente: c.name, cobro: cobro.period, venceAhora: nueva, seBloqueaEl: corte, accesoAbiertoHasta: abierto, motivo };
}

/**
 * Alta de un cliente, igual que "Nuevo cliente" de la plataforma: solo el
 * cliente, cuánto paga y qué día (no registra venta ni genera cobro). Si se da
 * el entorno de Metrics se vincula ese; sin él Finanzas CREA un entorno nuevo,
 * así que el plan lo avisa.
 */
async function crearCliente(
  email: string | undefined,
  input: {
    nombre: string;
    monto: number;
    tipo_cobro: "monthly" | "special" | "no_charge";
    metodo?: PaymentMethod;
    dia_cobro?: number | null;
    desde?: string;
    contacto_nombre?: string;
    contacto_correo?: string;
    contacto_telefono?: string;
    razon_social?: string;
    notas?: string;
    workspaceId?: string;
    workspaceName?: string;
    confirmar?: boolean;
  },
  superadminMetrics = false
) {
  const quien = await escritor(email, superadminMetrics);
  const nombre = String(input.nombre || "").trim();
  if (nombre.length < 2) throw new CustomError("Falta el nombre del cliente.", 400);
  const parecidos = await Client.find({ name: { $regex: nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }).select("name isArchived").limit(5).lean();
  if (parecidos.some((c) => c.name.toLowerCase() === nombre.toLowerCase())) {
    throw new CustomError(`Ya existe "${nombre}" en Finanzas. Usa finanzas_cliente para verlo.`, 409);
  }
  if (!["monthly", "special", "no_charge"].includes(input.tipo_cobro)) throw new CustomError("tipo_cobro: monthly, special o no_charge.", 400);
  const monto = dinero(input.monto);
  if (input.tipo_cobro !== "no_charge" && !(monto > 0)) throw new CustomError("El monto tiene que ser mayor a cero.", 400);
  if (input.metodo && !PAYMENT_METHODS.includes(input.metodo)) throw new CustomError(`Método inválido. Opciones: ${PAYMENT_METHODS.join(", ")}.`, 400);
  const dia = input.dia_cobro == null ? null : Number(input.dia_cobro);
  if (dia != null && !(Number.isInteger(dia) && dia >= 1 && dia <= 31)) throw new CustomError("El día de cobro va de 1 a 31.", 400);
  const desde = input.desde ? leerFecha(input.desde, "Desde") : new Date();
  if (input.workspaceId) {
    const ocupado = await Client.findOne({ workspaceId: input.workspaceId }).lean();
    if (ocupado) throw new CustomError(`Ese entorno ya está vinculado al cliente "${ocupado.name}" en Finanzas.`, 409);
  }
  const tipoTexto = input.tipo_cobro === "monthly" ? "cada mes" : input.tipo_cobro === "special" ? "pago único / a convenir" : "no paga";
  const plan = {
    cliente: nombre,
    cobro: `$${monto} · ${tipoTexto}${dia ? ` · día ${dia}` : " · sin día fijo"} · ${input.metodo || "transferencia"}`,
    desde: desde.toISOString().slice(0, 10),
    entorno: input.workspaceId ? `${input.workspaceName ?? input.workspaceId} (se vincula el existente)` : "NO se dio: Finanzas crea un entorno NUEVO en Metrics con ese nombre",
    contacto: [input.contacto_nombre, input.contacto_correo, input.contacto_telefono].filter(Boolean).join(" · ") || null,
    parecidosEnFinanzas: parecidos.map((c) => c.name),
    nota: "No registra venta ni genera el cobro: el pago se registra después con finanzas_registrar_pago (crea el cobro del mes si no hay).",
  };
  if (!input.confirmar) return { paraConfirmar: plan, siguiente: "Muéstraselo a la persona. Si confirma, vuelve a llamar con confirmar=true." };

  const c = await clientService.create(
    {
      name: nombre,
      legalName: input.razon_social?.trim() || undefined,
      contactName: input.contacto_nombre?.trim() || undefined,
      contactEmail: input.contacto_correo?.trim() || undefined,
      contactPhone: input.contacto_telefono?.trim() || undefined,
      amount: monto,
      billingType: input.tipo_cobro,
      paymentMethod: input.metodo || "transferencia",
      collectionDay: dia,
      startDate: desde,
      notes: [input.notas?.trim(), `Creado desde el MCP por ${quien.payload.name}`].filter(Boolean).join(" · "),
      ...(input.workspaceId ? { workspaceId: input.workspaceId, workspaceName: input.workspaceName, workspaceLinkedAt: new Date() } : {}),
    } as Partial<IClient>,
    quien.payload._id
  );
  return { listo: true, ...fila(c), id: String(c._id) };
}

/**
 * Ex clientes que se fueron con saldo: sus cobros abiertos se condonan (waived)
 * con motivo para que dejen de inflar "por cobrar" (pedido de Luis, tarea de
 * Metrics 6ae385d1aa35bac083a8948b). No se borra nada: pagos y facturas quedan
 * como historia. Sin cliente ni todos_archivados: lista los archivados con saldo.
 * Solo superadmin.
 */
async function darDeBaja(
  email: string | undefined,
  input: { cliente?: string; todos_archivados?: boolean; motivo?: string; confirmar?: boolean }
) {
  const quien = await actor(email);
  if (quien.role !== "superadmin") throw new CustomError("Dar de baja saldos es solo de superadmin.", 403);
  const motivo = String(input.motivo || "").trim() || "Cliente se fue; saldo dado por perdido por Dirección";

  const clientes: IClient[] = input.cliente
    ? [await buscarCliente(input.cliente)]
    : ((await Client.find({ $or: [{ isArchived: true }, { isActive: false }] }).lean()) as unknown as IClient[]);
  const ids = clientes.map((c) => c._id);
  const [abiertos, pagosChicos] = await Promise.all([
    Invoice.find({ clientId: { $in: ids }, status: { $in: OPEN } }).sort({ clientName: 1, period: 1 }).lean(),
    Payment.find({ clientId: { $in: ids }, amount: { $lte: 30 } }).select("clientId period amount paidAt").lean(),
  ]);
  const detalle = clientes
    .map((c) => {
      const mios = abiertos.filter((i) => String(i.clientId) === String(c._id));
      if (!mios.length) return null;
      return {
        cliente: c.name,
        id: String(c._id),
        archivado: Boolean(c.isArchived || !c.isActive),
        saldo: dinero(mios.reduce((s, i) => s + (i.amount - (i.paidAmount || 0)), 0)),
        cobrosAbiertos: mios.map((i) => ({ id: String(i._id), periodo: i.period, estado: i.status, monto: dinero(i.amount), pagado: dinero(i.paidAmount), saldo: dinero(i.amount - (i.paidAmount || 0)) })),
        abonosRaros: pagosChicos.filter((p) => String(p.clientId) === String(c._id)).map((p) => ({ periodo: p.period, monto: dinero(p.amount), fecha: p.paidAt })),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const resumen = { clientes: detalle.length, cobros: abiertos.length, saldoTotal: dinero(abiertos.reduce((s, i) => s + (i.amount - (i.paidAmount || 0)), 0)), motivo };
  const alcance = input.cliente || input.todos_archivados;
  if (!input.confirmar || !alcance) {
    return { ...resumen, detalle, siguiente: alcance ? "Si está bien, vuelve a llamar con confirmar=true." : "Para condonar todo: todos_archivados=true y confirmar=true. Para uno: cliente y confirmar=true." };
  }
  if (!input.cliente && !detalle.every((c) => c.archivado)) {
    throw new CustomError("Hay clientes activos con saldo en la lista; con todos_archivados solo se condonan archivados.", 409);
  }
  let condonados = 0;
  for (const inv of abiertos) {
    await invoiceQueryService.markWaived(String(inv._id), `${motivo} (${quien.payload.name}, MCP)`);
    condonados++;
  }
  return { ...resumen, condonados, detalle, nota: "Cobros en estado 'condonada'; los pagos registrados quedan intactos. Ya no cuentan en por cobrar ni en mora." };
}

export const mcpService = { clientes, cliente, resumen, registrarPago, bloqueos, vincular, acceso, plazo, crearCliente, actorExiste, comprobante, darDeBaja };
