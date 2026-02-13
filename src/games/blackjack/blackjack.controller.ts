import { Response, Router } from "express";
import { randomUUID } from "node:crypto";
import prisma from "../../config/prisma";
import { BlackjackService, Card } from "./blackjack.service";

const router = Router();
const blackjackService = new BlackjackService();
const allowLocalFallback = process.env.BLACKJACK_LOCAL_FALLBACK === "true";

type BlackjackStatus = "ACTIVE" | "PLAYER_WON" | "DEALER_WON" | "PUSH";
type ActionType = "HIT" | "STAND" | "DOUBLE";
type SideBetType = "perfectPair" | "twentyOnePlusThree";

type SideBetInput = Record<SideBetType, number>;

type SideBetResult = {
  id: SideBetType;
  label: string;
  betAmount: number;
  won: boolean;
  payoutMultiplier: number;
  payout: number;
  outcome: number;
  hit: string | null;
};

type PlayerState = {
  hands: Card[][];
  bets: number[];
  stood: boolean[];
  doubled: boolean[];
  actionsTaken: number[];
  activeHandIndex: number;
  splitAces: boolean;
  sideBets: SideBetInput;
  sideBetResults: SideBetResult[];
  sideBetOutcome: number;
  sideBetPayout: number;
};

type GameSession = {
  id: string;
  userId: string;
  deck: Card[];
  dealerHand: Card[];
  status: BlackjackStatus;
  betAmount: number;
  outcome: number;
  playerState: PlayerState;
};

type LocalUser = {
  id: string;
  chipBalance: number;
};

class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const localUsers = new Map<string, LocalUser>();
const localSessions = new Map<string, GameSession>();

const resolveLocalUser = (userId?: string): LocalUser => {
  const resolvedUserId = userId ?? "local-user";
  const existing = localUsers.get(resolvedUserId);

  if (existing) {
    return existing;
  }

  const created: LocalUser = {
    id: resolvedUserId,
    chipBalance: 1000,
  };

  localUsers.set(resolvedUserId, created);
  return created;
};

const isDatabaseUnavailableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const maybeCode = (error as { code?: unknown }).code;
  if (typeof maybeCode === "string" && maybeCode.toUpperCase() === "ECONNREFUSED") {
    return true;
  }

  const combined = `${error.name} ${error.message}`.toLowerCase();

  return (
    combined.includes("econnrefused")
    || combined.includes("can\'t reach database server")
    || combined.includes("prismaclientinitializationerror")
  );
};

const parseCards = (value: unknown): Card[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value as Card[];
};

const defaultSideBets = (): SideBetInput => ({
  perfectPair: 0,
  twentyOnePlusThree: 0,
});

const parsePositiveOrZero = (value: unknown): number | null => {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return null;
  }

  return value;
};

const parseSideBetsInput = (value: unknown): SideBetInput => {
  if (!value || typeof value !== "object") {
    return defaultSideBets();
  }

  const candidate = value as Partial<Record<SideBetType, unknown>>;
  const perfectPair = parsePositiveOrZero(candidate.perfectPair);
  const twentyOnePlusThree = parsePositiveOrZero(candidate.twentyOnePlusThree);

  if (perfectPair === null || twentyOnePlusThree === null) {
    throw new HttpError(400, "Payload invalide: sideBets doit contenir des montants >= 0.");
  }

  return {
    perfectPair,
    twentyOnePlusThree,
  };
};

const totalSideBetAmount = (sideBets: SideBetInput): number => sideBets.perfectPair + sideBets.twentyOnePlusThree;

const buildInitialPlayerState = (cards: Card[], betAmount: number): PlayerState => ({
  hands: [cards],
  bets: [betAmount],
  stood: [false],
  doubled: [false],
  actionsTaken: [0],
  activeHandIndex: 0,
  splitAces: false,
  sideBets: defaultSideBets(),
  sideBetResults: [],
  sideBetOutcome: 0,
  sideBetPayout: 0,
});

