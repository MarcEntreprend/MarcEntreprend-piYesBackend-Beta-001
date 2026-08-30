// server/src/middleware/rateLimit.ts
//
// Rate limiting (express-rate-limit).
// Protège l'API contre le brute-force et les abus :
//   - limite globale sur /api/v1
//   - limites strictes sur les routes sensibles (auth, OTP, PIN, fonds, clés API)

import rateLimit from "express-rate-limit";

const num = (env: string | undefined, def: number) => {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : def;
};

function formatRetry(sec: number): string {
  if (sec <= 0) return "quelques secondes";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function dynamicHandler(prefix: string) {
  return (req: any, res: any) => {
    const reset = req.rateLimit?.resetTime ? new Date(req.rateLimit.resetTime).getTime() : Date.now() + 60_000;
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    res.status(429).json({
      error: {
        message: `${prefix} Réessayez dans ${formatRetry(retryAfter)}.`,
        code: "TOO_MANY_REQUESTS",
        retryAfter,
      },
    });
  };
}

export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: num(process.env.RATE_LIMIT_GLOBAL, 120),
  standardHeaders: true,
  legacyHeaders: false,
  handler: dynamicHandler("Trop de requêtes."),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: num(process.env.RATE_LIMIT_AUTH, 10),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: dynamicHandler("Trop de tentatives."),
});

const otpMemory = new Map<string, { ts: number[]; blockedUntil?: number }>();
const OTP_WINDOW_MS = 3 * 60 * 1000;
const OTP_BLOCK_MS = 15 * 60 * 1000;

export const otpLimiter = (req: any, res: any, next: any) => {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  const body = req.body || {};
  const target = (body.identifier || body.email || body.phone || body.contact || body.requestId || "").toString().toLowerCase() || "unknown";
  const key = `${ip}:${target}`;
  const now = Date.now();
  let entry = otpMemory.get(key);
  if (!entry) {
    entry = { ts: [] };
    otpMemory.set(key, entry);
  }
  if (entry.blockedUntil && now < entry.blockedUntil) {
    const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
    return res.status(429).json({
      error: {
        message: `Trop de demandes de code. Réessayez dans ${formatRetry(retryAfter)}.`,
        code: "TOO_MANY_REQUESTS",
        retryAfter,
      },
    });
  }
  if (entry.blockedUntil && now >= entry.blockedUntil) {
    entry.blockedUntil = undefined;
    entry.ts = [];
  }
  entry.ts = entry.ts.filter((t) => now - t < OTP_WINDOW_MS);
  if (entry.ts.length >= 2) {
    const firstInWindow = entry.ts[0];
    if (now - firstInWindow < OTP_WINDOW_MS) {
      entry.blockedUntil = now + OTP_BLOCK_MS;
      const retryAfter = Math.ceil(OTP_BLOCK_MS / 1000);
      return res.status(429).json({
        error: {
          message: `Trop de demandes de code. Réessayez dans ${formatRetry(retryAfter)}.`,
          code: "TOO_MANY_REQUESTS",
          retryAfter,
        },
      });
    }
  }
  entry.ts.push(now);
  next();
};

export const pinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: num(process.env.RATE_LIMIT_PIN, 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: dynamicHandler("Trop de tentatives PIN."),
});

export const fundsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: num(process.env.RATE_LIMIT_FUNDS, 15),
  standardHeaders: true,
  legacyHeaders: false,
  handler: dynamicHandler("Trop de mouvements de fonds."),
});

export const apiKeyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: num(process.env.RATE_LIMIT_APIKEY, 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: dynamicHandler("Trop de créations de clés API."),
});

export const obpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: num(process.env.RATE_LIMIT_OBP, 60),
  standardHeaders: true,
  legacyHeaders: false,
  handler: dynamicHandler("Trop de requêtes OBP."),
});
