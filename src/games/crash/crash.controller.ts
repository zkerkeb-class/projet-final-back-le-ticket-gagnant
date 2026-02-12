import { Router } from "express";
import { randomUUID } from "node:crypto";
import prisma from "../../config/prisma";

type CrashStatus = "ACTIVE" | "LOST" | "CASHED_OUT";

type CrashSession = {
  id: string;
  userId: string;
  status: CrashStatus;
  betAmount: number;
  startedAt: number;
  crashAt: number;
  autoCashoutAt: number | null;
  cashedOutAt: number | null;
  payout: number;
};

const router = Router();
const sessions = new Map<string, CrashSession>();
const crashHistory: number[] = [];

const GROWTH_PER_SECOND = 0.06;
const HOUSE_EDGE = 0.99;
const MAX_CRASH_MULTIPLIER = 100;

const round2 = (value: number): number => Math.round(value * 100) / 100;

const generateCrashPoint = (): number => {
  const randomValue = Math.random();
  const raw = HOUSE_EDGE / Math.max(1 - randomValue, 0.0001);
  return round2(Math.min(MAX_CRASH_MULTIPLIER, Math.max(1.01, raw)));
};

const getCurrentMultiplier = (startedAt: number, now = Date.now()): number => {
  const elapsedSec = Math.max(0, (now - startedAt) / 1000);
  return round2(Math.max(1, Math.exp(GROWTH_PER_SECOND * elapsedSec)));
};

const getElapsedMsToMultiplier = (multiplier: number): number => {
  const elapsedSec = Math.log(Math.max(1, multiplier)) / GROWTH_PER_SECOND;
  return Math.max(0, Math.floor(elapsedSec * 1000));
};

const pushCrashHistory = (value: number) => {
  crashHistory.unshift(round2(value));
  if (crashHistory.length > 12) {
    crashHistory.pop();
  }
};

const resolveUser = async (userId?: string) => {
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });

  return user;
};

const settleIfNeeded = async (session: CrashSession): Promise<void> => {
  if (session.status !== "ACTIVE") {
    return;
  }

  const currentMultiplier = getCurrentMultiplier(session.startedAt);

  if (session.autoCashoutAt && currentMultiplier >= session.autoCashoutAt && session.autoCashoutAt < session.crashAt) {
    session.status = "CASHED_OUT";
    session.cashedOutAt = session.autoCashoutAt;
    session.payout = round2(session.betAmount * session.autoCashoutAt);

    await prisma.user.update({
      where: { id: session.userId },
      data: {
        chipBalance: {
          increment: session.payout,
        },
      },
    });

    pushCrashHistory(session.autoCashoutAt);
    return;
  }

  if (currentMultiplier >= session.crashAt) {
    session.status = "LOST";
    session.cashedOutAt = null;
    session.payout = 0;
    pushCrashHistory(session.crashAt);
  }
};

const buildResponse = (session: CrashSession, chipBalance: number) => {
  const currentMultiplier = session.status === "ACTIVE"
    ? getCurrentMultiplier(session.startedAt)
    : round2(session.cashedOutAt ?? session.crashAt);

  return {
    sessionId: session.id,
    status: session.status,
    betAmount: session.betAmount,
    currentMultiplier,
    crashAt: session.status === "ACTIVE" ? null : session.crashAt,
    autoCashoutAt: session.autoCashoutAt,
    cashedOutAt: session.cashedOutAt,
    payout: session.payout,
    chipBalance,
    availableActions: {
      cashout: session.status === "ACTIVE",
    },
    history: crashHistory,
  };
};

router.post("/start", async (req, res) => {
  try {
    const { userId, betAmount, autoCashoutAt } = req.body as {
      userId?: string;
      betAmount?: number;
      autoCashoutAt?: number | null;
    };

    if (typeof betAmount !== "number" || !Number.isFinite(betAmount) || betAmount <= 0) {
      return res.status(400).json({ message: "Mise invalide." });
    }

    if (
      autoCashoutAt !== undefined
      && autoCashoutAt !== null
      && (typeof autoCashoutAt !== "number" || !Number.isFinite(autoCashoutAt) || autoCashoutAt <= 1)
    ) {
      return res.status(400).json({ message: "Auto cashout invalide (doit être > 1)." });
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

    const session: CrashSession = {
      id: randomUUID(),
      userId: user.id,
      status: "ACTIVE",
      betAmount: round2(betAmount),
      startedAt: Date.now(),
      crashAt: generateCrashPoint(),
      autoCashoutAt: autoCashoutAt ? round2(autoCashoutAt) : null,
      cashedOutAt: null,
      payout: 0,
    };

    sessions.set(session.id, session);

    return res.json(buildResponse(session, updatedUser.chipBalance));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur pendant start Crash." });
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
      return res.status(404).json({ message: "Session Crash introuvable." });
    }

    if (typeof userId === "string" && userId !== session.userId) {
      return res.status(403).json({ message: "Session non autorisée pour cet utilisateur." });
    }

    await settleIfNeeded(session);

    const user = await prisma.user.findUnique({ where: { id: session.userId } });

    return res.json(buildResponse(session, user?.chipBalance ?? 0));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur pendant state Crash." });
  }
});

router.post("/cashout", async (req, res) => {
  try {
    const { sessionId, userId } = req.body as { sessionId?: string; userId?: string };

    if (!sessionId) {
      return res.status(400).json({ message: "sessionId requis." });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session Crash introuvable." });
    }

    if (typeof userId === "string" && userId !== session.userId) {
      return res.status(403).json({ message: "Session non autorisée pour cet utilisateur." });
    }

    await settleIfNeeded(session);

    if (session.status !== "ACTIVE") {
      const userFinal = await prisma.user.findUnique({ where: { id: session.userId } });
      return res.json(buildResponse(session, userFinal?.chipBalance ?? 0));
    }

    const currentMultiplier = getCurrentMultiplier(session.startedAt);

    if (currentMultiplier >= session.crashAt) {
      session.status = "LOST";
      session.cashedOutAt = null;
      session.payout = 0;
      pushCrashHistory(session.crashAt);

      const userLost = await prisma.user.findUnique({ where: { id: session.userId } });
      return res.json(buildResponse(session, userLost?.chipBalance ?? 0));
    }

    session.status = "CASHED_OUT";
    session.cashedOutAt = currentMultiplier;
    session.payout = round2(session.betAmount * currentMultiplier);

    const updatedUser = await prisma.user.update({
      where: { id: session.userId },
      data: {
        chipBalance: {
          increment: session.payout,
        },
      },
    });

    pushCrashHistory(currentMultiplier);

    return res.json(buildResponse(session, updatedUser.chipBalance));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur pendant cashout Crash." });
  }
});

router.get("/history", (_req, res) => {
  return res.json({ history: crashHistory });
});

router.get("/meta", (_req, res) => {
  return res.json({
    growthPerSecond: GROWTH_PER_SECOND,
    maxMultiplier: MAX_CRASH_MULTIPLIER,
    houseEdge: HOUSE_EDGE,
    estimateMsToMultiplier: {
      x2: getElapsedMsToMultiplier(2),
      x5: getElapsedMsToMultiplier(5),
      x10: getElapsedMsToMultiplier(10),
    },
  });
});

export default router;