const parsePlayerState = (rawPlayerHand: unknown, betAmount: number): PlayerState => {
  if (Array.isArray(rawPlayerHand)) {
    return buildInitialPlayerState(parseCards(rawPlayerHand), betAmount);
  }

  if (!rawPlayerHand || typeof rawPlayerHand !== "object") {
    return buildInitialPlayerState([], betAmount);
  }

  const candidate = rawPlayerHand as Partial<PlayerState>;
  const hands = Array.isArray(candidate.hands) ? candidate.hands.map((hand) => parseCards(hand)) : [[]];
  const count = hands.length;

  const bets = Array.isArray(candidate.bets) && candidate.bets.length === count
    ? candidate.bets.map((amount) => (typeof amount === "number" ? amount : betAmount))
    : Array(count).fill(betAmount);
  const stood = Array.isArray(candidate.stood) && candidate.stood.length === count
    ? candidate.stood.map(Boolean)
    : Array(count).fill(false);
  const doubled = Array.isArray(candidate.doubled) && candidate.doubled.length === count
    ? candidate.doubled.map(Boolean)
    : Array(count).fill(false);
  const actionsTaken = Array.isArray(candidate.actionsTaken) && candidate.actionsTaken.length === count
    ? candidate.actionsTaken.map((value) => (typeof value === "number" ? value : 0))
    : Array(count).fill(0);

  const candidateSideBets = (candidate as Partial<{ sideBets: unknown }>).sideBets;
  let sideBets = defaultSideBets();

  try {
    sideBets = parseSideBetsInput(candidateSideBets);
  } catch {
    sideBets = defaultSideBets();
  }

  const sideBetResultsRaw = (candidate as Partial<{ sideBetResults: unknown }>).sideBetResults;
  const sideBetResults = Array.isArray(sideBetResultsRaw)
    ? sideBetResultsRaw.filter((item): item is SideBetResult => {
      if (!item || typeof item !== "object") {
        return false;
      }

      const typed = item as Partial<SideBetResult>;
      return (
        (typed.id === "perfectPair" || typed.id === "twentyOnePlusThree")
        && typeof typed.label === "string"
        && typeof typed.betAmount === "number"
        && typeof typed.won === "boolean"
        && typeof typed.payoutMultiplier === "number"
        && typeof typed.payout === "number"
        && typeof typed.outcome === "number"
      );
    })
    : [];

  const sideBetOutcome = typeof (candidate as Partial<{ sideBetOutcome: unknown }>).sideBetOutcome === "number"
    ? Number((candidate as Partial<{ sideBetOutcome: number }>).sideBetOutcome)
    : 0;

  const sideBetPayout = typeof (candidate as Partial<{ sideBetPayout: unknown }>).sideBetPayout === "number"
    ? Number((candidate as Partial<{ sideBetPayout: number }>).sideBetPayout)
    : 0;

  return {
    hands,
    bets,
    stood,
    doubled,
    actionsTaken,
    activeHandIndex: typeof candidate.activeHandIndex === "number" ? candidate.activeHandIndex : 0,
    splitAces: Boolean(candidate.splitAces),
    sideBets,
    sideBetResults,
    sideBetOutcome,
    sideBetPayout,
  };
};

const getSuitColor = (suit: Card["suit"]): "RED" | "BLACK" => (suit === "H" || suit === "D" ? "RED" : "BLACK");

const getCardRankForStraight = (card: Card): number => {
  if (card.value === "A") {
    return 14;
  }

  if (card.value === "K") {
    return 13;
  }

  if (card.value === "Q") {
    return 12;
  }

  if (card.value === "J") {
    return 11;
  }

  return Number(card.value);
};

const evaluatePerfectPair = (first: Card, second: Card): { multiplier: number; hit: string | null } => {
  if (first.value !== second.value) {
    return { multiplier: 0, hit: null };
  }

  if (first.suit === second.suit) {
    return { multiplier: 25, hit: "Perfect Pair" };
  }

  if (getSuitColor(first.suit) === getSuitColor(second.suit)) {
    return { multiplier: 12, hit: "Colored Pair" };
  }

  return { multiplier: 6, hit: "Mixed Pair" };
};

const evaluateTwentyOnePlusThree = (cards: Card[]): { multiplier: number; hit: string | null } => {
  if (cards.length !== 3) {
    return { multiplier: 0, hit: null };
  }

  const [first, second, third] = cards;
  const values = cards.map((card) => card.value);
  const ranks = cards.map(getCardRankForStraight).sort((a, b) => a - b);
  const uniqueValuesCount = new Set(values).size;
  const flush = first.suit === second.suit && second.suit === third.suit;
  const isTrips = uniqueValuesCount === 1;

  const straight = (() => {
    if (ranks[0] + 1 === ranks[1] && ranks[1] + 1 === ranks[2]) {
      return true;
    }

    const aceLow = [...ranks].sort((a, b) => a - b);
    return aceLow[0] === 2 && aceLow[1] === 3 && aceLow[2] === 14;
  })();

  if (isTrips && flush) {
    return { multiplier: 100, hit: "Suited Trips" };
  }

  if (flush && straight) {
    return { multiplier: 40, hit: "Straight Flush" };
  }

  if (isTrips) {
    return { multiplier: 30, hit: "Three of a Kind" };
  }

  if (straight) {
    return { multiplier: 10, hit: "Straight" };
  }

  if (flush) {
    return { multiplier: 5, hit: "Flush" };
  }

  return { multiplier: 0, hit: null };
};

const settleSideBets = (playerHand: Card[], dealerUpCard: Card, sideBets: SideBetInput): {
  results: SideBetResult[];
  payout: number;
  outcome: number;
} => {
  const results: SideBetResult[] = [];

  const perfectPairEval = evaluatePerfectPair(playerHand[0], playerHand[1]);
  const perfectPairPayout = sideBets.perfectPair > 0 ? sideBets.perfectPair * (perfectPairEval.multiplier + 1) : 0;
  results.push({
    id: "perfectPair",
    label: "Perfect Pair",
    betAmount: sideBets.perfectPair,
    won: perfectPairEval.multiplier > 0,
    payoutMultiplier: perfectPairEval.multiplier,
    payout: perfectPairPayout,
    outcome: perfectPairPayout - sideBets.perfectPair,
    hit: perfectPairEval.hit,
  });

  const twentyOneEval = evaluateTwentyOnePlusThree([playerHand[0], playerHand[1], dealerUpCard]);
  const twentyOnePayout = sideBets.twentyOnePlusThree > 0 ? sideBets.twentyOnePlusThree * (twentyOneEval.multiplier + 1) : 0;
  results.push({
    id: "twentyOnePlusThree",
    label: "21+3",
    betAmount: sideBets.twentyOnePlusThree,
    won: twentyOneEval.multiplier > 0,
    payoutMultiplier: twentyOneEval.multiplier,
    payout: twentyOnePayout,
    outcome: twentyOnePayout - sideBets.twentyOnePlusThree,
    hit: twentyOneEval.hit,
  });

  const payout = results.reduce((acc, result) => acc + result.payout, 0);
  const totalBet = totalSideBetAmount(sideBets);
  const outcome = payout - totalBet;

  return {
    results,
    payout,
    outcome,
  };
};

