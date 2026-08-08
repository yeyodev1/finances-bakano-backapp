import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().min(1, "El correo es obligatorio").email("Correo inválido"),
  password: z.string().min(1, "La contraseña es obligatoria"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "La contraseña actual es obligatoria"),
  newPassword: z.string().min(8, "La nueva contraseña debe tener al menos 8 caracteres"),
});
