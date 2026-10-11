import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  /** TOTP or recovery code; only looked at when the account has a second factor. */
  code: z.string().max(32).optional(),
});

// Password policy used when setting/changing passwords (not at login).
export const passwordPolicy = z
  .string()
  .min(10, "Mindestens 10 Zeichen")
  .max(200, "Höchstens 200 Zeichen")
  .refine((v) => /[A-Za-zÄÖÜäöü]/.test(v) && /\d/.test(v), {
    message: "Muss Buchstaben und Ziffern enthalten",
  });
