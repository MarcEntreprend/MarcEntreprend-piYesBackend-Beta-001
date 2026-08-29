// ============================================================
// server/src/routes/obpKeys.ts
// Phase 4 — Gestion des clés API des tiers (dashboard).
// Routes réservées aux administrateurs authentifiés par JWT.
//
//   POST   /obp/v3.1.0/keys        → créer une clé (la clé brute est renvoyée
//                                     une seule fois)
//   GET    /obp/v3.1.0/keys        → lister les clés (jamais les hashes)
//   DELETE /obp/v3.1.0/keys/:id    → révoquer une clé
// ============================================================

import express from "express";
import { authMiddleware, AuthRequest } from "../middleware.js";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "../services/apiKeyService.js";

const router = express.Router();

// Toutes les routes nécessitent une authentification JWT
router.use(authMiddleware);

// ============================================================
// POST /obp/v3.1.0/keys
// Créer une clé API (la clé brute n'est affichée qu'une fois)
// ============================================================
router.post("/", async (req: AuthRequest, res) => {
  try {
    const { name } = req.body || {};
    const ownerUserId = (req.user as any)?.id;

    if (!ownerUserId) {
      return res.status(401).json({
        error: {
          message: "User not authenticated",
          code: "UNAUTHORIZED",
        },
      });
    }

    const result = await createApiKey(ownerUserId, name || "Clé API");

    if (!result) {
      return res.status(500).json({
        error: {
          message: "Failed to create API key",
          code: "API_KEY_CREATE_FAILED",
        },
      });
    }

    res.status(201).json({
      id: result.record.id,
      name: result.record.name,
      apiKey: result.apiKey,
      status: result.record.status,
      createdAt: result.record.createdAt,
      note: "⚠️ Conservez cette clé : elle ne sera plus affichée.",
    });
  } catch (error: any) {
    console.error("[API Keys] Create error:", error);

    if (error.message?.includes("duplicate")) {
      return res.status(409).json({
        error: {
          message: "API key with this name already exists",
          code: "API_KEY_DUPLICATE",
        },
      });
    }

    res.status(500).json({
      error: {
        message: "Failed to create API key",
        code: "API_KEY_CREATE_FAILED",
      },
    });
  }
});

// ============================================================
// GET /obp/v3.1.0/keys
// Lister les clés API (jamais les hashes)
// ============================================================
router.get("/", async (req: AuthRequest, res) => {
  try {
    const ownerUserId = (req.user as any)?.id;

    if (!ownerUserId) {
      return res.status(401).json({
        error: {
          message: "User not authenticated",
          code: "UNAUTHORIZED",
        },
      });
    }

    const keys = await listApiKeys(ownerUserId);

    res.json({
      keys: keys.map((key) => ({
        id: key.id,
        name: key.name,
        status: key.status,
        lastUsedAt: key.lastUsedAt || null,
        createdAt: key.createdAt,
      })),
      count: keys.length,
    });
  } catch (error: any) {
    console.error("[API Keys] List error:", error);

    res.status(500).json({
      error: {
        message: "Failed to list API keys",
        code: "API_KEY_LIST_FAILED",
      },
    });
  }
});

// ============================================================
// DELETE /obp/v3.1.0/keys/:id
// Révoquer une clé API (soft delete)
// La sécurité est assurée par RLS sur la table (ownerUserId)
// ============================================================
router.delete("/:id", async (req: AuthRequest, res) => {
  try {
    // 🔧 Force la conversion en string pour éviter 'string | string[]'
    const keyId = String(req.params.id);
    const ownerUserId = (req.user as any)?.id || null;

    if (!keyId) {
      return res.status(400).json({
        error: {
          message: "Invalid key ID",
          code: "INVALID_KEY_ID",
        },
      });
    }

    const success = await revokeApiKey(keyId, ownerUserId);

    if (!success) {
      return res.status(404).json({
        error: {
          message: "API key not found or you are not authorized",
          code: "API_KEY_NOT_FOUND",
        },
      });
    }

    res.json({
      success: true,
      id: keyId,
      status: "revoked",
      revokedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[API Keys] Revoke error:", error);

    res.status(500).json({
      error: {
        message: "Failed to revoke API key",
        code: "API_KEY_REVOKE_FAILED",
      },
    });
  }
});

export default router;
