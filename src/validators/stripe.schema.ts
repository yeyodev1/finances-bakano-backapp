import { z } from "zod";
import { objectIdSchema } from "./common.schema";

export const linkCustomerSchema = z.object({
  clientId: objectIdSchema,
  stripeCustomerId: z
    .string()
    .trim()
    .regex(/^cus_[A-Za-z0-9]+$/, "El customer de Stripe debe tener la forma cus_..."),
});

export const importChargesSchema = z.object({
  clientId: objectIdSchema,
});
