import { Router } from "express";
import rouletteRouter from "../games/roulette/route";
import blackjackRouter from "../games/blackjack/blackjack.controller";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ message: "API is running" });
});

router.use("/roulette", rouletteRouter);
router.use("/games/blackjack", blackjackRouter);

export default router;
