export type EvenChanceType = "red" | "black" | "even" | "odd" | "low" | "high";

export type RouletteBet =
  | { kind: "single"; number: number; amount: number }
  | { kind: "split"; numbers: [number, number]; amount: number }
  | { kind: "corner"; numbers: [number, number, number, number]; amount: number }
  | { kind: "evenChance"; chanceType: EvenChanceType; amount: number }
  | { kind: "dozen"; dozen: 1 | 2 | 3; amount: number }
  | { kind: "column"; column: 1 | 2 | 3; amount: number };

export const PAYOUTS = {
  single: 35,
  split: 17,
  corner: 8,
  evenChance: 1,
  dozen: 2,
  column: 2,
} as const;

export const RED_NUMBERS = [
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
];

export function isWinningBet(bet: RouletteBet, result: number): boolean {
  switch (bet.kind) {
    case "single":
      return bet.number === result;
    case "split":
      return bet.numbers[0] === result || bet.numbers[1] === result;
    case "corner":
      return (
        bet.numbers[0] === result ||
        bet.numbers[1] === result ||
        bet.numbers[2] === result ||
        bet.numbers[3] === result
      );
    case "evenChance":
      if (result === 0) return false;
      if (bet.chanceType === "red") return RED_NUMBERS.indexOf(result) !== -1;
      if (bet.chanceType === "black") return RED_NUMBERS.indexOf(result) === -1;
      if (bet.chanceType === "even") return result % 2 === 0;
      if (bet.chanceType === "odd") return result % 2 !== 0;
      if (bet.chanceType === "low") return result >= 1 && result <= 18;
      return result >= 19 && result <= 36;
    case "dozen":
      if (result === 0) return false;
      if (bet.dozen === 1) return result >= 1 && result <= 12;
      if (bet.dozen === 2) return result >= 13 && result <= 24;
      return result >= 25 && result <= 36;
    case "column":
      if (result === 0) return false;
      if (bet.column === 1) return result % 3 === 1;
      if (bet.column === 2) return result % 3 === 2;
      return result % 3 === 0;
  }
}

export function calculateTotalStake(bets: RouletteBet[]): number {
  return bets.reduce((sum, bet) => sum + bet.amount, 0);
}

export function calculateTotalReturn(bets: RouletteBet[], result: number): number {
  return bets.reduce((sum, bet) => {
    if (!isWinningBet(bet, result)) return sum;
    return sum + bet.amount * (PAYOUTS[bet.kind] + 1);
  }, 0);
}
