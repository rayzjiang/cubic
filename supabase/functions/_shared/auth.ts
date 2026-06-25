// Verify the caller's Supabase JWT and return their user id + email. The renderer
// forwards the access token (from WT-AUTH's `window.cubic.getAccessToken()`) as a
// Bearer header; we verify it against GoTrue exactly as prod will. Throws a Response
// (401) on a missing/invalid token so callers can `return` it directly.
import { createClient } from 'jsr:@supabase/supabase-js@2';

export interface Caller {
  userId: string;
  email: string | null;
  jwt: string;
}

export async function requireUser(req: Request): Promise<Caller> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) throw new Response('Missing Authorization', { status: 401 });

  // An anon client scoped to the caller's token; getUser() validates it server-side.
  const scoped = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } },
  );
  const { data, error } = await scoped.auth.getUser();
  if (error || !data.user) throw new Response('Invalid token', { status: 401 });

  return { userId: data.user.id, email: data.user.email ?? null, jwt };
}
