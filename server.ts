// backend server.ts

import "dotenv/config";
import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
import cors from "cors";
import { fileURLToPath } from "url";

// ✅ IMPORTS AVEC .ts
import authRoutes from "./server/src/routes/auth.ts";
import userRoutes from "./server/src/routes/user.ts";
import transactionsRoutes from "./server/src/routes/transactions.ts";
import contactsRoutes from "./server/src/routes/contacts.ts";
import friendshipRoutes from "./server/src/routes/friendship.ts";
import schedulerRoutes from "./server/src/routes/scheduler.ts";
import servicesRoutes from "./server/src/routes/services.ts";
import promotionsRoutes from "./server/src/routes/promotions.ts";
import banksRoutes from "./server/src/routes/banks.ts";

console.log(">>> [SERVER] authRoutes =", authRoutes);
console.log(">>> [SERVER] typeof authRoutes =", typeof authRoutes);
console.log(">>> [SERVER] authRoutes.use =", typeof authRoutes?.use);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

async function initializeApp() {
  console.log(">>> [STARTUP] Beginning background initialization...");

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

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
  app.use(cookieParser());

  const allowedOrigins: (string | RegExp)[] = [
    "http://localhost:5173",
    "http://localhost:4173",
    "http://localhost:3000",
    "http://192.168.15.2:5173",
    "http://192.168.15.2:3000",
    "http://192.168.15.4:3000",
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
      allowedHeaders: ["Content-Type", "Authorization"],
      optionsSuccessStatus: 200,
    }),
  );

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

  const apiV1 = express.Router();
  apiV1.use("/auth", authRoutes);
  apiV1.use("/user", userRoutes);
  apiV1.use("/transactions", transactionsRoutes);
  apiV1.use("/contacts", contactsRoutes);
  apiV1.use("/friendship", friendshipRoutes);
  apiV1.use("/scheduler", schedulerRoutes);
  apiV1.use("/services", servicesRoutes);
  apiV1.use("/promotions", promotionsRoutes);
  apiV1.use("/banks", banksRoutes);

  app.use("/api/v1", apiV1);
  console.log(">>> [STARTUP] API routes mounted.");

  // ===== ROUTE SWAGGER UI =====
  app.use(
    "/api-docs",
    (await import("./server/src/routes/swagger.js")).default,
  );
  console.log(">>> [STARTUP] Swagger UI mounted at /api-docs");

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

initializeApp().catch((err) => {
  console.error("!!! [FATAL] Initialization error:", err);
});

process.on("uncaughtException", (err) => {
  console.error("!!! [CRASH] Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("!!! [CRASH] Unhandled Rejection:", reason);
});

export default app;

if (process.env.NODE_ENV !== "production") {
  const PORT = parseInt(process.env.PORT || "3000", 10);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`>>> [READY] Port ${PORT} is now open.`);
  });
}
