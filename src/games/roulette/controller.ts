import { Request, Response } from "express";
import { runRouletteSpin } from "./service";
import { RouletteBet } from "./utils/payouts";

type SpinBody = {
  bankroll?: number;
  bets?: RouletteBet[];
};

export function spinRoulette(req: Request, res: Response) {
  const body = req.body as SpinBody;

  if (typeof body.bankroll !== "number" || body.bankroll < 0) {
    return res.status(400).json({ message: "bankroll invalide" });
  }

  if (!body.bets || !Array.isArray(body.bets) || body.bets.length === 0) {
    return res.status(400).json({ message: "bets doit contenir au moins une mise" });
  }

  const hasInvalidAmount = body.bets.some((bet) => typeof bet.amount !== "number" || bet.amount <= 0);
  if (hasInvalidAmount) {
    return res.status(400).json({ message: "montant de mise invalide" });
  }

  const result = runRouletteSpin({ bankroll: body.bankroll, bets: body.bets });

  return res.json({
    message: "spin terminé",
    data: result,
  });
}
