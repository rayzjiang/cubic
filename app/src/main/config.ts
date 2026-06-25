// §0 + §B7 — the single source of truth for the backend port and environment.
//
// Main SPAWNS the backend, so it already knows the port; it passes the value to the
// child (as AE_BRIDGE_PORT) AND answers getBackendPort() with the same value. We never
// read ~/.cubic/port back — that file exists for the independently-launched CEP
// worker + loopback client, which must discover the port; main is upstream of the
// decision. (The bridge hard-binds this port with no fallback — see wsBridge.ts.)

export type CubicEnv = 'local' | 'prod'

export interface BackendConfig {
  /** WS port the backend binds + the renderer connects to. */
  port: number
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

// Mirrors server/ae-bridge/src/startBackend.ts so main and the child agree by construction.
const DEFAULT_PORT = 17923

export function loadConfig(): BackendConfig {
  // AE_BRIDGE_PORT override is for tests / avoiding a stale-instance collision; in normal
  // use this resolves to 17923. NaN-guard falls back to the default.
  const parsed = Number.parseInt(process.env.AE_BRIDGE_PORT ?? String(DEFAULT_PORT), 10)
  const port = Number.isNaN(parsed) ? DEFAULT_PORT : parsed

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

  return { port, cubicEnv, childEnv, supabaseUrl, supabaseAnonKey }
}
