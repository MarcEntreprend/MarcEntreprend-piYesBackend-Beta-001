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

// Client ANON (utilisé pour les routes publiques / authentifiées)
export const supabase = createClient(supabaseUrl!, supabaseAnonKey!);

// Client SERVICE ROLE (contourne RLS – à utiliser pour les opérations sensibles internes)
export const supabaseService = supabaseServiceKey
  ? createClient(supabaseUrl!, supabaseServiceKey)
  : supabase;

console.log(">>> [SUPABASE] Client initialized for URL:", supabaseUrl);
