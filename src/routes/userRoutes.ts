import { Response, Router } from "express";
import prisma from "../config/prisma";
import { AuthenticatedRequest, requireAuth } from "../middlewares/auth";
import { buildWalletSummary, claimRescueBonus, getRecentTransactions, WalletError } from "../utils/wallet";
import { updateProfileSchema } from "../utils/validation";

const userRouter = Router();

userRouter.get("/profile", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Non autorise." });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        chipBalance: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "Profil introuvable." });
    }

    return res.json(user);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur lors de la lecture du profil." });
  }
});

userRouter.get("/wallet", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Non autorise." });
    }

    const summary = await buildWalletSummary(prisma, userId);
    return res.json(summary);
  } catch (error) {
    console.error(error);
    if (error instanceof WalletError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: "Erreur serveur lors de la lecture du portefeuille." });
  }
});

userRouter.get("/wallet/transactions", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Non autorise." });
    }

    const limitParam = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const transactions = await getRecentTransactions(prisma, userId, limitParam);
    return res.json({ transactions });
  } catch (error) {
    console.error(error);
    if (error instanceof WalletError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: "Erreur serveur lors de la lecture de l'historique." });
  }
});

userRouter.post("/wallet/rescue-bonus", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Non autorise." });
    }

    const summary = await prisma.$transaction(async (tx) => claimRescueBonus(tx, userId));
    return res.json(summary);
  } catch (error) {
    console.error(error);
    if (error instanceof WalletError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: "Erreur serveur lors de l'attribution du bonus de secours." });
  }
});

userRouter.put("/profile", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Non autorise." });
    }

    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Payload invalide pour la mise a jour du profil." });
    }

    const nextUsername = parsed.data.username;
    const nextEmail = parsed.data.email;

    const existingUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!existingUser) {
      return res.status(404).json({ message: "Profil introuvable." });
    }

    if (nextUsername && nextUsername !== existingUser.username) {
      const usernameTaken = await prisma.user.findUnique({ where: { username: nextUsername } });
      if (usernameTaken) {
        return res.status(409).json({ message: "Ce nom d'utilisateur est deja utilise." });
      }
    }

    if (nextEmail && nextEmail !== existingUser.email) {
      const emailTaken = await prisma.user.findUnique({ where: { email: nextEmail } });
      if (emailTaken) {
        return res.status(409).json({ message: "Cet email est deja utilise." });
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        username: nextUsername ?? undefined,
        email: nextEmail ?? undefined,
      },
      select: {
        id: true,
        username: true,
        email: true,
        chipBalance: true,
        updatedAt: true,
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur lors de la mise a jour du profil." });
  }
});

userRouter.delete("/profile", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Non autorise." });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: "Profil introuvable." });
    }

    await prisma.user.delete({ where: { id: userId } });

    return res.json({ message: "Compte supprime avec succes." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur lors de la suppression du profil." });
  }
});

export default userRouter;
