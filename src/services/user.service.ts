import { FilterQuery } from "mongoose";
import { IUser, User } from "../models";
import { CustomError } from "../errors/customError.error";
import { UserRole } from "../types/AuthRequest";
import { PaginatedResult } from "../types/finance.types";

export interface UserListQuery {
  q?: string;
  role?: UserRole;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

export interface UserInput {
  name: string;
  email: string;
  password?: string;
  role?: UserRole;
  isActive?: boolean;
  receivesNotifications?: boolean;
  photoUrl?: string;
}

async function assertNotLastSuperadmin(userId: string) {
  const user = await User.findById(userId);
  if (!user || user.role !== "superadmin") return;

  const activeSuperadmins = await User.countDocuments({
    role: "superadmin",
    isActive: true,
    _id: { $ne: user._id },
  });

  if (activeSuperadmins === 0) {
    throw new CustomError("No puedes eliminar o desactivar al último superadministrador", 409);
  }
}

function assertNotSelf(userId: string, actingUserId?: string, action = "modificar") {
  if (actingUserId && actingUserId === userId) {
    throw new CustomError(`No puedes ${action} tu propia cuenta`, 409);
  }
}

async function list(query: UserListQuery = {}): Promise<PaginatedResult<IUser>> {
  const page = Math.max(query.page || 1, 1);
  const limit = Math.min(Math.max(query.limit || 50, 1), 200);

  const filter: FilterQuery<IUser> = {};
  if (query.q) {
    filter.$or = [
      { name: { $regex: query.q, $options: "i" } },
      { email: { $regex: query.q, $options: "i" } },
    ];
  }
  if (query.role) filter.role = query.role;
  if (typeof query.isActive === "boolean") filter.isActive = query.isActive;

  const [items, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
}

/**
 * Directorio para elegir vendedor o responsable de cobro. Lo ve cualquier
 * usuario autenticado: sin esto, un admin que registra una venta no tiene a
 * quién asignar (el listado completo es solo de superadmin).
 */
async function directory() {
  return User.find({ isActive: true }).select("name email photoUrl role").sort({ name: 1 }).lean();
}

async function getById(id: string) {
  const user = await User.findById(id);
  if (!user) throw new CustomError("Usuario no encontrado", 404);
  return user;
}

async function create(input: UserInput) {
  const email = input.email.toLowerCase().trim();
  const exists = await User.findOne({ email });
  if (exists) throw new CustomError("Ya existe un usuario con ese correo", 409);

  if (!input.password || input.password.length < 8) {
    throw new CustomError("La contraseña debe tener al menos 8 caracteres", 400);
  }

  return User.create({ ...input, email });
}

async function update(id: string, input: Partial<UserInput>) {
  const user = await getById(id);

  if (input.email && input.email.toLowerCase().trim() !== user.email) {
    const email = input.email.toLowerCase().trim();
    const exists = await User.findOne({ email, _id: { $ne: user._id } });
    if (exists) throw new CustomError("Ya existe un usuario con ese correo", 409);
    user.email = email;
  }

  if (typeof input.name === "string") user.name = input.name;
  if (input.role) user.role = input.role;
  if (typeof input.receivesNotifications === "boolean") {
    user.receivesNotifications = input.receivesNotifications;
  }
  if (typeof input.photoUrl === "string") user.photoUrl = input.photoUrl;

  if (typeof input.isActive === "boolean" && input.isActive !== user.isActive) {
    if (!input.isActive) await assertNotLastSuperadmin(id);
    user.isActive = input.isActive;
  }

  if (input.password) {
    if (input.password.length < 8) {
      throw new CustomError("La contraseña debe tener al menos 8 caracteres", 400);
    }
    user.password = input.password;
  }

  await user.save();
  return user;
}

async function toggleActive(id: string, isActive: boolean, actingUserId?: string) {
  if (!isActive) {
    assertNotSelf(id, actingUserId, "desactivar");
    await assertNotLastSuperadmin(id);
  }

  const user = await getById(id);
  user.isActive = isActive;
  await user.save();
  return user;
}

async function remove(id: string, actingUserId?: string) {
  assertNotSelf(id, actingUserId, "eliminar");
  await assertNotLastSuperadmin(id);

  const user = await getById(id);
  await user.deleteOne();
  return { message: "Usuario eliminado correctamente" };
}

export const userService = { list, directory, getById, create, update, toggleActive, remove };
