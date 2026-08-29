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

export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: num(process.env.RATE_LIMIT_GLOBAL, 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      message: "Trop de requêtes. Réessayez dans une minute.",
      code: "TOO_MANY_REQUESTS",
    },
  },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: num(process.env.RATE_LIMIT_AUTH, 10),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: {
      message: "Trop de tentatives. Réessayez dans 15 minutes.",
      code: "TOO_MANY_REQUESTS",
    },
  },
});

export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: num(process.env.RATE_LIMIT_OTP, 5),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      message: "Trop de demandes de code. Réessayez dans 15 minutes.",
      code: "TOO_MANY_REQUESTS",
    },
  },
});

export const pinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: num(process.env.RATE_LIMIT_PIN, 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      message: "Trop de tentatives PIN. Réessayez dans une minute.",
      code: "TOO_MANY_REQUESTS",
    },
  },
});

export const fundsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: num(process.env.RATE_LIMIT_FUNDS, 15),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      message: "Trop de mouvements de fonds. Réessayez dans une minute.",
      code: "TOO_MANY_REQUESTS",
    },
  },
});

export const apiKeyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: num(process.env.RATE_LIMIT_APIKEY, 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      message: "Trop de créations de clés API. Réessayez dans une heure.",
      code: "TOO_MANY_REQUESTS",
    },
  },
});

export const obpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: num(process.env.RATE_LIMIT_OBP, 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      message: "Trop de requêtes OBP. Réessayez dans une minute.",
      code: "TOO_MANY_REQUESTS",
    },
  },
});
