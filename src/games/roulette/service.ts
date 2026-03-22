import { randomInt } from "node:crypto";
import { calculateTotalReturn, calculateTotalStake, RouletteBet } from "./utils/payouts";

export type SpinInput = {
  bets: RouletteBet[];
};

export type SpinResult = {
  resultNumber: number;
  totalStake: number;
  totalReturn: number;
  net: number;
};

export function runRouletteSpin(input: SpinInput): SpinResult {
  const totalStake = calculateTotalStake(input.bets);
  const resultNumber = randomInt(37);
  const totalReturn = calculateTotalReturn(input.bets, resultNumber);
  const net = totalReturn - totalStake;

  return {
    resultNumber,
    totalStake,
    totalReturn,
    net,
  };
}
