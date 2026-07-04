import { describe, it, expect } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, type JWK, type KeyLike } from 'jose';
import { verifyJwtWithKeySet, bearerToken } from '../src/auth.js';

/**
 * §A-4 — real ES256 sign+verify with a locally-minted keypair (no network, no API spend). Proves the
 * verification core accepts a well-formed Supabase-shaped token and rejects the failure modes that would
 * otherwise be an auth bypass (bad signature, wrong issuer/audience, expired).
 */

const ISSUER = 'https://ref.supabase.co/auth/v1';
const AUD = 'authenticated';

async function keys(): Promise<{ privateKey: KeyLike; jwks: ReturnType<typeof createLocalJWKSet> }> {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = (await exportJWK(publicKey)) as JWK;
  jwk.kid = 'test-key';
  jwk.alg = 'ES256';
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

function token(privateKey: KeyLike, opts: { sub?: string; iss?: string; aud?: string; expSec?: number } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setSubject(opts.sub ?? 'user-123')
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt(now)
    .setExpirationTime(opts.expSec ?? now + 3600)
    .sign(privateKey);
}

describe('verifyJwtWithKeySet', () => {
  it('accepts a valid token and returns the sub as userId', async () => {
    const { privateKey, jwks } = await keys();
    const jwt = await token(privateKey, { sub: 'abc-123' });
    const caller = await verifyJwtWithKeySet(jwt, jwks, ISSUER);
    expect(caller.userId).toBe('abc-123');
  });

  it('rejects an expired token', async () => {
    const { privateKey, jwks } = await keys();
    const jwt = await token(privateKey, { expSec: Math.floor(Date.now() / 1000) - 60 });
    await expect(verifyJwtWithKeySet(jwt, jwks, ISSUER)).rejects.toThrow();
  });

  it('rejects a wrong issuer', async () => {
    const { privateKey, jwks } = await keys();
    const jwt = await token(privateKey, { iss: 'https://evil.example/auth/v1' });
    await expect(verifyJwtWithKeySet(jwt, jwks, ISSUER)).rejects.toThrow();
  });

  it('rejects a wrong audience', async () => {
    const { privateKey, jwks } = await keys();
    const jwt = await token(privateKey, { aud: 'anon' });
    await expect(verifyJwtWithKeySet(jwt, jwks, ISSUER)).rejects.toThrow();
  });

  it('rejects a signature from a key NOT in the JWKS', async () => {
    const { jwks } = await keys();
    const other = await generateKeyPair('ES256'); // different private key, same advertised kid
    const jwt = await token(other.privateKey, {});
    await expect(verifyJwtWithKeySet(jwt, jwks, ISSUER)).rejects.toThrow();
  });
});

describe('bearerToken', () => {
  it('extracts the token and tolerates absence', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken(null)).toBe('');
    expect(bearerToken('')).toBe('');
  });
});
