import { describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";

describe("requireAuth middleware", () => {
  it("accepte un token valide", async () => {
    process.env.JWT_SECRET = "12345678901234567890123456789012";
    const { requireAuth } = await import("../src/middlewares/auth");

    const token = jwt.sign(
      { userId: "u1", email: "test@example.com" },
      process.env.JWT_SECRET,
      { expiresIn: "1h", algorithm: "HS256" },
    );

    const req = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    } as any;

    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    const res = { status, json } as any;
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth?.userId).toBe("u1");
  });

  it("rejette un token invalide", async () => {
    process.env.JWT_SECRET = "12345678901234567890123456789012";
    const { requireAuth } = await import("../src/middlewares/auth");

    const req = {
      headers: {
        authorization: "Bearer invalid-token",
      },
    } as any;

    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    const res = { status, json } as any;
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });
});
