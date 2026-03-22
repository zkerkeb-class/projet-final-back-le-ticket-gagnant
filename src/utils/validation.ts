import { z } from "zod";

export const emailSchema = z.email().min(5).max(254).transform((value) => value.trim().toLowerCase());

export const usernameSchema = z.string().trim().min(3).max(32);

export const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/);

export const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const updateProfileSchema = z
  .object({
    username: usernameSchema.optional(),
    email: emailSchema.optional(),
  })
  .refine((data) => Boolean(data.username || data.email), {
    message: "Aucune donnée à mettre à jour.",
  });
