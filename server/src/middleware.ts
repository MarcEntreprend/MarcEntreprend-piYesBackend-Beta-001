// server/src/middleware.ts

// TODO :
// authMiddleware fait une requête SQL par requête protégée. C'est le prix de la révocation immédiate.
// Pour une montée en charge, il faudra ajouter un cache (Redis)
// mais pour une démo, c'est acceptable.

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
    }) as { id: string; email: string };

    // Vérifier que la session existe encore en base et est active
    const { data: session, error } = await supabaseService
      .from("Session")
      .select("id, isVerified, expiresAt")
      .eq("userId", decoded.id)
      .eq("isVerified", true)
      .gt("expiresAt", new Date().toISOString())
      .limit(1)
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
