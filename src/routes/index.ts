import { Router } from "express";
import rouletteRouter from "../games/roulette/route";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ message: "API is running" });
});

router.use("/roulette", rouletteRouter);

export default router;
