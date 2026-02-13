import { Response, Router } from "express";
import prisma from "../config/prisma";
import { AuthenticatedRequest, requireAuth } from "../middlewares/auth";
import { updateProfileSchema } from "../utils/validation";

const userRouter = Router();

userRouter.get("/profile", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Non autorisé." });
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

userRouter.put("/profile", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Non autorisé." });
    }

    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Payload invalide pour la mise à jour du profil." });
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
        return res.status(409).json({ message: "Ce nom d'utilisateur est déjà utilisé." });
      }
    }

    if (nextEmail && nextEmail !== existingUser.email) {
      const emailTaken = await prisma.user.findUnique({ where: { email: nextEmail } });
      if (emailTaken) {
        return res.status(409).json({ message: "Cet email est déjà utilisé." });
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
    return res.status(500).json({ message: "Erreur serveur lors de la mise à jour du profil." });
  }
});

userRouter.delete("/profile", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Non autorisé." });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: "Profil introuvable." });
    }

    await prisma.user.delete({ where: { id: userId } });

    return res.json({ message: "Compte supprimé avec succès." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur lors de la suppression du profil." });
  }
});

export default userRouter;
