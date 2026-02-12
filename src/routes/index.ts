import { Router } from "express";
import blackjackRouter from "../games/blackjack/blackjack.controller";
import prisma from "../config/prisma";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ message: "API is running" });
});

router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      return res.status(400).json({ message: "Email et mot de passe requis." });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || user.password !== password) {
      return res.status(401).json({ message: "Identifiants invalides." });
    }

    return res.json({
      userId: user.id,
      username: user.username,
      email: user.email,
      chipBalance: user.chipBalance,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur lors de la connexion." });
  }
});

router.get("/users/balance", async (req, res) => {
  try {
    const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;

    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });

    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable." });
    }

    return res.json({
      userId: user.id,
      username: user.username,
      chipBalance: user.chipBalance,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur lors de la lecture du solde." });
  }
});

router.use("/games/blackjack", blackjackRouter);

export default router;
