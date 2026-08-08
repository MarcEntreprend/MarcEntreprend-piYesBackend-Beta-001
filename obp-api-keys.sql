-- obp-api-keys.sql
-- ================
-- Phase 4 — Gestion des clés API pour les tiers (Open Banking / OBP)
-- À exécuter dans le SQL Editor Supabase (idempotent).
--
-- Seul le hash SHA-256 de la clé est stocké : une clé brute n'est affichée
-- qu'une seule fois, à sa création (POST /obp/v3.1.0/keys).

-- ---------------------------------------------------------------------------
-- Table des clés API tierces
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS piyes_api_key (
  id            uuid PRIMARY KEY,
  "ownerUserId" text,                                -- propriétaire (admin) ou NULL
  name          text NOT NULL DEFAULT 'Clé tier',
  "apiKeyHash"  text NOT NULL,                       -- SHA-256 de la clé brute
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','revoked')),
  "lastUsedAt"  timestamp without time zone,
  "revokedAt"   timestamp without time zone,
  "createdAt"   timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Recherche rapide par hash (lookup d'authentification)
CREATE INDEX IF NOT EXISTS idx_api_key_hash
  ON piyes_api_key ("apiKeyHash");

-- Liste par propriétaire (dashboard admin)
CREATE INDEX IF NOT EXISTS idx_api_key_owner
  ON piyes_api_key ("ownerUserId") WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------------
-- SELECT id, name, status, "lastUsedAt" FROM piyes_api_key ORDER BY "createdAt" DESC;
