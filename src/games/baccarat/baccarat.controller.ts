import { randomInt } from "node:crypto";
import { Router } from "express";
import prisma from "../../config/prisma";

type BetArea = "PLAYER" | "BANKER" | "TIE";
type BaccaratResult = "PLAYER" | "BANKER" | "TIE";

type BaccaratCard = {
  label: string;
  points: number;
};

const router = Router();

const PLAYER_PAYOUT = 2;
const BANKER_PAYOUT = 1.95;
const TIE_PAYOUT = 9;

const rankPool = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

const cardPoints = (rank: string): number => {
  if (rank === "A") {
    return 1;
  }

  if (["10", "J", "Q", "K"].includes(rank)) {
    return 0;
  }

  return Number(rank);
};

const drawCard = (): BaccaratCard => {
  const label = rankPool[randomInt(rankPool.length)];
  return {
    label,
    points: cardPoints(label),
  };
};

const handTotal = (hand: BaccaratCard[]): number => hand.reduce((sum, card) => sum + card.points, 0) % 10;

const bankerShouldDraw = (bankerTotal: number, playerThirdCard: BaccaratCard | null): boolean => {
  if (!playerThirdCard) {
    return bankerTotal <= 5;
  }

  const playerThirdPoints = playerThirdCard.points;

  if (bankerTotal <= 2) {
    return true;
  }

  if (bankerTotal === 3) {
    return playerThirdPoints !== 8;
  }

  if (bankerTotal === 4) {
    return playerThirdPoints >= 2 && playerThirdPoints <= 7;
  }

  if (bankerTotal === 5) {
    return playerThirdPoints >= 4 && playerThirdPoints <= 7;
  }

  if (bankerTotal === 6) {
    return playerThirdPoints === 6 || playerThirdPoints === 7;
  }

  return false;
};

const resolveUser = async (userId?: string) => {
  if (!userId) {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  return user;
};

router.post("/play", async (req, res) => {
  try {
    const { userId, betArea, betAmount } = req.body as {
      userId?: string;
      betArea?: BetArea;
      betAmount?: number;
    };

    if (betArea !== "PLAYER" && betArea !== "BANKER" && betArea !== "TIE") {
      return res.status(400).json({ message: "betArea invalide (PLAYER, BANKER ou TIE)." });
    }

    if (typeof betAmount !== "number" || !Number.isFinite(betAmount) || betAmount <= 0) {
      return res.status(400).json({ message: "Mise invalide." });
    }

    const user = await resolveUser(userId);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable." });
    }

    if (user.chipBalance < betAmount) {
      return res.status(400).json({ message: "Solde insuffisant." });
    }

    const playerHand: BaccaratCard[] = [drawCard(), drawCard()];
    const bankerHand: BaccaratCard[] = [drawCard(), drawCard()];

    let playerTotal = handTotal(playerHand);
    let bankerTotal = handTotal(bankerHand);

    const natural = playerTotal >= 8 || bankerTotal >= 8;
    let playerThirdCard: BaccaratCard | null = null;

    if (!natural) {
      if (playerTotal <= 5) {
        playerThirdCard = drawCard();
        playerHand.push(playerThirdCard);
        playerTotal = handTotal(playerHand);
      }

      if (bankerShouldDraw(bankerTotal, playerThirdCard)) {
        bankerHand.push(drawCard());
        bankerTotal = handTotal(bankerHand);
      }
    }

    const result: BaccaratResult = playerTotal > bankerTotal
      ? "PLAYER"
      : (bankerTotal > playerTotal ? "BANKER" : "TIE");

    let payout = 0;

    if (betArea === result) {
      if (result === "PLAYER") {
        payout = betAmount * PLAYER_PAYOUT;
      } else if (result === "BANKER") {
        payout = betAmount * BANKER_PAYOUT;
      } else {
        payout = betAmount * TIE_PAYOUT;
      }
    }

    payout = Math.round(payout * 100) / 100;
    const outcome = Math.round((payout - betAmount) * 100) / 100;

    const updatedUser = await prisma.$transaction(async (tx) => {
      const debited = await tx.user.update({
        where: { id: user.id },
        data: {
          chipBalance: {
            decrement: betAmount,
          },
        },
      });

      await tx.transaction.create({
        data: {
          userId: user.id,
          amount: betAmount,
          type: "BET",
          game: "BACCARAT",
        },
      });

      if (payout <= 0) {
        return debited;
      }

      const credited = await tx.user.update({
        where: { id: user.id },
        data: {
          chipBalance: {
            increment: payout,
          },
        },
      });

      await tx.transaction.create({
        data: {
          userId: user.id,
          amount: payout,
          type: "WIN",
          game: "BACCARAT",
        },
      });

      return credited;
    });

    return res.json({
      status: outcome >= 0 ? "WON" : "LOST",
      betArea,
      betAmount,
      payout,
      outcome,
      result,
      player: {
        hand: playerHand,
        total: playerTotal,
      },
      banker: {
        hand: bankerHand,
        total: bankerTotal,
      },
      natural,
      chipBalance: updatedUser.chipBalance,
      payouts: {
        PLAYER: PLAYER_PAYOUT,
        BANKER: BANKER_PAYOUT,
        TIE: TIE_PAYOUT,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur pendant la partie Baccarat." });
  }
});

export default router;
