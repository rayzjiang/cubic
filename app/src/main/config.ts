import { bundledPanelBuildId } from './installBridge.js'
import { readCachedConfig, CONFIG_ENV_VARS, type ConfigRejection } from './remoteConfig.js'

// §0 + §B7 + §??? — the backend environment config (NOT the port).
//
// The backend OS-assigns its own WS port (`bind 127.0.0.1:0`) and mints the per-launch session token,
// then reports {port, token} back UP to main via the child IPC channel (see backend.ts / startBackend.ts).
// Main relays those to the renderer through getBackendPort(); the CEP worker + loopback client discover
// them from ~/.cubic/conn.json. So the port is no longer a config value main decides — this file only
// carries the deployment env + Supabase settings forwarded to the child.

// §E packaging — baked config constants. On a prod packaging build (CUBIC_BUILD=prod) the
// electron-vite main `define` (electron.vite.config.ts) textually replaces these identifiers with
// the frozen PUBLIC values from app/.env.production. In dev they're never defined, so the
// `typeof … !== 'undefined'` guards below fall through to process.env — `typeof` on an undeclared
// name is legal and yields "undefined" (a bare reference would ReferenceError, hence the guard,
// and the short-circuit never evaluates the bare identifier in dev). All baked values are public
// by design (anon key, write-only PostHog ingest key, proxy URL); real secrets live only in the Worker.
declare const __CUBIC_SUPABASE_URL__: string
declare const __CUBIC_SUPABASE_ANON_KEY__: string
declare const __CUBIC_POSTHOG_KEY__: string
declare const __CUBIC_PROXY_URL__: string
declare const __CUBIC_CONFIG_ENV__: string

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
  /** §B-5 — where Supabase returns the BROWSER after OAuth: the hosted success page at
   *  `usecubic.com/auth/callback`, which fires the `cubic://auth/callback?code=…` deep link back into
   *  the app. Must match an entry in the Supabase dashboard's redirect allow-list, or sign-in is
   *  rejected before it reaches Google. Not baked: it's a frozen public constant, and the
   *  `CUBIC_AUTH_REDIRECT` override is dev-only BY CONSTRUCTION — a packaged build has no shell env
   *  (see the note above), so prod can only ever get the default. */
  authRedirect: string
  /** §H — PostHog product analytics, fired from main (the AnalyticsManager). The project key is a
   *  PUBLIC, write-only ingest key (safe to bake, like `supabaseAnonKey`). `analyticsEnabled` is the
   *  kill switch: on only when a key is set AND `CUBIC_ANALYTICS !== 'off'` — so dev is OFF by default
   *  (leave POSTHOG_KEY unset; set it for a deliberate verify session), prod bakes the key → on. */
  posthogKey: string
  posthogHost: string
  analyticsEnabled: boolean
  /** §G-? — the hosted proxy's base URL (baked). Also the host of `GET /config`, the Worker-override
   *  channel refreshed in the background at launch (see remoteConfig.ts). '' when unconfigured. */
  proxyUrl: string
  /** §G-? — cached override values this launch had to ignore (out of range / wrong type). Surfaced by
   *  index.ts once the AnalyticsManager exists, since loadConfig() runs before it is constructed. */
  configRejections: ConfigRejection[]
}

