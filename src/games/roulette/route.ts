import { Router } from "express";
import { spinRoulette } from "./controller";

const rouletteRouter = Router();

rouletteRouter.post("/spin", spinRoulette);

export default rouletteRouter;
