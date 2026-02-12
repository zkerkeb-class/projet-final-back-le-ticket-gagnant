import { Router } from "express";
import blackjackRouter from "../games/blackjack/blackjack.controller";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ message: "API is running" });
});

router.use("/games/blackjack", blackjackRouter);

export default router;
