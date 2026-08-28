// server/src/middleware.ts

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { supabaseService } from "./supabase.js";

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
if (!ACCESS_SECRET) {
  throw new Error("JWT_ACCESS_SECRET is required (set it in .env)");
}

export const JWT_ISSUER = "piyes-api";
export const JWT_AUDIENCE = "piyes-app";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      error: { message: "Authentication required", code: "UNAUTHORIZED" },
    });
  }

  try {
    const decoded = jwt.verify(token, ACCESS_SECRET, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as { id: string; email: string; sid?: string };

    // Le token doit référencer une session précise (sid) : un access token
    // émis pour une session révoquée (logout-all, purge) est rejeté.
    if (!decoded.sid) {
      return res.status(401).json({
        error: { message: "Token sans session", code: "UNAUTHORIZED" },
      });
    }

    // Vérifier que cette session précise existe, est active et appartient au user
    const { data: session, error } = await supabaseService
      .from("Session")
      .select("id, isVerified, expiresAt")
      .eq("id", decoded.sid)
      .eq("userId", decoded.id)
      .eq("isVerified", true)
      .gt("expiresAt", new Date().toISOString())
      .maybeSingle();

    if (error || !session) {
      return res.status(401).json({
        error: {
          message: "Session révoquée ou expirée. Reconnectez-vous.",
          code: "UNAUTHORIZED",
        },
      });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      error: { message: "Invalid or expired token", code: "UNAUTHORIZED" },
    });
  }
};

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.error(`[ERROR] ${req.method} ${req.url}:`, err?.stack || err);
  const status = err?.status || 500;

  if (status >= 500) {
    // Ne pas exposer les détails internes en production
    const message =
      process.env.NODE_ENV === "production"
        ? "Erreur interne du serveur"
        : err?.message || "Internal Server Error";
    return res.status(status).json({
      error: { message, status, code: "INTERNAL_ERROR" },
    });
  }

  res.status(status).json({
    error: {
      message: err?.message || "Internal Server Error",
      status,
      code: err?.code || "INTERNAL_ERROR",
    },
  });
};
