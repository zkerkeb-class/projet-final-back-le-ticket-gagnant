import { Router } from "express";
import prisma from "../../config/prisma";

const pokerRouter = Router();

const MAX_DELTA = 1_000_000;

pokerRouter.post("/settle", async (req, res) => {
  try {
    const { userId, amount } = req.body as { userId?: string; amount?: number };

    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ message: "userId requis." });
    }

    if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ message: "amount doit être un nombre non nul." });
    }

    if (Math.abs(amount) > MAX_DELTA) {
      return res.status(400).json({ message: "amount dépasse la limite autorisée." });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable." });
    }

    const nextBalance = user.chipBalance + amount;
    if (nextBalance < 0) {
      return res.status(400).json({
        message: "Solde insuffisant pour enregistrer ce résultat.",
        chipBalance: user.chipBalance,
      });
    }

    const transactionAmount = Math.abs(amount);
    const transactionType = amount > 0 ? "WIN" : "BET";

    const updated = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          chipBalance: nextBalance,
        },
      });

      await tx.transaction.create({
        data: {
          userId,
          amount: transactionAmount,
          type: transactionType,
          game: "POKER",
        },
      });

      return updatedUser;
    });

    return res.json({
      userId: updated.id,
      chipBalance: updated.chipBalance,
      delta: amount,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur poker." });
  }
});

export default pokerRouter;