const getHandScore = (hand: Card[]): number => blackjackService.calculateScore(hand);

const getSplitComparableValue = (card: Card): number | string => {
  if (["10", "J", "Q", "K"].includes(card.value)) {
    return 10;
  }

  return card.value;
};

const canSplitPair = (hand: Card[]): boolean => {
  if (hand.length !== 2) {
    return false;
  }

  return getSplitComparableValue(hand[0]) === getSplitComparableValue(hand[1]);
};

const updateActiveHandIndex = (state: PlayerState) => {
  const nextIndex = state.hands.findIndex((hand, index) => !state.stood[index] && getHandScore(hand) <= 21);
  state.activeHandIndex = nextIndex >= 0 ? nextIndex : -1;
};

const allHandsClosed = (state: PlayerState): boolean => state.activeHandIndex < 0;
const allPlayerHandsBusted = (state: PlayerState): boolean => state.hands.every((hand) => getHandScore(hand) > 21);

const totalBet = (state: PlayerState): number => state.bets.reduce((acc, bet) => acc + bet, 0);

const settleSessionIfNeeded = (session: GameSession): { payout: number; outcome: number; finalStatus: BlackjackStatus } | null => {
  updateActiveHandIndex(session.playerState);

  if (!allHandsClosed(session.playerState)) {
    return null;
  }

  if (allPlayerHandsBusted(session.playerState)) {
    return {
      payout: 0,
      outcome: -totalBet(session.playerState),
      finalStatus: "DEALER_WON",
    };
  }

  const dealerResult = blackjackService.dealerTurn(session.deck, session.dealerHand);
  session.deck = dealerResult.deck;
  session.dealerHand = dealerResult.hand;

  const dealerScore = getHandScore(session.dealerHand);
  let payout = 0;
  let outcome = 0;

  session.playerState.hands.forEach((hand, index) => {
    const playerScore = getHandScore(hand);
    const handBet = session.playerState.bets[index];

    if (playerScore > 21) {
      outcome -= handBet;
      return;
    }

    if (dealerScore > 21 || playerScore > dealerScore) {
      payout += handBet * 2;
      outcome += handBet;
      return;
    }

    if (playerScore === dealerScore) {
      payout += handBet;
      return;
    }

    outcome -= handBet;
  });

  const finalStatus: BlackjackStatus = outcome > 0 ? "PLAYER_WON" : (outcome < 0 ? "DEALER_WON" : "PUSH");
  return { payout, outcome, finalStatus };
};

const getAvailableActions = (state: PlayerState, status: BlackjackStatus, chipBalance: number) => {
  if (status !== "ACTIVE") {
    return {
      hit: false,
      stand: false,
      split: false,
      double: false,
    };
  }

  const index = state.activeHandIndex;
  if (index < 0 || !state.hands[index]) {
    return {
      hit: false,
      stand: false,
      split: false,
      double: false,
    };
  }

  const hand = state.hands[index];
  const handBet = state.bets[index] ?? 0;

  const canSplit = (
    state.hands.length === 1
    && canSplitPair(hand)
    && chipBalance >= handBet
    && !state.doubled[index]
    && state.actionsTaken[index] === 0
  );

  const canDouble = (
    hand.length === 2
    && chipBalance >= handBet
    && !state.doubled[index]
    && state.actionsTaken[index] === 0
    && !state.splitAces
  );

  return {
    hit: !state.stood[index],
    stand: !state.stood[index],
    split: canSplit,
    double: canDouble,
  };
};

const buildSessionResponse = (session: GameSession, chipBalance: number, mode?: "LOCAL_FALLBACK") => {
  updateActiveHandIndex(session.playerState);
  const currentIndex = session.playerState.activeHandIndex >= 0 ? session.playerState.activeHandIndex : 0;
  const playerHands = session.playerState.hands;
  const dealerScore = session.status === "ACTIVE" ? null : getHandScore(session.dealerHand);

  const response = {
    sessionId: session.id,
    status: session.status,
    betAmount: totalBet(session.playerState),
    sideBetTotal: totalSideBetAmount(session.playerState.sideBets),
    totalWager: totalBet(session.playerState) + totalSideBetAmount(session.playerState.sideBets),
    outcome: session.outcome,
    sideBetOutcome: session.playerState.sideBetOutcome,
    sideBetPayout: session.playerState.sideBetPayout,
    sideBetResults: session.playerState.sideBetResults,
    sideBets: session.playerState.sideBets,
    chipBalance,
    playerHand: playerHands[currentIndex] ?? [],
    playerScore: getHandScore(playerHands[currentIndex] ?? []),
    playerHands,
    playerScores: playerHands.map((hand) => getHandScore(hand)),
    activeHandIndex: session.playerState.activeHandIndex,
    dealerHand: session.dealerHand,
    dealerScore,
    remainingCards: session.deck.length,
    availableActions: getAvailableActions(session.playerState, session.status, chipBalance),
  };

  if (!mode) {
    return response;
  }

  return {
    ...response,
    mode,
  };
};

