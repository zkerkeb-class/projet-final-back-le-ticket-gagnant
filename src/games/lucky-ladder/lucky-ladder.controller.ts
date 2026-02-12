import { Router } from "express";
import { randomUUID } from "node:crypto";
import prisma from "../../config/prisma";

type LuckyLadderStatus = "ACTIVE" | "LOST" | "CASHED_OUT" | "WON";

type LuckyLadderSession = {
  id: string;
  userId: string;
  status: LuckyLadderStatus;
  betAmount: number;
  totalSteps: number;
  currentStep: number;
  brokenStep: number | null;
  currentMultiplier: number;
  potentialPayout: number;
};

const router = Router();
const sessions = new Map<string, LuckyLadderSession>();
const ladderHistory: number[] = [];

const BREAK_CHANCES = [0.14, 0.17, 0.2, 0.24, 0.29, 0.34, 0.4, 0.47, 0.55, 0.64];
const STEP_MULTIPLIERS = [1.12, 1.28, 1.47, 1.72, 2.03, 2.43, 2.95, 3.64, 4.58, 5.9];

const round2 = (value: number): number => Math.round(value * 100) / 100;

const pushHistory = (value: number) => {
  ladderHistory.unshift(round2(value));
  if (ladderHistory.length > 12) {
    ladderHistory.pop();
  }
};

const resolveUser = async (userId?: string) => {
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });

  return user;
};

const buildResponse = (session: LuckyLadderSession, chipBalance: number) => {
  const nextStepIndex = session.currentStep;
  const nextBreakChance = session.status === "ACTIVE" && nextStepIndex < BREAK_CHANCES.length
    ? BREAK_CHANCES[nextStepIndex]
    : null;
  const nextMultiplier = session.status === "ACTIVE" && nextStepIndex < STEP_MULTIPLIERS.length
    ? STEP_MULTIPLIERS[nextStepIndex]
    : null;

  return {
    sessionId: session.id,
    status: session.status,
    betAmount: session.betAmount,
    totalSteps: session.totalSteps,
    currentStep: session.currentStep,
    brokenStep: session.brokenStep,
    currentMultiplier: session.currentMultiplier,
    nextBreakChance,
    nextMultiplier,
    potentialPayout: session.potentialPayout,
    chipBalance,
    availableActions: {
      climb: session.status === "ACTIVE",
      cashout: session.status === "ACTIVE" && session.currentStep > 0,
    },
    history: ladderHistory,
  };
};

router.post("/start", async (req, res) => {
  try {
    const { userId, betAmount } = req.body as {
      userId?: string;
      betAmount?: number;
    };

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

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        chipBalance: {
          decrement: betAmount,
        },
      },
    });

    const session: LuckyLadderSession = {
      id: randomUUID(),
      userId: user.id,
      status: "ACTIVE",
      betAmount: round2(betAmount),
      totalSteps: STEP_MULTIPLIERS.length,
      currentStep: 0,
      brokenStep: null,
      currentMultiplier: 1,
      potentialPayout: round2(betAmount),
    };

    sessions.set(session.id, session);

    return res.json(buildResponse(session, updatedUser.chipBalance));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur pendant start Lucky Ladder." });
  }
});

router.post("/state", async (req, res) => {
  try {
    const { sessionId, userId } = req.body as { sessionId?: string; userId?: string };

    if (!sessionId) {
      return res.status(400).json({ message: "sessionId requis." });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session Lucky Ladder introuvable." });
    }

    if (typeof userId === "string" && userId !== session.userId) {
      return res.status(403).json({ message: "Session non autorisée pour cet utilisateur." });
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });

    return res.json(buildResponse(session, user?.chipBalance ?? 0));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur pendant state Lucky Ladder." });
  }
});

router.post("/climb", async (req, res) => {
  try {
    const { sessionId, userId } = req.body as {
      sessionId?: string;
      userId?: string;
    };

    if (!sessionId) {
      return res.status(400).json({ message: "sessionId requis." });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session Lucky Ladder introuvable." });
    }

    if (session.status !== "ACTIVE") {
      const endedUser = await prisma.user.findUnique({ where: { id: session.userId } });
      return res.json(buildResponse(session, endedUser?.chipBalance ?? 0));
    }

    if (typeof userId === "string" && userId !== session.userId) {
      return res.status(403).json({ message: "Session non autorisée pour cet utilisateur." });
    }

    const currentIndex = session.currentStep;
    const breakChance = BREAK_CHANCES[currentIndex] ?? 1;

    if (Math.random() < breakChance) {
      session.status = "LOST";
      session.brokenStep = Math.min(session.totalSteps, currentIndex + 1);
      session.potentialPayout = 0;
      pushHistory(0);

      const lostUser = await prisma.user.findUnique({ where: { id: session.userId } });
      return res.json(buildResponse(session, lostUser?.chipBalance ?? 0));
    }

    session.currentStep = Math.min(session.totalSteps, currentIndex + 1);
    session.currentMultiplier = STEP_MULTIPLIERS[session.currentStep - 1] ?? session.currentMultiplier;
    session.potentialPayout = round2(session.betAmount * session.currentMultiplier);

    if (session.currentStep >= session.totalSteps) {
      session.status = "WON";

      const updatedUser = await prisma.user.update({
        where: { id: session.userId },
        data: {
          chipBalance: {
            increment: session.potentialPayout,
          },
        },
      });

      pushHistory(session.currentMultiplier);
      return res.json(buildResponse(session, updatedUser.chipBalance));
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    return res.json(buildResponse(session, user?.chipBalance ?? 0));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur pendant climb Lucky Ladder." });
  }
});

router.post("/cashout", async (req, res) => {
  try {
    const { sessionId, userId } = req.body as {
      sessionId?: string;
      userId?: string;
    };

    if (!sessionId) {
      return res.status(400).json({ message: "sessionId requis." });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session Lucky Ladder introuvable." });
    }

    if (session.status !== "ACTIVE") {
      return res.status(400).json({ message: "La session est déjà terminée." });
    }

    if (typeof userId === "string" && userId !== session.userId) {
      return res.status(403).json({ message: "Session non autorisée pour cet utilisateur." });
    }

    if (session.currentStep <= 0) {
      return res.status(400).json({ message: "Montez au moins une marche avant cashout." });
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

    pushHistory(session.currentMultiplier);

    return res.json(buildResponse(session, updatedUser.chipBalance));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur pendant cashout Lucky Ladder." });
  }
});

router.get("/meta", (_req, res) => {
  return res.json({
    breakChances: BREAK_CHANCES,
    multipliers: STEP_MULTIPLIERS,
  });
});

router.get("/history", (_req, res) => {
  return res.json({ history: ladderHistory });
});

export default router;
