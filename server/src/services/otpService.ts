// server/src/services/otpService.ts
//
// Phase 6 — OTP persistant en base (table otp_challenge).
//
// - Le code est généré côté serveur, seul son hash SHA-256 est stocké.
// - La vérification se fait par l'id du challenge (retourné à l'appelant),
//   jamais en cherchant par le code → pas d'énumération possible.
// - Chaque challenge est consommé une seule fois (consumed_at) et expire.
// - Le service de livraison (email/SMS) est découplé (otpDeliveryService).

import crypto from "crypto";
import { supabaseService } from "../supabase.js";

export const OTP_TTL_MS = 15 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export type OtpPurpose =
  | "generic"
  | "login_mfa"
  | "password_reset"
  | "change_contact"
  | "signup"
  | "key_creation";

interface OtpChallengeRow {
  id: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  consumed_at: string | null;
  metadata?: any;
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function generateCode(): string {
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
}

// Crée un challenge OTP persistant pour une cible (email/téléphone).
// Retourne { id, code } : le code n'est renvoyé qu'au service de livraison,
// l'appelant final ne reçoit que l'id du challenge.
export async function createOtpChallenge(
  target: string,
  purpose: OtpPurpose = "generic",
  metadata?: any,
): Promise<{ id: string; code: string } | null> {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  const { data, error } = await supabaseService
    .from("otp_challenge")
    .insert({
      target,
      purpose,
      code_hash: sha256(code),
      metadata: metadata || null,
      attempts: 0,
      max_attempts: OTP_MAX_ATTEMPTS,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[OTP] insert error:", error);
    return null;
  }

  // Nettoyage des vieux challenges non consommés pour la même cible/purpose
  cleanupExpired(target, purpose);

  return { id: data.id, code };
}

// Vérifie un code pour un challenge donné. Consomme le challenge en cas de
// succès (une seule utilisation). Incrémente les tentatives en cas d'échec.
export async function verifyOtpChallenge(
  challengeId: string,
  code: string,
  consume: boolean = true,
): Promise<boolean> {
  if (!challengeId || !code) return false;

  const { data, error } = await supabaseService
    .from("otp_challenge")
    .select("id, code_hash, attempts, max_attempts, expires_at, consumed_at")
    .eq("id", challengeId)
    .maybeSingle();

  if (error || !data) return false;

  const row = data as unknown as OtpChallengeRow;

  if (row.consumed_at) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  if (row.attempts >= row.max_attempts) return false;

  const isValid = crypto.timingSafeEqual(
    Buffer.from(sha256(code), "hex"),
    Buffer.from(row.code_hash, "hex"),
  );

  if (!isValid) {
    await supabaseService
      .from("otp_challenge")
      .update({ attempts: row.attempts + 1 })
      .eq("id", row.id);
    return false;
  }

  if (consume) {
    await supabaseService
      .from("otp_challenge")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", row.id);
  }
  return true;
}

// Nettoie les challenges expirés pour une cible/purpose (évite l'accumulation).
async function cleanupExpired(target: string, purpose: string) {
  try {
    await supabaseService
      .from("otp_challenge")
      .delete()
      .eq("target", target)
      .eq("purpose", purpose)
      .or(`consumed_at.not.is.null,expires_at.lt.${new Date().toISOString()}`);
  } catch (e) {
    /* non bloquant */
  }
}

// Indique s'il existe déjà un challenge actif (non consommé, non expiré)
// pour une cible/purpose → évite les envois multiples.
export async function hasActiveChallenge(
  target: string,
  purpose: OtpPurpose = "generic",
): Promise<boolean> {
  const { data, error } = await supabaseService
    .from("otp_challenge")
    .select("id")
    .eq("target", target)
    .eq("purpose", purpose)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();

  return !error && !!data;
}

// Récupère les métadonnées associées à un challenge (ex: création de clé).
export async function getOtpChallengeMetadata(
  challengeId: string,
): Promise<any | null> {
  const { data, error } = await supabaseService
    .from("otp_challenge")
    .select("metadata")
    .eq("id", challengeId)
    .maybeSingle();

  if (error || !data) return null;
  return (data as unknown as OtpChallengeRow).metadata || null;
}
