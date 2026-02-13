import { Router } from "express";
import rouletteRouter from "../games/roulette/route";
import blackjackRouter from "../games/blackjack/blackjack.controller";
import minesRouter from "../games/mines/mines.controller";
import crashRouter from "../games/crash/crash.controller";
import luckyLadderRouter from "../games/lucky-ladder/lucky-ladder.controller";
import pokerRouter from "../games/poker/poker.controller";
import prisma from "../config/prisma";
import authRouter from "./auth";
import userRouter from "./userRoutes";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ message: "API is running" });
});

router.use("/auth", authRouter);
router.use("/user", userRouter);

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

router.use("/roulette", rouletteRouter);
router.use("/games/blackjack", blackjackRouter);
router.use("/games/mines", minesRouter);
router.use("/games/crash", crashRouter);
router.use("/games/lucky-ladder", luckyLadderRouter);
router.use("/games/poker", pokerRouter);

export default router;
