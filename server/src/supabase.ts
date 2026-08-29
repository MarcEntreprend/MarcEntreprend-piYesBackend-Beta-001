// server\src\supabase.ts

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "!!! [SUPABASE] Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment variables!",
  );
}

if (!supabaseServiceKey) {
  console.warn(
    "⚠️ [SUPABASE] SUPABASE_SERVICE_ROLE_KEY not set. Some admin operations may fail.",
  );
}

// Client principal du backend (service_role).
// RLS est désormais activée sur les tables métier (rls-business-tables.sql)
// avec des politiques service_role uniquement : la clé anon n'a plus accès
// aux données. Le backend, qui applique ses propres contrôles d'autorisation
// (authMiddleware + filtres userId), utilise donc la clé service_role.
// La clé anon ne doit jamais être utilisée côté serveur pour les tables métier.
export const supabase = createClient(
  supabaseUrl!,
  supabaseServiceKey || supabaseAnonKey!,
);

// Client SERVICE ROLE (contourne RLS – alias du client principal)
export const supabaseService = supabaseServiceKey
  ? createClient(supabaseUrl!, supabaseServiceKey)
  : supabase;

console.log(">>> [SUPABASE] Client initialized for URL:", supabaseUrl);
