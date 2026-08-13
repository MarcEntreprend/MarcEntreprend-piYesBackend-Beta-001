// backend server.ts

import "dotenv/config";
import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { fileURLToPath } from "url";

//  IMPORTS AVEC .ts (pour tsx)
import authRoutes from "./server/src/routes/auth.ts";
import userRoutes from "./server/src/routes/user.ts";
import transactionsRoutes from "./server/src/routes/transactions.ts";
import contactsRoutes from "./server/src/routes/contacts.ts";
import friendshipRoutes from "./server/src/routes/friendship.ts";
import schedulerRoutes from "./server/src/routes/scheduler.ts";
import servicesRoutes from "./server/src/routes/services.ts";
import promotionsRoutes from "./server/src/routes/promotions.ts";
import banksRoutes from "./server/src/routes/banks.ts";

//  PHASE 4 – OBP ROUTES (montées à la racine, hors /api/v1)
import obpKeysRoutes from "./server/src/routes/obpKeys.ts";
import obpFacadeRoutes from "./server/src/routes/obpFacade.ts";

//  SÉCURITÉ – middlewares de protection
import {
  globalLimiter,
  authLimiter,
  otpLimiter,
  pinLimiter,
  fundsLimiter,
  apiKeyLimiter,
} from "./server/src/middleware/rateLimit.ts";
import { errorHandler } from "./server/src/middleware.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

async function initializeApp() {
  console.log(">>> [STARTUP] Beginning background initialization...");

  // Cron de rappels (dev uniquement)
  if (process.env.NODE_ENV !== "production") {
    setInterval(async () => {
      try {
        await fetch(
          "http://localhost:3000/api/v1/scheduler/trigger-reminders",
          {
            method: "POST",
            headers: {
              "x-cron-secret": process.env.CRON_SECRET || "",
            },
          },
        );
      } catch (e) {
        /* silently ignore */
      }
    }, 60 * 1000);
  }

  // Middleware
  app.set("trust proxy", 1);
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'", // nécessaire pour Swagger UI
            "https://unpkg.com",
          ],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: [
            "'self'",
            "https://unpkg.com",
            "https://*.unpkg.com", // pour les sous-domaines
          ],
        },
      },
    }),
  );
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
  app.use(cookieParser());

  // Servir les fichiers statiques (favicon, images, etc.)
  app.use(express.static(path.join(__dirname, "public")));
  console.log(">>> [STARTUP] Static files mounted from /public");

  // CORS
  const allowedOrigins: (string | RegExp)[] = [
    "http://localhost:5173",
    "http://localhost:4173",
    "http://localhost:3000",
    "http://192.168.15.2:5173",
    "http://192.168.15.2:3000",
    process.env.FRONTEND_URL || "",
    "capacitor://localhost",
    "http://capacitor.localhost",
    "https://capacitor.localhost",
    "ionic://localhost",
    "http://localhost:8080",
    "http://10.0.2.2:3000",
    "https://pi-yes-frontend-beta-001.vercel.app",
    "https://piyes-wallet.vercel.app",
    "https://piyes-frontend.vercel.app",
  ].filter(Boolean);

  const localIp = "192.168.15.4";
  if (localIp && localIp.startsWith("192.168.")) {
    allowedOrigins.push(`http://${localIp}:5173`);
    allowedOrigins.push(`http://${localIp}:3000`);
  }

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const isAllowed = allowedOrigins.some((allowed) => {
          if (typeof allowed === "string") return allowed === origin;
          if (allowed instanceof RegExp) return allowed.test(origin);
          return false;
        });
        if (isAllowed) {
          callback(null, true);
        } else {
          console.warn(`[CORS] Blocked origin: ${origin}`);
          callback(new Error(`CORS bloqué pour: ${origin}`));
        }
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
      optionsSuccessStatus: 200,
    }),
  );

  // Health Checks
  app.get("/healthz", (req, res) => res.status(200).send("OK"));
  app.get("/api/health", (req, res) =>
    res.json({ status: "ok", timestamp: new Date().toISOString() }),
  );

  app.get("/api/v1/ping", (req, res) => {
    res.json({
      message: "pong",
      timestamp: new Date().toISOString(),
      origin: req.headers.origin || "unknown",
    });
  });

  // ============================================================
  // ROUTES API V1 (prefix /api/v1)
  // ============================================================
  const apiV1 = express.Router();

  // Rate limiting – routes sensibles (avant montage des routes)
  apiV1.use("/auth/login", authLimiter);
  apiV1.use("/auth/forgot-password", authLimiter);
  apiV1.use("/auth/reset-password", authLimiter);
  apiV1.use("/auth/otp", otpLimiter);
  apiV1.use("/auth/verify-session-otp", otpLimiter);
  apiV1.use("/user/pin/verify", pinLimiter);
  apiV1.use("/transactions", fundsLimiter);

  apiV1.use("/auth", authRoutes);
  apiV1.use("/user", userRoutes);
  apiV1.use("/transactions", transactionsRoutes);
  apiV1.use("/contacts", contactsRoutes);
  apiV1.use("/friendship", friendshipRoutes);
  apiV1.use("/scheduler", schedulerRoutes);
  apiV1.use("/services", servicesRoutes);
  apiV1.use("/promotions", promotionsRoutes);
  apiV1.use("/banks", banksRoutes);

  app.use("/api/v1", globalLimiter, apiV1);
  console.log(">>> [STARTUP] API routes mounted at /api/v1");

  // ============================================================
  // PHASE 4 – OBP ROUTES (montées à la racine, hors /api/v1)
  // ============================================================
  app.use("/obp/v3.1.0/keys", apiKeyLimiter, obpKeysRoutes);
  app.use("/obp/v3.1.0", obpFacadeRoutes);
  console.log(">>> [STARTUP] OBP routes mounted at /obp/v3.1.0");

  // ============================================================
  // SWAGGER UI
  // ============================================================
  app.use(
    "/api-docs",
    (await import("./server/src/routes/swagger.js")).default,
  );
  console.log(">>> [STARTUP] Swagger UI mounted at /api-docs");

  // ============================================================
  // ERROR HANDLER (après toutes les routes)
  // ============================================================
  app.use(errorHandler);

  // ============================================================
  // FALLBACK 404
  // ============================================================
  app.use((req, res) => {
    if (req.url.startsWith("/api") || req.url.startsWith("/obp")) {
      return res.status(404).json({
        error: { message: `Route ${req.url} not found`, code: "NOT_FOUND" },
      });
    }
    res.status(404).json({ error: "Backend API only." });
  });

  console.log(">>> [READY] Application is fully initialized.");
}

// Start initialization
initializeApp().catch((err) => {
  console.error("!!! [FATAL] Initialization error:", err);
});

process.on("uncaughtException", (err) => {
  console.error("!!! [CRASH] Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("!!! [CRASH] Unhandled Rejection:", reason);
});

// Export pour Vercel
export default app;

// Démarrage local
if (process.env.NODE_ENV !== "production") {
  const PORT = parseInt(process.env.PORT || "3000", 10);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`>>> [READY] Port ${PORT} is now open.`);
  });
}
