// server/src/services/lockoutService.ts
//
// Verrouillage par compte (in-memory) contre le brute-force login / PIN / OTP.
// Clé = identifiant du compte (email/phone) ou userId.
// Après FAILURE_THRESHOLD échecs, le compte est verrouillé pendant LOCKOUT_MS.

const FAILURE_THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const store = new Map<string, { count: number; lockedUntil: number }>();

export function lockoutKey(...parts: string[]): string {
  return parts.join(":");
}

export function checkLockout(key: string): {
  locked: boolean;
  retryAfterMs: number;
} {
  const entry = store.get(key);
  if (!entry) return { locked: false, retryAfterMs: 0 };
  const remaining = entry.lockedUntil - Date.now();
  if (remaining > 0) return { locked: true, retryAfterMs: remaining };
  return { locked: false, retryAfterMs: 0 };
}

export function recordFailure(key: string): void {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry) {
    store.set(key, { count: 1, lockedUntil: 0 });
    return;
  }
  // Si un verrouillage précédent a expiré, on repart de zéro.
  // lockedUntil === 0 signifie « jamais verrouillé » → pas de reset.
  if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
    entry.count = 0;
    entry.lockedUntil = 0;
  }
  entry.count += 1;
  if (entry.count >= FAILURE_THRESHOLD) {
    entry.lockedUntil = now + LOCKOUT_MS;
  }
}

export function recordSuccess(key: string): void {
  store.delete(key);
}
