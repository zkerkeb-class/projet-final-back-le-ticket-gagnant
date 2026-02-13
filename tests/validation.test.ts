import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema, updateProfileSchema } from "../src/utils/validation";

describe("validation schemas", () => {
  it("valide une inscription correcte", () => {
    const parsed = registerSchema.safeParse({
      username: "casino_user",
      email: "USER@EXAMPLE.COM",
      password: "StrongPass1!",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.email).toBe("user@example.com");
    }
  });

  it("rejette une connexion invalide", () => {
    const parsed = loginSchema.safeParse({ email: "bad", password: "x" });
    expect(parsed.success).toBe(false);
  });

  it("exige au moins un champ pour update profile", () => {
    const parsed = updateProfileSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });
});