export function loadConfig(): BackendConfig {
  // Packaged builds bake CUBIC_ENV='prod' (empty process.env can't carry it); dev reads the shell.
  const bakedEnv = typeof __CUBIC_CONFIG_ENV__ !== 'undefined' ? __CUBIC_CONFIG_ENV__ : process.env.CUBIC_ENV
  const cubicEnv: CubicEnv = bakedEnv === 'prod' ? 'prod' : 'local'

  // The child always learns the env; in prod it also learns where to route Claude calls.
  const childEnv: Record<string, string> = { CUBIC_ENV: cubicEnv }
  // §F-4 — tell the backend which panel build this app version ships, so it can flag a stale RUNNING
  // panel (a connected panel whose hello buildId ≠ this) → the renderer nudges "Restart After Effects".
  // Null (missing sidecar) → unset → staleness never triggers (fail-safe).
  const panelBuildId = bundledPanelBuildId()
  if (panelBuildId) childEnv.CUBIC_PANEL_BUILD_ID = panelBuildId
  // Route the agent loop through the hosted proxy: forward a base URL the Anthropic SDK honors
  // (ANTHROPIC_BASE_URL). Baked into the packaged build from app/.env.production; dev sets it via
  // the shell. If empty, the child throws at LLM construction (anthropic.ts) — prod needs a real URL.
  const proxyUrl = (typeof __CUBIC_PROXY_URL__ !== 'undefined' ? __CUBIC_PROXY_URL__ : process.env.CUBIC_PROXY_URL) ?? ''
  const configRejections: ConfigRejection[] = []
  if (cubicEnv === 'prod') {
    if (proxyUrl) {
      childEnv.ANTHROPIC_BASE_URL = proxyUrl
    } else {
      console.warn('[config] CUBIC_ENV=prod but CUBIC_PROXY_URL is unset — chat will fail until a proxy URL is baked/set.')
    }
    // §G-? Worker-override: apply the cached /config values (fetched in the background on a previous
    // launch — see remoteConfig.ts). Reading the cache is sync + local, so nothing here touches the
    // network or delays the spawn below. An absent/invalid key is simply not forwarded, leaving the
    // child on its baked in-code default — a failed fetch can never brick a launch.
    const { config: remote, rejected } = readCachedConfig()
    configRejections.push(...rejected)
    for (const [key, envVar] of Object.entries(CONFIG_ENV_VARS)) {
      const value = remote[key as keyof typeof remote]
      if (value === undefined) continue
      // An explicitly-set local env var WINS over the Worker. Preserves the convention the backend
      // already documents ("a shell-exported CUBIC_MODEL still wins") and keeps full-stack-local testing
      // honest: `CUBIC_MODEL=haiku` must stay Haiku instead of being silently swapped for the Worker's
      // pricier model mid-test. In real prod process.env is empty, so this never fires.
      const local = process.env[envVar]
      if (local !== undefined && local.trim() !== '') continue
      childEnv[envVar] = String(value)
    }
  }
  // 'local': forward nothing extra — the agent loop calls Anthropic directly with the
  // ANTHROPIC_API_KEY inherited from this process's environment.

  // Supabase (§B auth). Dev reads from the shell env (or server/.env, inherited by this process);
  // prod bakes the real values at build time (the anon key is public). Both default to '' so an
  // unconfigured dev machine still launches — the AuthManager treats '' as "auth unavailable".
  const supabaseUrl = typeof __CUBIC_SUPABASE_URL__ !== 'undefined' ? __CUBIC_SUPABASE_URL__ : (process.env.SUPABASE_URL ?? '')
  const supabaseAnonKey = typeof __CUBIC_SUPABASE_ANON_KEY__ !== 'undefined' ? __CUBIC_SUPABASE_ANON_KEY__ : (process.env.SUPABASE_ANON_KEY ?? '')

  // §B-5 OAuth return URL. The default is the shipped value — the hosted success page on the marketing
  // site, whose only job is to fire the cubic:// deep link so the browser tab doesn't dead-end on a raw
  // supabase.co URL. `CUBIC_AUTH_REDIRECT` exists so dev can point at a locally-served copy
  // (`npx serve out` on :3000) without editing source; a packaged build's process.env is empty, so the
  // override cannot ship. Whatever this resolves to must be in Supabase's redirect allow-list.
  const authRedirect = process.env.CUBIC_AUTH_REDIRECT?.trim() || 'https://usecubic.com/auth/callback'

  // §H analytics. Dev leaves POSTHOG_KEY unset by default (off → zero dev pollution) and sets it only
  // for a verify session; prod bakes the key at build. `CUBIC_ANALYTICS=off` hard-mutes even a keyed
  // build. Fired from MAIN only — NOT forwarded to the child (the child relays events up over IPC).
  const posthogKey = typeof __CUBIC_POSTHOG_KEY__ !== 'undefined' ? __CUBIC_POSTHOG_KEY__ : (process.env.POSTHOG_KEY ?? '')
  const posthogHost = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com'
  const analyticsEnabled = !!posthogKey && process.env.CUBIC_ANALYTICS !== 'off'

  return { cubicEnv, childEnv, supabaseUrl, supabaseAnonKey, authRedirect, posthogKey, posthogHost, analyticsEnabled, proxyUrl, configRejections }
}