const drawOrThrow = (deck: Card[]): { card: Card; deck: Card[] } => {
  const drawn = blackjackService.drawCard(deck);
  if (!drawn.card) {
    throw new HttpError(500, "Le paquet est vide.");
  }

  return {
    card: drawn.card,
    deck: drawn.deck,
  };
};

const applyActionOnSession = async (
  session: GameSession,
  action: ActionType,
  options: {
    chipBalance: number;
    debit: (amount: number) => Promise<number>;
    credit: (amount: number) => Promise<number>;
  },
): Promise<{ updatedSession: GameSession; updatedChipBalance: number }> => {
  if (session.status !== "ACTIVE") {
    throw new HttpError(400, "La partie est déjà terminée.");
  }

  const state = session.playerState;
  updateActiveHandIndex(state);

  if (state.activeHandIndex < 0) {
    throw new HttpError(400, "Aucune main active disponible.");
  }

  const index = state.activeHandIndex;
  const hand = state.hands[index];

  if (!hand) {
    throw new HttpError(400, "Main active introuvable.");
  }

  if (action === "HIT") {
    const drawn = drawOrThrow(session.deck);
    session.deck = drawn.deck;
    state.hands[index] = [...hand, drawn.card];
    state.actionsTaken[index] += 1;

    const score = getHandScore(state.hands[index]);
    if (score > 21 || state.splitAces) {
      state.stood[index] = true;
    }
  }

  if (action === "STAND") {
    state.stood[index] = true;
    state.actionsTaken[index] += 1;
  }

  if (action === "DOUBLE") {
    if (state.actionsTaken[index] > 0 || hand.length !== 2 || state.splitAces) {
      throw new HttpError(400, "Double interdit sur cette main.");
    }

    const extraBet = state.bets[index];
    if (options.chipBalance < extraBet) {
      throw new HttpError(400, "Solde insuffisant pour doubler.");
    }

    const updatedBalance = await options.debit(extraBet);
    options.chipBalance = updatedBalance;

    state.bets[index] += extraBet;
    state.doubled[index] = true;
    state.actionsTaken[index] += 1;

    const drawn = drawOrThrow(session.deck);
    session.deck = drawn.deck;
    state.hands[index] = [...hand, drawn.card];
    state.stood[index] = true;
  }

  updateActiveHandIndex(state);

  const settlement = settleSessionIfNeeded(session);
  if (settlement) {
    session.status = settlement.finalStatus;
    session.outcome = settlement.outcome + session.playerState.sideBetOutcome;
    session.betAmount = totalBet(state);

    if (settlement.payout > 0) {
      options.chipBalance = await options.credit(settlement.payout);
    }
  } else {
    session.betAmount = totalBet(state);
    session.outcome = session.playerState.sideBetOutcome;
  }

  return {
    updatedSession: session,
    updatedChipBalance: options.chipBalance,
  };
};

const applySplitOnSession = async (
  session: GameSession,
  options: {
    chipBalance: number;
    debit: (amount: number) => Promise<number>;
    credit: (amount: number) => Promise<number>;
  },
): Promise<{ updatedSession: GameSession; updatedChipBalance: number }> => {
  if (session.status !== "ACTIVE") {
    throw new HttpError(400, "La partie est déjà terminée.");
  }

  const state = session.playerState;
  updateActiveHandIndex(state);
  const index = state.activeHandIndex;

  if (index !== 0 || state.hands.length !== 1) {
    throw new HttpError(400, "Split déjà utilisé ou indisponible.");
  }

  const hand = state.hands[index];
  if (!hand || !canSplitPair(hand) || state.actionsTaken[index] > 0) {
    throw new HttpError(400, "Split non autorisé pour cette main.");
  }

  const splitBet = state.bets[index];
  if (options.chipBalance < splitBet) {
    throw new HttpError(400, "Solde insuffisant pour split.");
  }

  options.chipBalance = await options.debit(splitBet);

  const first = hand[0];
  const second = hand[1];

  const draw1 = drawOrThrow(session.deck);
  session.deck = draw1.deck;
  const draw2 = drawOrThrow(session.deck);
  session.deck = draw2.deck;

  state.hands = [[first, draw1.card], [second, draw2.card]];
  state.bets = [splitBet, splitBet];
  state.stood = [false, false];
  state.doubled = [false, false];
  state.actionsTaken = [0, 0];
  state.activeHandIndex = 0;
  state.splitAces = first.value === "A";

  if (state.splitAces) {
    state.stood = [true, true];
    state.actionsTaken = [1, 1];
  }

  const settlement = settleSessionIfNeeded(session);
  if (settlement) {
    session.status = settlement.finalStatus;
    session.outcome = settlement.outcome;
    session.betAmount = totalBet(state);

    if (settlement.payout > 0) {
      options.chipBalance = await options.credit(settlement.payout);
    }
  } else {
    session.betAmount = totalBet(state);
    session.outcome = 0;
  }

  return {
    updatedSession: session,
    updatedChipBalance: options.chipBalance,
  };
};

