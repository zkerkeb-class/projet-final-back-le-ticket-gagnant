import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import prisma from "../config/prisma";
import { getJwtSecret } from "../config/security";
import { loginSchema, registerSchema } from "../utils/validation";

const authRouter = Router();

const JWT_SECRET = getJwtSecret();
const JWT_EXPIRES_IN = "7d";
const BCRYPT_HASH_REGEX = /^\$2[aby]\$\d{2}\$.{53}$/;
const isProduction = process.env.NODE_ENV === "production";
const ENABLE_RATE_LIMIT = isProduction || process.env.ENABLE_RATE_LIMIT_IN_DEV === "true";
const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX ?? (isProduction ? 12 : 300));
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: "Trop de tentatives. Réessayez plus tard." },
});

if (ENABLE_RATE_LIMIT) {
  authRouter.use(authLimiter);
}

const buildToken = (userId: string, email: string) => {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

authRouter.post("/register", async (req, res) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Payload invalide pour l'inscription.",
      });
    }

    const { username, email, password } = parsed.data;

    const normalizedEmail = email;
    const normalizedUsername = username;

    const [existingEmail, existingUsername] = await Promise.all([
      prisma.user.findUnique({ where: { email: normalizedEmail } }),
      prisma.user.findUnique({ where: { username: normalizedUsername } }),
    ]);

    if (existingEmail) {
      return res.status(409).json({ message: "Cet email est déjà utilisé." });
    }

    if (existingUsername) {
      return res.status(409).json({ message: "Ce nom d'utilisateur est déjà utilisé." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const createdUser = await prisma.user.create({
      data: {
        username: normalizedUsername,
        email: normalizedEmail,
        password: hashedPassword,
        chipBalance: 1000,
      },
    });

    const token = buildToken(createdUser.id, createdUser.email);

    return res.status(201).json({
      token,
      user: {
        id: createdUser.id,
        username: createdUser.username,
        email: createdUser.email,
        chipBalance: createdUser.chipBalance,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur lors de l'inscription." });
  }
});

authRouter.post("/login", async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Payload invalide pour la connexion." });
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email;

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return res.status(401).json({ message: "Identifiants invalides." });
    }

    const isHashedPassword = BCRYPT_HASH_REGEX.test(user.password);
    const isValidPassword = isHashedPassword
      ? await bcrypt.compare(password, user.password)
      : password === user.password;

    if (!isValidPassword) {
      return res.status(401).json({ message: "Identifiants invalides." });
    }

    if (!isHashedPassword) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });
    }

    const token = buildToken(user.id, user.email);

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        chipBalance: user.chipBalance,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur lors de la connexion." });
  }
});

export default authRouter;
