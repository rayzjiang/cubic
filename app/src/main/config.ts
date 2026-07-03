// §0 + §B7 + §??? — the backend environment config (NOT the port).
//
// The backend OS-assigns its own WS port (`bind 127.0.0.1:0`) and mints the per-launch session token,
// then reports {port, token} back UP to main via the child IPC channel (see backend.ts / startBackend.ts).
// Main relays those to the renderer through getBackendPort(); the CEP worker + loopback client discover
// them from ~/.cubic/conn.json. So the port is no longer a config value main decides — this file only
// carries the deployment env + Supabase settings forwarded to the child.

export type CubicEnv = 'local' | 'prod'

export interface BackendConfig {
  /** Which Claude API endpoint the agent loop targets. */
  cubicEnv: CubicEnv
  /** Extra env vars forwarded into the spawned backend child. */
  childEnv: Record<string, string>
  /** Supabase project — read by the main-process AuthManager (§B). Empty when unconfigured (auth
   *  then degrades to signed-out, never throws; allowed in local dev). The anon key is PUBLIC by
   *  design (safe to ship), so it is baked into the prod build; dev reads both from the shell env. */
  supabaseUrl: string
  supabaseAnonKey: string
}

export function loadConfig(): BackendConfig {
  const cubicEnv: CubicEnv = process.env.CUBIC_ENV === 'prod' ? 'prod' : 'local'

  // The child always learns the env; in prod it also learns where to route Claude calls.
  const childEnv: Record<string, string> = { CUBIC_ENV: cubicEnv }
  if (cubicEnv === 'prod') {
    // §B7 STUB — the hosted proxy (Phase 5) doesn't exist yet. When it does, this forwards
    // a base URL the Anthropic SDK honors (ANTHROPIC_BASE_URL) so the agent loop routes
    // through the proxy instead of calling Anthropic directly. `prod` is wired but inert
    // until CUBIC_PROXY_URL is set.
    const proxyBase = process.env.CUBIC_PROXY_URL
    if (proxyBase) {
      childEnv.ANTHROPIC_BASE_URL = proxyBase
    } else {
      console.warn('[config] CUBIC_ENV=prod but CUBIC_PROXY_URL is unset — the proxy lands in Phase 5; falling through to direct Anthropic.')
    }
  }
  // 'local': forward nothing extra — the agent loop calls Anthropic directly with the
  // ANTHROPIC_API_KEY inherited from this process's environment.

  // Supabase (§B auth). Dev reads from the shell env (or server/.env, inherited by this process);
  // prod bakes the real values in at build time (the anon key is public). Both default to '' so an
  // unconfigured dev machine still launches — the AuthManager treats '' as "auth unavailable".
  const supabaseUrl = process.env.SUPABASE_URL ?? ''
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? ''

  return { cubicEnv, childEnv, supabaseUrl, supabaseAnonKey }
}
