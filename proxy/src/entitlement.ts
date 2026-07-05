import type { Env } from './index.js';

/**
 * §A-5 — is this user paid + under cap? Reads the `get_entitlement(user_id)` RPC (the billing SSOT)
 * as SERVICE ROLE (only it may read another user's row + escape the RPC's IDOR guard), and caches the
 * answer in-memory per isolate for ~60s. Cached (not baked into the JWT) so a cancel/downgrade/over-cap
 * takes effect within the TTL, not after the token's 1-hour life. STRICT FAIL-CLOSED: a lookup failure
 * throws — we never serve stale on error and never let a call through un-verified (never un-metered).
 */

/** ~60s freshness: short enough that a canceled/over-cap user loses access within the window. */
export const ENTITLEMENT_TTL_MS = 60_000;

/** The RPC's return row (exactly one row). `entitled = spent < allowance AND [ active within
 *  current_period_end+48h (engineering grace) OR trialing within current_period_end ]`; past_due + every
 *  other status is NOT entitled (fail-fast). `status` is the REAL row status even when blocked, so the
 *  gate can route the paywall (past_due vs over_cap vs no_plan vs a 0-allowance misconfig). */
export interface Entitlement {
  entitled: boolean;
  plan: string | null;
  priceId: string | null;
  allowanceCents: number;
  spentCents: number;
  /** The subscription's current billing-cycle start — the key each usage write is stamped with. */
  periodStart: string | null;
  periodEnd: string | null;
  status: string | null;
}

interface CacheEntry {
  value: Entitlement;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

/** Test seam: drop the cache between cases. */
export function _resetEntitlementCache(): void {
  cache.clear();
}

/** Map the snake_case RPC row → our shape. `spent_cents` etc. arrive as numeric strings over PostgREST. */
function toEntitlement(row: Record<string, unknown>): Entitlement {
  const numOr0 = (v: unknown): number => (v == null ? 0 : Number(v));
  return {
    entitled: row.entitled === true,
    plan: (row.plan as string | null) ?? null,
    priceId: (row.price_id as string | null) ?? null,
    allowanceCents: numOr0(row.allowance_cents),
    spentCents: numOr0(row.spent_cents),
    periodStart: (row.period_start as string | null) ?? null,
    periodEnd: (row.period_end as string | null) ?? null,
    status: (row.status as string | null) ?? null,
  };
}

/**
 * Fresh-or-cached entitlement for a user. Throws (→ the caller returns 503, fail-closed) when the
 * Worker is misconfigured or the RPC is unreachable/errors.
 */
export async function getEntitlement(userId: string, env: Env): Promise<Entitlement> {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('proxy misconfigured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unset');
  }

  const res = await fetch(new URL('/rest/v1/rpc/get_entitlement', env.SUPABASE_URL), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ p_user_id: userId }),
  });
  if (!res.ok) {
    throw new Error(`get_entitlement failed: ${res.status}`);
  }
  // A `returns table(...)` RPC comes back as a JSON array with exactly one row. An empty/malformed body
  // is a lookup failure — throw (→ the caller returns 503, fail-closed) rather than silently coercing to
  // a not-entitled 'no_plan', which would show a paying user the wrong paywall screen.
  const rows = (await res.json().catch(() => null)) as Array<Record<string, unknown>> | null;
  if (!rows || rows.length === 0 || typeof rows[0] !== 'object' || rows[0] === null) {
    throw new Error('get_entitlement returned an empty or malformed body');
  }
  const value = toEntitlement(rows[0]);
  cache.set(userId, { value, expiresAt: Date.now() + ENTITLEMENT_TTL_MS });
  return value;
}
