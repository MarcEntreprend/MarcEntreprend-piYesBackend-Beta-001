// server.ts - VERSION VERCEL FINALE

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
    "http://localhost",
  ].filter(Boolean);

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

  // API Routes
  try {
    const authRoutes = (await import("./server/src/routes/auth")).default;
    const userRoutes = (await import("./server/src/routes/user")).default;
    const transactionRoutes = (await import("./server/src/routes/transactions"))
      .default;
    const contactRoutes = (await import("./server/src/routes/contacts"))
      .default;
    const friendshipRoutes = (await import("./server/src/routes/friendship"))
      .default;
    const schedulerRoutes = (await import("./server/src/routes/scheduler"))
      .default;
    const serviceRoutes = (await import("./server/src/routes/services"))
      .default;
    const promotionRoutes = (await import("./server/src/routes/promotions"))
      .default;
    const bankRoutes = (await import("./server/src/routes/banks")).default;

    const apiV1 = express.Router();
    apiV1.use("/auth", authRoutes);
    apiV1.use("/user", userRoutes);
    apiV1.use("/transactions", transactionRoutes);
    apiV1.use("/contacts", contactRoutes);
    apiV1.use("/friendship", friendshipRoutes);
    apiV1.use("/scheduler", schedulerRoutes);
    apiV1.use("/services", serviceRoutes);
    apiV1.use("/promotions", promotionRoutes);
    apiV1.use("/banks", bankRoutes);

    app.use("/api/v1", apiV1);
    console.log(">>> [STARTUP] API routes mounted.");
  } catch (err) {
    console.error("!!! [ERROR] Failed to load API routes:", err);
  }

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
