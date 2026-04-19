// Backend server\src\supabase.ts

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "!!! [SUPABASE] Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment variables!",
  );
}

export const supabase = createClient(supabaseUrl!, supabaseKey!);

console.log(">>> [SUPABASE] Client initialized for URL:", supabaseUrl);