const handleLocalError = (res: Response, error: unknown) => {
  if (error instanceof HttpError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  return res.status(500).json({ message: "Erreur serveur mode local Blackjack." });
};

const getSessionFromDb = async (sessionId: string, userId?: string): Promise<GameSession> => {
  const session = await prisma.blackjackSession.findFirst({
    where: {
      id: sessionId,
      ...(userId ? { userId } : {}),
    },
  });

  if (!session) {
    throw new HttpError(404, "Session Blackjack introuvable.");
  }

  return {
    id: session.id,
    userId: session.userId,
    deck: parseCards(session.deck),
    dealerHand: parseCards(session.dealerHand),
    status: session.status as BlackjackStatus,
    betAmount: session.betAmount,
    outcome: session.outcome,
    playerState: parsePlayerState(session.playerHand, session.betAmount),
  };
};

const saveSessionToDb = async (session: GameSession) => prisma.blackjackSession.update({
  where: { id: session.id },
  data: {
    deck: session.deck,
    dealerHand: session.dealerHand,
    playerHand: session.playerState,
    status: session.status,
    betAmount: session.betAmount,
    outcome: session.outcome,
  },
});

router.post("/start", async (req, res) => {
  try {
    const { userId, betAmount, sideBets } = req.body as { userId?: string; betAmount?: number; sideBets?: unknown };

    if (typeof betAmount !== "number" || Number.isNaN(betAmount) || betAmount <= 0) {
      return res.status(400).json({ message: "Payload invalide: betAmount (> 0) requis." });
    }

    const parsedSideBets = parseSideBetsInput(sideBets);
    const sideBetTotal = totalSideBetAmount(parsedSideBets);
    const totalInitialDebit = betAmount + sideBetTotal;

    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });

    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable." });
    }

    if (user.chipBalance < totalInitialDebit) {
      return res.status(400).json({ message: "Solde insuffisant." });
    }

    const deck = blackjackService.generateDeck();
    const playerDraw1 = blackjackService.drawCard(deck);
    const playerDraw2 = blackjackService.drawCard(playerDraw1.deck);
    const dealerDraw1 = blackjackService.drawCard(playerDraw2.deck);

    if (!playerDraw1.card || !playerDraw2.card || !dealerDraw1.card) {
      return res.status(500).json({ message: "Impossible de distribuer les cartes." });
    }

    const playerHand: Card[] = [playerDraw1.card, playerDraw2.card];
    const dealerHand: Card[] = [dealerDraw1.card];
    const playerState = buildInitialPlayerState(playerHand, betAmount);
    playerState.sideBets = parsedSideBets;

    const sideBetSettlement = settleSideBets(playerHand, dealerHand[0], parsedSideBets);
    playerState.sideBetResults = sideBetSettlement.results;
    playerState.sideBetOutcome = sideBetSettlement.outcome;
    playerState.sideBetPayout = sideBetSettlement.payout;

    const { session, updatedUser } = await prisma.$transaction(async (tx) => {
      const debitedUser = await tx.user.update({
        where: { id: user.id },
        data: { chipBalance: { decrement: totalInitialDebit } },
      });

      await tx.transaction.create({
        data: {
          userId: user.id,
          amount: totalInitialDebit,
          type: "BET",
          game: "BLACKJACK",
        },
      });

      let creditedUser = debitedUser;
      if (sideBetSettlement.payout > 0) {
        creditedUser = await tx.user.update({
          where: { id: user.id },
          data: { chipBalance: { increment: sideBetSettlement.payout } },
        });

        await tx.transaction.create({
          data: {
            userId: user.id,
            amount: sideBetSettlement.payout,
            type: "WIN",
            game: "BLACKJACK",
          },
        });
      }

      const createdSession = await tx.blackjackSession.create({
        data: {
          userId: user.id,
          deck: dealerDraw1.deck,
          playerHand: playerState,
          dealerHand,
          status: "ACTIVE",
          betAmount,
          outcome: sideBetSettlement.outcome,
        },
      });

      return { session: createdSession, updatedUser: creditedUser };
    });

    const normalizedSession: GameSession = {
      id: session.id,
      userId: session.userId,
      deck: parseCards(session.deck),
      dealerHand: parseCards(session.dealerHand),
      status: session.status as BlackjackStatus,
      betAmount: session.betAmount,
      outcome: session.outcome,
      playerState: parsePlayerState(session.playerHand, session.betAmount),
    };

    return res.status(201).json(buildSessionResponse(normalizedSession, updatedUser.chipBalance));
  } catch (error) {
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      if (!allowLocalFallback) {
        return res.status(503).json({ message: "Base de données indisponible. Activez PostgreSQL." });
      }

      try {
        const { userId, betAmount, sideBets } = req.body as { userId?: string; betAmount?: number; sideBets?: unknown };
        if (typeof betAmount !== "number" || Number.isNaN(betAmount) || betAmount <= 0) {
          return res.status(400).json({ message: "Payload invalide: betAmount (> 0) requis." });
        }

        const parsedSideBets = parseSideBetsInput(sideBets);
        const sideBetTotal = totalSideBetAmount(parsedSideBets);
        const totalInitialDebit = betAmount + sideBetTotal;

        const localUser = resolveLocalUser(userId);
        if (localUser.chipBalance < totalInitialDebit) {
          return res.status(400).json({ message: "Solde insuffisant." });
        }

        const deck = blackjackService.generateDeck();
        const p1 = drawOrThrow(deck);
        const p2 = drawOrThrow(p1.deck);
        const d1 = drawOrThrow(p2.deck);

        const playerState = buildInitialPlayerState([p1.card, p2.card], betAmount);
        playerState.sideBets = parsedSideBets;

        const sideBetSettlement = settleSideBets([p1.card, p2.card], d1.card, parsedSideBets);
        playerState.sideBetResults = sideBetSettlement.results;
        playerState.sideBetOutcome = sideBetSettlement.outcome;
        playerState.sideBetPayout = sideBetSettlement.payout;

        localUser.chipBalance -= totalInitialDebit;
        if (sideBetSettlement.payout > 0) {
          localUser.chipBalance += sideBetSettlement.payout;
        }

        const localSession: GameSession = {
          id: randomUUID(),
          userId: localUser.id,
          deck: d1.deck,
          dealerHand: [d1.card],
          status: "ACTIVE",
          betAmount,
          outcome: sideBetSettlement.outcome,
          playerState,
        };

        localSessions.set(localSession.id, localSession);
        return res.status(201).json(buildSessionResponse(localSession, localUser.chipBalance, "LOCAL_FALLBACK"));
      } catch (localError) {
        return handleLocalError(res, localError);
      }
    }
    return res.status(500).json({ message: "Erreur serveur lors du démarrage de la partie." });
  }
});

