import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config/security";

type JwtPayload = {
  userId: string;
  email: string;
  iat: number;
  exp: number;
};

export type AuthenticatedRequest = Request & {
  auth?: {
    userId: string;
    email: string;
  };
};

const JWT_SECRET = getJwtSecret();

export const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Token manquant." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as JwtPayload;
    req.auth = {
      userId: decoded.userId,
      email: decoded.email,
    };
    return next();
  } catch {
    return res.status(401).json({ message: "Token invalide ou expiré." });
  }
};

export const injectAuthenticatedUserId = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return next();
  }

  const bodyValue = req.body && typeof req.body === "object" ? req.body : {};
  req.body = {
    ...bodyValue,
    userId,
  };

  next();
};