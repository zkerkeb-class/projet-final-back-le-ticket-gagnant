import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma";

const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
const JWT_EXPIRES_IN = "7d";
const BCRYPT_HASH_REGEX = /^\$2[aby]\$\d{2}\$.{53}$/;
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

const buildToken = (userId: string, email: string) => {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

authRouter.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body as {
      username?: string;
      email?: string;
      password?: string;
    };

    if (!username || !email || !password) {
      return res.status(400).json({ message: "Username, email et mot de passe requis." });
    }

    if (!STRONG_PASSWORD_REGEX.test(password)) {
      return res.status(400).json({
        message:
          "Mot de passe trop faible. Utilisez au moins 8 caractères avec majuscule, minuscule, chiffre et caractère spécial.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim();

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
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      return res.status(400).json({ message: "Email et mot de passe requis." });
    }

    const normalizedEmail = email.trim().toLowerCase();

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
