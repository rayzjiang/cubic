import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Env } from './index.js';

/**
 * §A-4 — verify the caller's Supabase JWT, statelessly, on every request.
 *
 * Supabase signs access tokens with an ASYMMETRIC key (enable "JWT signing keys" in the dashboard);
 * the Worker holds only the PUBLIC JWKS (fetched from the project, cached inside jose with a cooldown
 * and auto-refetch on an unknown `kid`, so key rotation is handled). We can therefore verify the
 * signature at the edge with no round-trip and no minting secret — a compromised Worker cannot forge
 * a token. We PIN to asymmetric algorithms so a token that claims `alg: HS256`/`none` (which the public
 * key or no key could "verify") is rejected, and we check `iss`/`aud`/`exp`.
 */

const ISSUER_PATH = '/auth/v1';
const JWKS_PATH = '/auth/v1/.well-known/jwks.json';
const AUDIENCE = 'authenticated';
// Asymmetric only — never HS256 (symmetric, forgeable with the public key) or `none`.
const ALGORITHMS = ['ES256', 'RS256', 'EdDSA'];

export interface Caller {
  /** Supabase user id (the JWT `sub`) — the key for entitlement + metering. */
  userId: string;
}

/**
 * The verification core, decoupled from Env so tests exercise it with a locally-minted keypair
 * (`createLocalJWKSet`) — real ES256 sign+verify, zero network. Rejects a bad signature, a wrong
 * issuer/audience, or an expired token by throwing.
 */
export async function verifyJwtWithKeySet(
  token: string,
  keySet: JWTVerifyGetKey,
  issuer: string,
): Promise<Caller> {
  const { payload } = await jwtVerify(token, keySet, {
    issuer,
    audience: AUDIENCE,
    algorithms: ALGORITHMS,
  });
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('jwt: missing sub');
  }
  return { userId: payload.sub };
}

// The remote JWKS is lazily built on first verify and cached across requests in the same isolate.
// Rebuilt if SUPABASE_URL/SUPABASE_JWKS_URL changes (only in tests / re-config).
let remoteJwks: JWTVerifyGetKey | undefined;
let remoteJwksFor: string | undefined;

/** Verify a raw Bearer token against the project's live JWKS. Throws on any failure (caller → 401). */
export async function verifyJwt(token: string, env: Env): Promise<Caller> {
  if (!env.SUPABASE_URL) throw new Error('proxy misconfigured: SUPABASE_URL unset');
  const jwksUrl = env.SUPABASE_JWKS_URL ?? new URL(JWKS_PATH, env.SUPABASE_URL).toString();
  if (!remoteJwks || remoteJwksFor !== jwksUrl) {
    remoteJwks = createRemoteJWKSet(new URL(jwksUrl));
    remoteJwksFor = jwksUrl;
  }
  const issuer = new URL(ISSUER_PATH, env.SUPABASE_URL).toString();
  return verifyJwtWithKeySet(token, remoteJwks, issuer);
}

/** Pull the raw token out of an `Authorization: Bearer <jwt>` header. Empty string when absent. */
export function bearerToken(header: string | null): string {
  return (header ?? '').replace(/^Bearer\s+/i, '').trim();
}