router.post("/hit", async (req, res) => {
  try {
    const { userId, sessionId } = req.body as { userId?: string; sessionId?: string };

    if (!sessionId) {
      return res.status(400).json({ message: "Payload invalide: sessionId requis." });
    }

    if (allowLocalFallback && localSessions.has(sessionId)) {
      try {
        const localSession = localSessions.get(sessionId);
        if (!localSession || (userId && localSession.userId !== userId)) {
          return res.status(404).json({ message: "Session Blackjack introuvable." });
        }

        const localUser = resolveLocalUser(localSession.userId);
        const result = await applyActionOnSession(localSession, "HIT", {
          chipBalance: localUser.chipBalance,
          debit: async (amount) => {
            if (localUser.chipBalance < amount) {
              throw new HttpError(400, "Solde insuffisant.");
            }
            localUser.chipBalance -= amount;
            return localUser.chipBalance;
          },
          credit: async (amount) => {
            localUser.chipBalance += amount;
            return localUser.chipBalance;
          },
        });

        localSessions.set(localSession.id, result.updatedSession);
        return res.json(buildSessionResponse(result.updatedSession, result.updatedChipBalance, "LOCAL_FALLBACK"));
      } catch (localError) {
        return handleLocalError(res, localError);
      }
    }

    const dbSession = await getSessionFromDb(sessionId, userId);
    const user = await prisma.user.findUnique({ where: { id: dbSession.userId } });

    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable." });
    }

    const result = await prisma.$transaction(async (tx) => {
      const actionResult = await applyActionOnSession(dbSession, "HIT", {
        chipBalance: user.chipBalance,
        debit: async (amount) => {
          const updated = await tx.user.update({
            where: { id: dbSession.userId },
            data: {
              chipBalance: {
                decrement: amount,
              },
            },
          });

          await tx.transaction.create({
            data: {
              userId: dbSession.userId,
              amount,
              type: "BET",
              game: "BLACKJACK",
            },
          });

          return updated.chipBalance;
        },
        credit: async (amount) => {
          const updated = await tx.user.update({
            where: { id: dbSession.userId },
            data: {
              chipBalance: {
                increment: amount,
              },
            },
          });

          await tx.transaction.create({
            data: {
              userId: dbSession.userId,
              amount,
              type: "WIN",
              game: "BLACKJACK",
            },
          });

          return updated.chipBalance;
        },
      });

      await tx.blackjackSession.update({
        where: { id: actionResult.updatedSession.id },
        data: {
          deck: actionResult.updatedSession.deck,
          dealerHand: actionResult.updatedSession.dealerHand,
          playerHand: actionResult.updatedSession.playerState,
          status: actionResult.updatedSession.status,
          betAmount: actionResult.updatedSession.betAmount,
          outcome: actionResult.updatedSession.outcome,
        },
      });

      return actionResult;
    });

    return res.json(buildSessionResponse(result.updatedSession, result.updatedChipBalance));
  } catch (error) {
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      if (!allowLocalFallback) {
        return res.status(503).json({ message: "Base de données indisponible. Activez PostgreSQL." });
      }

      try {
        const { userId, sessionId } = req.body as { userId?: string; sessionId?: string };
        if (!sessionId) {
          return res.status(400).json({ message: "Payload invalide: sessionId requis." });
        }

        const localSession = localSessions.get(sessionId);
        if (!localSession || (userId && localSession.userId !== userId)) {
          return res.status(404).json({ message: "Session Blackjack introuvable." });
        }

        const localUser = resolveLocalUser(localSession.userId);
        const result = await applyActionOnSession(localSession, "HIT", {
          chipBalance: localUser.chipBalance,
          debit: async (amount) => {
            if (localUser.chipBalance < amount) {
              throw new HttpError(400, "Solde insuffisant.");
            }
            localUser.chipBalance -= amount;
            return localUser.chipBalance;
          },
          credit: async (amount) => {
            localUser.chipBalance += amount;
            return localUser.chipBalance;
          },
        });

        localSessions.set(localSession.id, result.updatedSession);
        return res.json(buildSessionResponse(result.updatedSession, result.updatedChipBalance, "LOCAL_FALLBACK"));
      } catch (localError) {
        return handleLocalError(res, localError);
      }
    }
    return res.status(500).json({ message: "Erreur serveur pendant l'action Hit." });
  }
});

