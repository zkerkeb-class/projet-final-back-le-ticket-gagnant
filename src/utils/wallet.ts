import prisma from "../config/prisma";

type WalletPrisma = Pick<typeof prisma, "user" | "transaction">;

type WalletTransactionType = "BET" | "WIN" | "DEPOSIT" | "WITHDRAWAL";

type WalletAdjustmentInput = {
  userId: string;
  amount: number;
  game: string;
  type: WalletTransactionType;
};

export type WalletTransactionView = {
  id: string;
  amount: number;
  type: WalletTransactionType;
  game: string | null;
  direction: "IN" | "OUT";
  createdAt: string;
};

export type RescueBonusStatus = {
  eligible: boolean;
  amount: number;
  maxBalanceToClaim: number;
  cooldownRemainingMs: number;
  availableAt: string | null;
  lastClaimedAt: string | null;
  currentBalance: number;
};

export type WalletSummary = {
  userId: string;
  chipBalance: number;
  recentTransactions: WalletTransactionView[];
  rescueBonus: RescueBonusStatus;
};

export class WalletError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "WalletError";
    this.statusCode = statusCode;
  }
}

export const INITIAL_CHIP_BALANCE = 1000;
export const WELCOME_BONUS_GAME = "WELCOME_BONUS";
export const RESCUE_BONUS_GAME = "RESCUE_BONUS";
export const RESCUE_BONUS_AMOUNT = 500;
export const RESCUE_BONUS_MAX_BALANCE = 50;
export const RESCUE_BONUS_COOLDOWN_MS = 12 * 60 * 60 * 1000;

const RECENT_TRANSACTIONS_LIMIT = 12;

export const roundChips = (value: number): number => Math.round(value * 100) / 100;

export const normalizeChipAmount = (value: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new WalletError(400, "Montant de jetons invalide.");
  }

  return roundChips(value);
};

const clampTransactionLimit = (value?: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return RECENT_TRANSACTIONS_LIMIT;
  }

  return Math.min(Math.max(Math.floor(value), 1), 50);
};

const toTransactionView = (transaction: Awaited<ReturnType<typeof prisma.transaction.findMany>>[number]): WalletTransactionView => ({
  id: transaction.id,
  amount: roundChips(transaction.amount),
  type: transaction.type,
  game: transaction.game,
  direction: transaction.type === "BET" || transaction.type === "WITHDRAWAL" ? "OUT" : "IN",
  createdAt: transaction.createdAt.toISOString(),
});

const getUserBalanceOrThrow = async (db: WalletPrisma, userId: string) => {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      chipBalance: true,
    },
  });

  if (!user) {
    throw new WalletError(404, "Utilisateur introuvable.");
  }

  return {
    id: user.id,
    chipBalance: roundChips(user.chipBalance),
  };
};

const recordTransaction = async (db: WalletPrisma, input: WalletAdjustmentInput) => {
  await db.transaction.create({
    data: {
      userId: input.userId,
      amount: normalizeChipAmount(input.amount),
      type: input.type,
      game: input.game,
    },
  });
};

export const debitUserBalance = async (
  db: WalletPrisma,
  input: Omit<WalletAdjustmentInput, "type"> & { type?: Extract<WalletTransactionType, "BET" | "WITHDRAWAL"> },
) => {
  const amount = normalizeChipAmount(input.amount);

  const updatedCount = await db.user.updateMany({
    where: {
      id: input.userId,
      chipBalance: {
        gte: amount,
      },
    },
    data: {
      chipBalance: {
        decrement: amount,
      },
    },
  });

  if (updatedCount.count === 0) {
    await getUserBalanceOrThrow(db, input.userId);
    throw new WalletError(400, "Solde insuffisant.");
  }

  const updatedUser = await getUserBalanceOrThrow(db, input.userId);
  await recordTransaction(db, {
    userId: input.userId,
    amount,
    game: input.game,
    type: input.type ?? "BET",
  });

  return updatedUser;
};

