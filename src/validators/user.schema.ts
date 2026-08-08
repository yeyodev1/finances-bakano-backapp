import { z } from "zod";
import { booleanish, paginationSchema } from "./common.schema";

const roleSchema = z.enum(["superadmin", "admin", "viewer"]);

export const userListSchema = z.object({
  q: z.string().trim().optional(),
  role: roleSchema.optional(),
  isActive: booleanish.optional(),
  ...paginationSchema,
});

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "El nombre es obligatorio"),
  email: z.string().trim().email("Correo inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  role: roleSchema.optional(),
  isActive: z.boolean().optional(),
  receivesNotifications: z.boolean().optional(),
  photoUrl: z.string().url("URL de foto inválida").optional(),
});

export const updateUserSchema = createUserSchema.partial();

export const toggleActiveSchema = z.object({
  isActive: z.boolean(),
});
