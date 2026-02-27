import { Response } from "express";
import prisma from "../../config/prisma";
import { AuthenticatedRequest } from "../../middlewares/auth";
import { runRouletteSpin } from "./service";
import { RouletteBet } from "./utils/payouts";

type SpinBody = {
  userId?: string;
  bets?: RouletteBet[];
};

export async function spinRoulette(req: AuthenticatedRequest, res: Response) {
  const body = req.body as SpinBody;

  if (!body.userId || typeof body.userId !== "string") {
    return res.status(401).json({ message: "Utilisateur non authentifié." });
  }

  if (!body.bets || !Array.isArray(body.bets) || body.bets.length === 0) {
    return res.status(400).json({ message: "bets doit contenir au moins une mise" });
  }

  const hasInvalidAmount = body.bets.some(
    (bet) => typeof bet.amount !== "number" || !Number.isFinite(bet.amount) || bet.amount <= 0,
  );
  if (hasInvalidAmount) {
    return res.status(400).json({ message: "montant de mise invalide" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable." });
    }

    const result = runRouletteSpin({ bets: body.bets });

    if (user.chipBalance < result.totalStake) {
      return res.status(400).json({ message: "Solde insuffisant." });
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      const debited = await tx.user.update({
        where: { id: user.id },
        data: {
          chipBalance: {
            decrement: result.totalStake,
          },
        },
      });

      await tx.transaction.create({
        data: {
          userId: user.id,
          amount: result.totalStake,
          type: "BET",
          game: "ROULETTE",
        },
      });

      if (result.totalReturn <= 0) {
        return debited;
      }

      const credited = await tx.user.update({
        where: { id: user.id },
        data: {
          chipBalance: {
            increment: result.totalReturn,
          },
        },
      });

      await tx.transaction.create({
        data: {
          userId: user.id,
          amount: result.totalReturn,
          type: "WIN",
          game: "ROULETTE",
        },
      });

      return credited;
    });

    return res.json({
      message: "spin terminé",
      data: {
        ...result,
        chipBalance: updatedUser.chipBalance,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur roulette." });
  }
}
