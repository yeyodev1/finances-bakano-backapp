import jwt, { SignOptions } from "jsonwebtoken";
import { User } from "../models";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";
import { JwtPayload } from "../types/AuthRequest";

const TOKEN_TTL = process.env.JWT_EXPIRES_IN || "30d";

function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: TOKEN_TTL } as SignOptions);
}

async function login(email: string, password: string) {
  const user = await User.findOne({ email: String(email).toLowerCase().trim() });

  if (!user) {
    throw new CustomError("Correo o contraseña incorrectos", 401);
  }

  if (!user.isActive) {
    throw new CustomError("Tu cuenta está desactivada. Contacta al administrador.", 403);
  }

  const isValid = await user.comparePassword(password);
  if (!isValid) {
    throw new CustomError("Correo o contraseña incorrectos", 401);
  }

  user.lastLoginAt = new Date();
  await user.save();

  const payload: JwtPayload = {
    _id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
  };

  return { token: signToken(payload), user: user.toJSON() };
}

async function getMe(userId: string) {
  const user = await User.findById(userId);
  if (!user) {
    throw new CustomError("Usuario no encontrado", 404);
  }
  return user.toJSON();
}

async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await User.findById(userId);
  if (!user) {
    throw new CustomError("Usuario no encontrado", 404);
  }

  const isValid = await user.comparePassword(currentPassword);
  if (!isValid) {
    throw new CustomError("La contraseña actual no es correcta", 400);
  }

  if (currentPassword === newPassword) {
    throw new CustomError("La nueva contraseña debe ser distinta de la actual", 400);
  }

  user.password = newPassword;
  await user.save();

  return { message: "Contraseña actualizada correctamente" };
}

async function seedSuperadmin() {
  const email = env.seedAdmin.email.toLowerCase().trim();
  const existing = await User.findOne({ email });

  if (existing) {
    console.log(`[seed] Superadmin ya existe: ${email}`);
    return { created: false, email };
  }

  if (!env.seedAdmin.password) {
    console.warn(
      "[seed] SEED_ADMIN_PASSWORD no está definida; no se crea el superadmin inicial."
    );
    return { created: false, email };
  }

  await User.create({
    name: env.seedAdmin.name,
    email,
    password: env.seedAdmin.password,
    role: "superadmin",
    isActive: true,
    receivesNotifications: true,
  });

  console.log(`[seed] Superadmin creado: ${email}`);
  return { created: true, email };
}

export const authService = { login, getMe, changePassword, seedSuperadmin };
export { seedSuperadmin };
