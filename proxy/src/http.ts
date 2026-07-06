/**
 * `fetch` with a hard timeout (P5W2 audit, LOW) — bounds how long a hung upstream can stall a request.
 * Both Supabase RPC call sites (`get_entitlement`, `record_usage`) used a bare `fetch` with no signal,
 * so a stalled Supabase would hang the whole request. On timeout `AbortSignal.timeout` aborts the fetch
 * → the promise rejects with a `TimeoutError`, which callers already handle: the entitlement gate maps a
 * throw → 503 (fail-closed), metering logs + retries (best-effort). No new error handling needed.
 *
 * NOT for the Anthropic upstream forward — LLM generations are legitimately long; a short abort there
 * would kill valid responses.
 */

/** Default bound for the Supabase RPCs. get_entitlement blocks the user's request, so keep it short. */
export const RPC_TIMEOUT_MS = 5_000;

export function fetchWithTimeout(url: string | URL, init: RequestInit, ms: number): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}
