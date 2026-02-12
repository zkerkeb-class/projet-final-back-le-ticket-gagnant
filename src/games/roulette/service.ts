import { calculateTotalReturn, calculateTotalStake, RouletteBet } from "./utils/payouts";

export type SpinInput = {
  bankroll: number;
  bets: RouletteBet[];
};

export type SpinResult = {
  resultNumber: number;
  totalStake: number;
  totalReturn: number;
  net: number;
  bankrollAfter: number;
};

export function runRouletteSpin(input: SpinInput): SpinResult {
  const totalStake = calculateTotalStake(input.bets);
  const resultNumber = Math.floor(Math.random() * 37);
  const totalReturn = calculateTotalReturn(input.bets, resultNumber);
  const net = totalReturn - totalStake;

  return {
    resultNumber,
    totalStake,
    totalReturn,
    net,
    bankrollAfter: input.bankroll + totalReturn,
  };
}
