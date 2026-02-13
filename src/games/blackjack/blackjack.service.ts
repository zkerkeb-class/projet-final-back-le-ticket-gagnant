import { randomInt } from "node:crypto";

export type CardSuit = "H" | "D" | "C" | "S";
export type CardValue = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";

export type Card = {
  suit: CardSuit;
  value: CardValue;
};

export class BlackjackService {
  private readonly suits: CardSuit[] = ["H", "D", "C", "S"];
  private readonly values: CardValue[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

  generateDeck(): Card[] {
    const deck: Card[] = [];

    for (const suit of this.suits) {
      for (const value of this.values) {
        deck.push({ suit, value });
      }
    }

    return this.shuffleDeck(deck);
  }

  calculateScore(hand: Card[]): number {
    let score = 0;
    let aces = 0;

    for (const card of hand) {
      if (card.value === "A") {
        aces += 1;
        score += 11;
      } else if (["K", "Q", "J"].includes(card.value)) {
        score += 10;
      } else {
        score += Number(card.value);
      }
    }

    while (score > 21 && aces > 0) {
      score -= 10;
      aces -= 1;
    }

    return score;
  }

  dealerTurn(deck: Card[], hand: Card[]): { deck: Card[]; hand: Card[] } {
    const dealerHand = [...hand];
    const remainingDeck = [...deck];

    while (this.calculateScore(dealerHand) < 17 && remainingDeck.length > 0) {
      const card = remainingDeck.pop();
      if (!card) {
        break;
      }
      dealerHand.push(card);
    }

    return {
      deck: remainingDeck,
      hand: dealerHand,
    };
  }

  drawCard(deck: Card[]): { card: Card | null; deck: Card[] } {
    const remainingDeck = [...deck];
    const card = remainingDeck.pop() ?? null;

    return {
      card,
      deck: remainingDeck,
    };
  }

  private shuffleDeck(deck: Card[]): Card[] {
    const shuffledDeck = [...deck];

    for (let i = shuffledDeck.length - 1; i > 0; i -= 1) {
      const randomIndex = randomInt(i + 1);
      [shuffledDeck[i], shuffledDeck[randomIndex]] = [shuffledDeck[randomIndex], shuffledDeck[i]];
    }

    return shuffledDeck;
  }
}