export const creditUserBalance = async (
  db: WalletPrisma,
  input: Omit<WalletAdjustmentInput, "type"> & { type?: Extract<WalletTransactionType, "WIN" | "DEPOSIT"> },
) => {
  const amount = normalizeChipAmount(input.amount);

  await getUserBalanceOrThrow(db, input.userId);

  await db.user.update({
    where: { id: input.userId },
    data: {
      chipBalance: {
        increment: amount,
      },
    },
  });

  await recordTransaction(db, {
    userId: input.userId,
    amount,
    game: input.game,
    type: input.type ?? "WIN",
  });

  return getUserBalanceOrThrow(db, input.userId);
};

export const getRecentTransactions = async (db: WalletPrisma, userId: string, limit?: number): Promise<WalletTransactionView[]> => {
  await getUserBalanceOrThrow(db, userId);

  const transactions = await db.transaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: clampTransactionLimit(limit),
  });

  return transactions.map(toTransactionView);
};

export const getRescueBonusStatus = async (
  db: WalletPrisma,
  userId: string,
  currentBalance?: number,
): Promise<RescueBonusStatus> => {
  const balance = typeof currentBalance === "number"
    ? roundChips(currentBalance)
    : (await getUserBalanceOrThrow(db, userId)).chipBalance;

  const lastClaim = await db.transaction.findFirst({
    where: {
      userId,
      type: "DEPOSIT",
      game: RESCUE_BONUS_GAME,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const now = Date.now();
  const lastClaimedAt = lastClaim?.createdAt ?? null;
  const availableAtDate = lastClaimedAt
    ? new Date(lastClaimedAt.getTime() + RESCUE_BONUS_COOLDOWN_MS)
    : null;
  const cooldownRemainingMs = availableAtDate
    ? Math.max(0, availableAtDate.getTime() - now)
    : 0;

  return {
    eligible: balance <= RESCUE_BONUS_MAX_BALANCE && cooldownRemainingMs === 0,
    amount: RESCUE_BONUS_AMOUNT,
    maxBalanceToClaim: RESCUE_BONUS_MAX_BALANCE,
    cooldownRemainingMs,
    availableAt: availableAtDate ? availableAtDate.toISOString() : null,
    lastClaimedAt: lastClaimedAt ? lastClaimedAt.toISOString() : null,
    currentBalance: balance,
  };
};

export const buildWalletSummary = async (
  db: WalletPrisma,
  userId: string,
  currentBalance?: number,
): Promise<WalletSummary> => {
  const chipBalance = typeof currentBalance === "number"
    ? roundChips(currentBalance)
    : (await getUserBalanceOrThrow(db, userId)).chipBalance;

  const [recentTransactions, rescueBonus] = await Promise.all([
    getRecentTransactions(db, userId, RECENT_TRANSACTIONS_LIMIT),
    getRescueBonusStatus(db, userId, chipBalance),
  ]);

  return {
    userId,
    chipBalance,
    recentTransactions,
    rescueBonus,
  };
};

const formatCooldown = (remainingMs: number): string => {
  const totalMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${minutes} min`;
  }

  if (minutes === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${minutes} min`;
};

export const claimRescueBonus = async (db: WalletPrisma, userId: string): Promise<WalletSummary> => {
  const user = await getUserBalanceOrThrow(db, userId);
  const rescueBonus = await getRescueBonusStatus(db, userId, user.chipBalance);

  if (user.chipBalance > RESCUE_BONUS_MAX_BALANCE) {
    throw new WalletError(
      400,
      `Le bonus de secours est reserve aux soldes <= ${RESCUE_BONUS_MAX_BALANCE.toFixed(2)} jetons.`,
    );
  }

  if (rescueBonus.cooldownRemainingMs > 0) {
    throw new WalletError(
      429,
      `Bonus de secours deja reclame. Reessayez dans ${formatCooldown(rescueBonus.cooldownRemainingMs)}.`,
    );
  }

  const updatedUser = await creditUserBalance(db, {
    userId,
    amount: RESCUE_BONUS_AMOUNT,
    game: RESCUE_BONUS_GAME,
    type: "DEPOSIT",
  });

  return buildWalletSummary(db, userId, updatedUser.chipBalance);
};
