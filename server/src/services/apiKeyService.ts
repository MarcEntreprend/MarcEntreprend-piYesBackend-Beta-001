// Phase 4 — Gestion des clés API pour les tiers (Open Banking / OBP).
//
// Une clé est un jeton opaque généré côté serveur. Seul son hash SHA-256 est
// stocké en base (table piyes_api_key, créée par obp-api-keys.sql) : un vol
// de la table ne permet pas de réutiliser les clés.
//
// Utilisation par un tiers :
//   Authorization: Bearer <api_key>
//   ou
//   X-API-Key: <api_key>

import crypto from "crypto";
import { supabase, supabaseService } from "../supabase.js";

export interface ApiKeyRecord {
  id: string;
  name: string;
  status: "active" | "revoked";
  createdAt: string;
  lastUsedAt?: string | null;
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

// Génère une clé opaque (32 octets aléatoires, encodage URL-safe).
function generateApiKey(): string {
  return `piyes_${crypto.randomBytes(32).toString("base64url")}`;
}

// Crée une clé pour un tiers. Le hash est persisté ; la clé brute n'est
// renvoyée qu'une seule fois (à la création).
export async function createApiKey(
  ownerUserId: string | null,
  name: string,
): Promise<{ apiKey: string; record: ApiKeyRecord } | null> {
  const apiKey = generateApiKey();
  const id = crypto.randomUUID();

  // Utiliser supabaseService pour contourner RLS
  const { error } = await supabaseService.from("piyes_api_key").insert({
    id,
    ownerUserId,
    name: name || "Clé tier",
    apiKeyHash: sha256(apiKey),
    status: "active",
    createdAt: new Date().toISOString(),
  });
  if (error) {
    console.error("[APIKEY] insert error:", error);
    return null;
  }

  return {
    apiKey,
    record: { id, name, status: "active", createdAt: new Date().toISOString() },
  };
}

// Révocation d'une clé. Le propriétaire doit être fourni pour éviter qu'un
// utilisateur ne révoque une clé qui ne lui appartient pas (IDOR).
export async function revokeApiKey(
  id: string,
  ownerUserId: string | null,
): Promise<boolean> {
  //  Utiliser supabaseService pour contourner RLS
  let query = supabaseService
    .from("piyes_api_key")
    .update({ status: "revoked", revokedAt: new Date().toISOString() })
    .eq("id", id);
  if (ownerUserId) query = query.eq("ownerUserId", ownerUserId);
  const { error, count } = await query.select("id");
  return !error && (count ?? 1) > 0;
}

// Liste des clés (hors hash) d'un propriétaire, ou toutes si ownerUserId null.
export async function listApiKeys(
  ownerUserId: string | null,
): Promise<ApiKeyRecord[]> {
  //  Utiliser supabaseService pour contourner RLS
  // (on filtre par ownerUserId en code)
  let query = supabaseService
    .from("piyes_api_key")
    .select("id, name, status, createdAt, lastUsedAt")
    .order("createdAt", { ascending: false });
  if (ownerUserId) query = query.eq("ownerUserId", ownerUserId);

  const { data } = await query;
  return (data || []) as ApiKeyRecord[];
}

// Valide une clé API : active + met à jour lastUsedAt. Retourne l'id.
export async function validateApiKey(
  apiKey: string,
): Promise<{ id: string; ownerUserId: string | null } | null> {
  const hash = sha256(apiKey);
  //  Utiliser supabaseService pour contourner RLS
  const { data, error } = await supabaseService
    .from("piyes_api_key")
    .select("id, status, ownerUserId")
    .eq("apiKeyHash", hash)
    .maybeSingle();

  if (error || !data) return null;
  if (data.status !== "active") return null;

  // Mise à jour asynchrone, sans bloquer la requête.
  supabaseService
    .from("piyes_api_key")
    .update({ lastUsedAt: new Date().toISOString() })
    .eq("id", data.id)
    .then();
  return { id: data.id, ownerUserId: data.ownerUserId };
}

// Middleware Express : protège une route par clé API (Bearer ou X-API-Key).
export function apiKeyAuth(req: any, res: any, next: any) {
  const header =
    req.headers["x-api-key"] ||
    (req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null);

  if (!header || typeof header !== "string") {
    return res.status(401).json({
      message: "Missing API key (X-API-Key or Bearer)",
    });
  }

  validateApiKey(header)
    .then((keyInfo) => {
      if (!keyInfo) {
        return res.status(401).json({ message: "Invalid or revoked API key" });
      }
      (req as any).apiKeyId = keyInfo.id;
      (req as any).apiKeyOwnerUserId = keyInfo.ownerUserId;
      next();
    })
    .catch(() => res.status(500).json({ message: "API key check failed" }));
}
