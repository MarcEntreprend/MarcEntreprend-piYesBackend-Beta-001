// backend server.ts - VERSION VERCEL FINALE

import "dotenv/config";
import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
import cors from "cors";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// BACKGROUND INITIALIZATION
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
          },
        );
      } catch (e) {
        /* silently ignore */
      }
    }, 60 * 1000);
  }

  // Middleware
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
  app.use(cookieParser());

  const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:4173",
    "http://localhost:3000",
    process.env.FRONTEND_URL || "",
    "capacitor://localhost",
    "http://capacitor.localhost",
    "https://capacitor.localhost",
    "ionic://localhost",
    "http://localhost",
    "http://localhost:8080",
    "http://10.0.2.2:3000",
    // Production URLs
    "https://pi-yes-frontend-beta-001.vercel.app",
    "https://pi-yes-frontend-beta-001-git-main-marcentreprends-projects.vercel.app",
    "https://piyes-frontend.vercel.app", // pour d'autres URLs
    // Autoriser tous les sous-domaines Vercel (optionnel, pour plus de flexibilité)
    /^https:\/\/.*\.vercel\.app$/,
  ].filter(Boolean);

  // Ajouter dynamiquement l'IP locale (pour éviter de la fixer en dur)
  const localIp = "192.168.15.4"; // ← idéalement, rendre ça automatique
  if (localIp && localIp.startsWith("192.168.")) {
    allowedOrigins.push(`http://${localIp}:5173`);
    allowedOrigins.push(`http://${localIp}:3000`);
  }

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          console.warn(`[CORS] Blocked origin: ${origin}`);
          callback(new Error(`CORS bloqué pour: ${origin}`));
        }
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  // Health Checks
  app.get("/healthz", (req, res) => res.status(200).send("OK"));
  app.get("/api/health", (req, res) =>
    res.json({ status: "ok", timestamp: new Date().toISOString() }),
  );

  // Route de debug pour tester la connexion
  app.get("/api/v1/ping", (req, res) => {
    res.json({
      message: "pong",
      timestamp: new Date().toISOString(),
      origin: req.headers.origin || "unknown",
    });
  });

  // API Routes - Imports avec extension .js pour compatibilité Vercel
  const apiV1 = express.Router();

  apiV1.use("/auth", (await import("./server/src/routes/auth.js")).default);
  apiV1.use("/user", (await import("./server/src/routes/user.js")).default);
  apiV1.use(
    "/transactions",
    (await import("./server/src/routes/transactions.js")).default,
  );
  apiV1.use(
    "/contacts",
    (await import("./server/src/routes/contacts.js")).default,
  );
  apiV1.use(
    "/friendship",
    (await import("./server/src/routes/friendship.js")).default,
  );
  apiV1.use(
    "/scheduler",
    (await import("./server/src/routes/scheduler.js")).default,
  );
  apiV1.use(
    "/services",
    (await import("./server/src/routes/services.js")).default,
  );
  apiV1.use(
    "/promotions",
    (await import("./server/src/routes/promotions.js")).default,
  );
  apiV1.use("/banks", (await import("./server/src/routes/banks.js")).default);

  // Route de test directe
  app.get("/api/v1/test", (req, res) => {
    res.json({ message: "Test route works!" });
  });

  app.use("/api/v1", apiV1);
  console.log(">>> [STARTUP] API routes mounted.");

  // Fallback 404
  app.use((req, res) => {
    if (req.url.startsWith("/api")) {
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
  console.error(
    "!!! [CRASH] Unhandled Rejection at:",
    promise,
    "reason:",
    reason,
  );
});

// ✅ Export pour Vercel
export default app;

// ✅ Démarrage local uniquement
if (process.env.NODE_ENV !== "production") {
  const PORT = parseInt(process.env.PORT || "3000", 10);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`>>> [READY] Port ${PORT} is now open.`);
  });
}