router.post("/stand", async (req, res) => {
  try {
    const { userId, sessionId } = req.body as { userId?: string; sessionId?: string };

    if (!sessionId) {
      return res.status(400).json({ message: "Payload invalide: sessionId requis." });
    }

    if (allowLocalFallback && localSessions.has(sessionId)) {
      try {
        const localSession = localSessions.get(sessionId);
        if (!localSession || (userId && localSession.userId !== userId)) {
          return res.status(404).json({ message: "Session Blackjack introuvable." });
        }

        const localUser = resolveLocalUser(localSession.userId);
        const result = await applyActionOnSession(localSession, "STAND", {
          chipBalance: localUser.chipBalance,
          debit: async (amount) => {
            if (localUser.chipBalance < amount) {
              throw new HttpError(400, "Solde insuffisant.");
            }
            localUser.chipBalance -= amount;
            return localUser.chipBalance;
          },
          credit: async (amount) => {
            localUser.chipBalance += amount;
            return localUser.chipBalance;
          },
        });

        localSessions.set(localSession.id, result.updatedSession);
        return res.json(buildSessionResponse(result.updatedSession, result.updatedChipBalance, "LOCAL_FALLBACK"));
      } catch (localError) {
        return handleLocalError(res, localError);
      }
    }

    const dbSession = await getSessionFromDb(sessionId, userId);
    const user = await prisma.user.findUnique({ where: { id: dbSession.userId } });

    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable." });
    }

    const result = await prisma.$transaction(async (tx) => {
      const actionResult = await applyActionOnSession(dbSession, "STAND", {
        chipBalance: user.chipBalance,
        debit: async (amount) => {
          const updated = await tx.user.update({
            where: { id: dbSession.userId },
            data: {
              chipBalance: {
                decrement: amount,
              },
            },
          });

          await tx.transaction.create({
            data: {
              userId: dbSession.userId,
              amount,
              type: "BET",
              game: "BLACKJACK",
            },
          });

          return updated.chipBalance;
        },
        credit: async (amount) => {
          const updated = await tx.user.update({
            where: { id: dbSession.userId },
            data: {
              chipBalance: {
                increment: amount,
              },
            },
          });

          await tx.transaction.create({
            data: {
              userId: dbSession.userId,
              amount,
              type: "WIN",
              game: "BLACKJACK",
            },
          });

          return updated.chipBalance;
        },
      });

      await tx.blackjackSession.update({
        where: { id: actionResult.updatedSession.id },
        data: {
          deck: actionResult.updatedSession.deck,
          dealerHand: actionResult.updatedSession.dealerHand,
          playerHand: actionResult.updatedSession.playerState,
          status: actionResult.updatedSession.status,
          betAmount: actionResult.updatedSession.betAmount,
          outcome: actionResult.updatedSession.outcome,
        },
      });

      return actionResult;
    });

    return res.json(buildSessionResponse(result.updatedSession, result.updatedChipBalance));
  } catch (error) {
    console.error(error);
    if (isDatabaseUnavailableError(error)) {
      if (!allowLocalFallback) {
        return res.status(503).json({ message: "Base de données indisponible. Activez PostgreSQL." });
      }

      try {
        const { userId, sessionId } = req.body as { userId?: string; sessionId?: string };
        if (!sessionId) {
          return res.status(400).json({ message: "Payload invalide: sessionId requis." });
        }

        const localSession = localSessions.get(sessionId);
        if (!localSession || (userId && localSession.userId !== userId)) {
          return res.status(404).json({ message: "Session Blackjack introuvable." });
        }

        const localUser = resolveLocalUser(localSession.userId);
        const result = await applyActionOnSession(localSession, "STAND", {
          chipBalance: localUser.chipBalance,
          debit: async (amount) => {
            if (localUser.chipBalance < amount) {
              throw new HttpError(400, "Solde insuffisant.");
            }
            localUser.chipBalance -= amount;
            return localUser.chipBalance;
          },
          credit: async (amount) => {
            localUser.chipBalance += amount;
            return localUser.chipBalance;
          },
        });

        localSessions.set(localSession.id, result.updatedSession);
        return res.json(buildSessionResponse(result.updatedSession, result.updatedChipBalance, "LOCAL_FALLBACK"));
      } catch (localError) {
        return handleLocalError(res, localError);
      }
    }
    return res.status(500).json({ message: "Erreur serveur pendant l'action Stand." });
  }
});

