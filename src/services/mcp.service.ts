import { Types } from "mongoose";
import { Client, IClient, Invoice, Payment, Sale, User } from "../models";
import { CustomError } from "../errors/customError.error";
import { JwtPayload, UserRole } from "../types/AuthRequest";
import { PAYMENT_METHODS, PaymentMethod } from "../types/finance.types";
import { isValidPeriod, startOfDay, toPeriod } from "../utils/date.util";
import { accessStatusFor, accessStatusMap } from "./access.status.service";
import { lifetimeRevenueOf } from "./client.lifecycle.service";
import { dashboardService } from "./dashboard.service";
import { invoiceGenerationService } from "./invoice.generation.service";
import { paymentService } from "./payment.service";

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

async function actor(email: string | undefined): Promise<ActorMcp> {
  const correo = String(email || "").trim().toLowerCase();
  if (!correo) throw new CustomError("Falta la persona que hace la consulta.", 401);
  const user = await User.findOne({ email: correo, isActive: true }).select("_id name email role").lean();
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
    confirmar?: boolean;
  }
) {
  const quien = await actor(email);
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

  let abiertos = await Invoice.find({ clientId: c._id, status: { $in: OPEN } }).sort({ dueDate: 1, splitIndex: 1 }).lean();
  const periodo = toPeriod(fecha);
  let plan: string;
  if (abiertos.length) {
    plan = `Se reparte entre ${abiertos.length} cobro(s) abierto(s): ${abiertos.map((i) => `${i.period} ($${dinero(i.amount - (i.paidAmount || 0))} pendiente)`).join(", ")}.`;
  } else if (c.billingType === "monthly") {
    plan = `No tiene cobros abiertos: se genera el cobro de ${periodo} (mensual de $${dinero(c.amount)}) y se registra ahí.`;
  } else {
    plan = `No tiene cobros abiertos y es ${c.billingType === "special" ? "pago único / a convenir" : c.billingType}: se crea el cobro de ${periodo} por $${monto} y se registra ahí.`;
  }

  const pendienteHoy = abiertos.reduce((a, i) => a + Math.max(i.amount - (i.paidAmount || 0), 0), 0);
  if (abiertos.length && monto > pendienteHoy + 0.009) {
    throw new CustomError(`El monto ($${monto}) supera lo pendiente de ${c.name} ($${dinero(pendienteHoy)}). Revisa el monto o los cobros.`, 400);
  }

  const resumenPago = {
    cliente: c.name,
    monto,
    fecha: fecha.toISOString().slice(0, 10),
    metodo: input.metodo || c.paymentMethod,
    referencia: referencia ?? null,
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
        amount: monto,
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

  const r = await paymentService.settle(
    {
      clientId: String(c._id),
      amount: monto,
      paidAt: fecha,
      method: input.metodo,
      reference: referencia,
      notes: [input.notas?.trim(), "Registrado desde el MCP"].filter(Boolean).join(" · "),
    },
    quien.payload
  );
  return {
    listo: true,
    ...resumenPago,
    aplicado: r.applied,
    totalCobradoHistorico: await lifetimeRevenueOf(c._id),
  };
}

export const mcpService = { clientes, cliente, resumen, registrarPago };
