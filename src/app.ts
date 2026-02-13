import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { Server } from "node:http";
import routes from "./routes";
import prisma from "./config/prisma";
import { getAllowedCorsOrigins } from "./config/security";

const PORT = Number(process.env.PORT ?? 3000);
const allowedOrigins = new Set(getAllowedCorsOrigins());
const isProduction = process.env.NODE_ENV === "production";
const ENABLE_RATE_LIMIT = isProduction || process.env.ENABLE_RATE_LIMIT_IN_DEV === "true";
const API_RATE_LIMIT_MAX = Number(process.env.API_RATE_LIMIT_MAX ?? (isProduction ? 200 : 5000));
const API_RATE_LIMIT_WINDOW_MS = Number(process.env.API_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000);

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");

  app.use((_req, res, next) => {
    res.setHeader("X-Request-Id", randomUUID());
    next();
  });

  app.use(helmet());
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin non autorisée par CORS."));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }));

  if (ENABLE_RATE_LIMIT) {
    app.use(rateLimit({
      windowMs: API_RATE_LIMIT_WINDOW_MS,
      max: API_RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: { message: "Trop de requêtes. Réessayez plus tard." },
    }));
  }

  app.use(express.json({ limit: "32kb" }));
  app.use(express.urlencoded({ extended: true, limit: "32kb" }));

  app.use("/api", routes);

  app.get("/", (_req, res) => {
    res.json({ status: "ok", message: "Le Ticket Gagnant API" });
  });

  app.use((_req, res) => {
    res.status(404).json({ message: "Route introuvable." });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur inattendue." });
  });

  return app;
};

export const app = createApp();

const shutdownGracefully = (server: Server) => async () => {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

export const startServer = () => {
  const server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });

  process.on("SIGINT", shutdownGracefully(server));
  process.on("SIGTERM", shutdownGracefully(server));

  return server;
};

if (require.main === module) {
  startServer();
}

export default app;