router.post("/double", async (req, res) => {
  try {
    const { userId, sessionId } = req.body as { userId?: string; sessionId?: string };

    if (!sessionId) {
      return res.status(400).json({ message: "Payload invalide: sessionId requis." });
    }

    if (allowLocalFallback && localSessions.has(sessionId)) {
      const localSession = localSessions.get(sessionId);
      if (!localSession || (userId && localSession.userId !== userId)) {
        return res.status(404).json({ message: "Session Blackjack introuvable." });
      }

      const localUser = resolveLocalUser(localSession.userId);
      const result = await applyActionOnSession(localSession, "DOUBLE", {
        chipBalance: localUser.chipBalance,
        debit: async (amount) => {
          if (localUser.chipBalance < amount) {
            throw new HttpError(400, "Solde insuffisant pour doubler.");
          }
          localUser.chipBalance -= amount;
          return localUser.chipBalance;
        },
        credit: async (amount) => {
          localUser.chipBalance += amount;
          return localUser.chipBalance;
        },
      });

      localSessions.set(localSession.id, result.updatedSession);
      return res.json(buildSessionResponse(result.updatedSession, result.updatedChipBalance, "LOCAL_FALLBACK"));
    }

    const dbSession = await getSessionFromDb(sessionId, userId);
    const user = await prisma.user.findUnique({ where: { id: dbSession.userId } });

    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable." });
    }

    const result = await prisma.$transaction(async (tx) => {
      const actionResult = await applyActionOnSession(dbSession, "DOUBLE", {
        chipBalance: user.chipBalance,
        debit: async (amount) => {
          const updated = await tx.user.update({
            where: { id: dbSession.userId },
            data: {
              chipBalance: {
                decrement: amount,
              },
            },
          });

          await tx.transaction.create({
            data: {
              userId: dbSession.userId,
              amount,
              type: "BET",
              game: "BLACKJACK",
            },
          });

          return updated.chipBalance;
        },
        credit: async (amount) => {
          const updated = await tx.user.update({
            where: { id: dbSession.userId },
            data: {
              chipBalance: {
                increment: amount,
              },
            },
          });

          await tx.transaction.create({
            data: {
              userId: dbSession.userId,
              amount,
              type: "WIN",
              game: "BLACKJACK",
            },
          });

          return updated.chipBalance;
        },
      });

      await tx.blackjackSession.update({
        where: { id: actionResult.updatedSession.id },
        data: {
          deck: actionResult.updatedSession.deck,
          dealerHand: actionResult.updatedSession.dealerHand,
          playerHand: actionResult.updatedSession.playerState,
          status: actionResult.updatedSession.status,
          betAmount: actionResult.updatedSession.betAmount,
          outcome: actionResult.updatedSession.outcome,
        },
      });

      return actionResult;
    });

    return res.json(buildSessionResponse(result.updatedSession, result.updatedChipBalance));
  } catch (error) {
    console.error(error);
    if (error instanceof HttpError) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    if (isDatabaseUnavailableError(error)) {
      if (!allowLocalFallback) {
        return res.status(503).json({ message: "Base de données indisponible. Activez PostgreSQL." });
      }

      return res.status(503).json({ message: "Base de données indisponible. Session non trouvée en local." });
    }

    return res.status(500).json({ message: "Erreur serveur pendant l'action Double." });
  }
});

router.post("/split", async (req, res) => {
  try {
    const { userId, sessionId } = req.body as { userId?: string; sessionId?: string };

    if (!sessionId) {
      return res.status(400).json({ message: "Payload invalide: sessionId requis." });
    }

    if (allowLocalFallback && localSessions.has(sessionId)) {
      const localSession = localSessions.get(sessionId);
      if (!localSession || (userId && localSession.userId !== userId)) {
        return res.status(404).json({ message: "Session Blackjack introuvable." });
      }

      const localUser = resolveLocalUser(localSession.userId);
      const splitResult = await applySplitOnSession(localSession, {
        chipBalance: localUser.chipBalance,
        debit: async (amount) => {
          if (localUser.chipBalance < amount) {
            throw new HttpError(400, "Solde insuffisant pour split.");
          }
          localUser.chipBalance -= amount;
          return localUser.chipBalance;
        },
        credit: async (amount) => {
          localUser.chipBalance += amount;
          return localUser.chipBalance;
        },
      });

      localSessions.set(localSession.id, splitResult.updatedSession);
      return res.json(buildSessionResponse(splitResult.updatedSession, localUser.chipBalance, "LOCAL_FALLBACK"));
    }

    const dbSession = await getSessionFromDb(sessionId, userId);
    const user = await prisma.user.findUnique({ where: { id: dbSession.userId } });

    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable." });
    }

    const result = await prisma.$transaction(async (tx) => {
      const splitResult = await applySplitOnSession(dbSession, {
        chipBalance: user.chipBalance,
        debit: async (amount) => {
          const updated = await tx.user.update({
            where: { id: dbSession.userId },
            data: {
              chipBalance: {
                decrement: amount,
              },
            },
          });

          await tx.transaction.create({
            data: {
              userId: dbSession.userId,
              amount,
              type: "BET",
              game: "BLACKJACK",
            },
          });

          return updated.chipBalance;
        },
        credit: async (amount) => {
          const updated = await tx.user.update({
            where: { id: dbSession.userId },
            data: {
              chipBalance: {
                increment: amount,
              },
            },
          });

          await tx.transaction.create({
            data: {
              userId: dbSession.userId,
              amount,
              type: "WIN",
              game: "BLACKJACK",
            },
          });

          return updated.chipBalance;
        },
      });

      await tx.blackjackSession.update({
        where: { id: splitResult.updatedSession.id },
        data: {
          deck: splitResult.updatedSession.deck,
          dealerHand: splitResult.updatedSession.dealerHand,
          playerHand: splitResult.updatedSession.playerState,
          status: splitResult.updatedSession.status,
          betAmount: splitResult.updatedSession.betAmount,
          outcome: splitResult.updatedSession.outcome,
        },
      });

      return splitResult;
    });

    return res.json(buildSessionResponse(result.updatedSession, result.updatedChipBalance));
  } catch (error) {
    console.error(error);
    if (error instanceof HttpError) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    if (isDatabaseUnavailableError(error)) {
      if (!allowLocalFallback) {
        return res.status(503).json({ message: "Base de données indisponible. Activez PostgreSQL." });
      }

      return res.status(503).json({ message: "Base de données indisponible. Session non trouvée en local." });
    }

    return res.status(500).json({ message: "Erreur serveur pendant l'action Split." });
  }
});

export default router;
