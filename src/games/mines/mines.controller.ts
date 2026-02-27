import { Router } from "express";
import { randomUUID } from "node:crypto";
import { randomInt } from "node:crypto";
import prisma from "../../config/prisma";
import { PersistentMap } from "../../utils/persistentMap";

type MinesStatus = "ACTIVE" | "WON" | "LOST" | "CASHED_OUT";

type MinesSession = {
  id: string;
  userId: string;
  status: MinesStatus;
  betAmount: number;
  minesCount: number;
  minePositions: number[];
  revealedCells: number[];
  explodedCell: number | null;
  multiplier: number;
  potentialPayout: number;
};

const router = Router();

const GRID_SIZE = 25;
const MINES_MIN = 1;
const MINES_MAX = 24;
const HOUSE_EDGE = 0.97;

const sessions = new PersistentMap<MinesSession>("mines.json");

const round2 = (value: number): number => Math.round(value * 100) / 100;

const pickRandomMinePositions = (minesCount: number): number[] => {
  const positions = new Set<number>();

  while (positions.size < minesCount) {
    positions.add(randomInt(GRID_SIZE));
  }

  return Array.from(positions).sort((a, b) => a - b);
};

const computeNextMultiplier = (session: MinesSession): number => {
  const revealedSafe = session.revealedCells.length;
  const totalSafe = GRID_SIZE - session.minesCount;
  const remainingCellsBefore = GRID_SIZE - (revealedSafe - 1);
  const remainingSafeBefore = totalSafe - (revealedSafe - 1);

  if (remainingSafeBefore <= 0 || remainingCellsBefore <= 0) {
    return session.multiplier;
  }

  const stepMultiplier = (remainingCellsBefore / remainingSafeBefore) * HOUSE_EDGE;
  return round2(session.multiplier * stepMultiplier);
};

const buildResponse = (session: MinesSession, chipBalance: number) => {
  const safeTotal = GRID_SIZE - session.minesCount;
  const revealedMines = session.status === "ACTIVE"
    ? []
    : session.minePositions;

  return {
    sessionId: session.id,
    status: session.status,
    betAmount: session.betAmount,
    minesCount: session.minesCount,
    gridSize: GRID_SIZE,
    revealedCells: session.revealedCells,
    revealedMines,
    explodedCell: session.explodedCell,
    safeRevealedCount: session.revealedCells.length,
    safeTotal,
    multiplier: session.multiplier,
    potentialPayout: session.potentialPayout,
    chipBalance,
    availableActions: {
      reveal: session.status === "ACTIVE",
      cashout: session.status === "ACTIVE" && session.revealedCells.length > 0,
    },
  };
};

const resolveUser = async (userId?: string) => {
  if (!userId) {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    return null;
  }

  return user;
};

router.post("/start", async (req, res) => {
  try {
    const { userId, betAmount, minesCount } = req.body as {
      userId?: string;
      betAmount?: number;
      minesCount?: number;
    };

    if (typeof betAmount !== "number" || !Number.isFinite(betAmount) || betAmount <= 0) {
      return res.status(400).json({ message: "Mise invalide." });
    }

    if (
      typeof minesCount !== "number"
      || !Number.isInteger(minesCount)
      || minesCount < MINES_MIN
      || minesCount > MINES_MAX
    ) {
      return res.status(400).json({ message: "Nombre de mines invalide (1 à 24)." });
    }

    const user = await resolveUser(userId);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable." });
    }

    if (user.chipBalance < betAmount) {
      return res.status(400).json({ message: "Solde insuffisant." });
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        chipBalance: {
          decrement: betAmount,
        },
      },
    });

    const session: MinesSession = {
      id: randomUUID(),
      userId: user.id,
      status: "ACTIVE",
      betAmount: round2(betAmount),
      minesCount,
      minePositions: pickRandomMinePositions(minesCount),
      revealedCells: [],
      explodedCell: null,
      multiplier: 1,
      potentialPayout: round2(betAmount),
    };

    sessions.set(session.id, session);

    return res.json(buildResponse(session, updatedUser.chipBalance));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur pendant start Mines." });
  }
});

router.post("/reveal", async (req, res) => {
  try {
    const { userId, sessionId, cellIndex } = req.body as {
      userId?: string;
      sessionId?: string;
      cellIndex?: number;
    };

    if (!sessionId) {
      return res.status(400).json({ message: "sessionId requis." });
    }

    if (typeof cellIndex !== "number" || !Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= GRID_SIZE) {
      return res.status(400).json({ message: "cellIndex invalide." });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session Mines introuvable." });
    }

    if (session.status !== "ACTIVE") {
      return res.status(400).json({ message: "La session est déjà terminée." });
    }

    if (typeof userId === "string" && session.userId !== userId) {
      return res.status(403).json({ message: "Session non autorisée pour cet utilisateur." });
    }

    if (session.revealedCells.includes(cellIndex)) {
      const user = await prisma.user.findUnique({ where: { id: session.userId } });
      return res.json(buildResponse(session, user?.chipBalance ?? 0));
    }

    if (session.minePositions.includes(cellIndex)) {
      session.status = "LOST";
      session.explodedCell = cellIndex;
      session.potentialPayout = 0;

      const user = await prisma.user.findUnique({ where: { id: session.userId } });
      return res.json(buildResponse(session, user?.chipBalance ?? 0));
    }

    session.revealedCells.push(cellIndex);
    session.revealedCells.sort((a, b) => a - b);

    session.multiplier = computeNextMultiplier(session);
    session.potentialPayout = round2(session.betAmount * session.multiplier);

    const safeTotal = GRID_SIZE - session.minesCount;

    if (session.revealedCells.length >= safeTotal) {
      session.status = "WON";

      const updatedUser = await prisma.user.update({
        where: { id: session.userId },
        data: {
          chipBalance: {
            increment: session.potentialPayout,
          },
        },
      });

      return res.json(buildResponse(session, updatedUser.chipBalance));
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    return res.json(buildResponse(session, user?.chipBalance ?? 0));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur pendant reveal Mines." });
  }
});

router.post("/cashout", async (req, res) => {
  try {
    const { userId, sessionId } = req.body as {
      userId?: string;
      sessionId?: string;
    };

    if (!sessionId) {
      return res.status(400).json({ message: "sessionId requis." });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session Mines introuvable." });
    }

    if (session.status !== "ACTIVE") {
      return res.status(400).json({ message: "La session est déjà terminée." });
    }

    if (typeof userId === "string" && session.userId !== userId) {
      return res.status(403).json({ message: "Session non autorisée pour cet utilisateur." });
    }

    if (session.revealedCells.length === 0) {
      return res.status(400).json({ message: "Aucune case révélée: cashout impossible." });
    }

    session.status = "CASHED_OUT";

    const updatedUser = await prisma.user.update({
      where: { id: session.userId },
      data: {
        chipBalance: {
          increment: session.potentialPayout,
        },
      },
    });

    return res.json(buildResponse(session, updatedUser.chipBalance));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur pendant cashout Mines." });
  }
});

export default router;
