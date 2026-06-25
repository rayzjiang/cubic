// Service-role Supabase client — BYPASSES RLS and is the ONLY writer of the
// billing tables (the security boundary). Never expose this key to the client.
import { createClient } from 'jsr:@supabase/supabase-js@2';

export const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);
