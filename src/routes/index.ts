import { Router } from "express";
import rouletteRouter from "../games/roulette/route";
import blackjackRouter from "../games/blackjack/blackjack.controller";
import minesRouter from "../games/mines/mines.controller";
import crashRouter from "../games/crash/crash.controller";
import luckyLadderRouter from "../games/lucky-ladder/lucky-ladder.controller";
import pokerRouter from "../games/poker/poker.controller";
import baccaratRouter from "../games/baccarat/baccarat.controller";
import prisma from "../config/prisma";
import authRouter from "./auth";
import userRouter from "./userRoutes";
import { AuthenticatedRequest, injectAuthenticatedUserId, requireAuth } from "../middlewares/auth";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ message: "API is running" });
});

router.use("/auth", authRouter);
router.use("/user", userRouter);

router.get("/users/balance", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Non autorisé." });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

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

router.use("/roulette", requireAuth, injectAuthenticatedUserId, rouletteRouter);
router.use("/games/blackjack", requireAuth, injectAuthenticatedUserId, blackjackRouter);
router.use("/games/mines", requireAuth, injectAuthenticatedUserId, minesRouter);
router.use("/games/crash", requireAuth, injectAuthenticatedUserId, crashRouter);
router.use("/games/lucky-ladder", requireAuth, injectAuthenticatedUserId, luckyLadderRouter);
router.use("/games/poker", requireAuth, injectAuthenticatedUserId, pokerRouter);
router.use("/games/baccarat", requireAuth, injectAuthenticatedUserId, baccaratRouter);

export default router;
