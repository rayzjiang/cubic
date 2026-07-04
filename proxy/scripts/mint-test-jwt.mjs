// DEV ONLY, offline — mint Supabase-shaped ES256 tokens + serve a matching JWKS so the local Worker
// (`wrangler dev`) can verify them without a real Supabase. Lets you curl the WT-PROXY-GATING gate.
//
// Run:  node scripts/mint-test-jwt.mjs           (keep it running — it hosts the JWKS)
// Then follow the printed `wrangler dev` command + curl lines.
//
// The token `sub` must be a REAL user id in your local Supabase for a 200 (entitlement is still checked
// against get_entitlement); any other sub with no subscription row → 402. Override via PAID_USER_ID /
// UNPAID_USER_ID env vars.

import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const PORT = Number(process.env.JWKS_PORT ?? 8799);
const ISSUER = process.env.MINT_ISSUER ?? 'http://127.0.0.1:54321/auth/v1';
const AUDIENCE = 'authenticated';
const KID = 'cubic-dev-key';

const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwk = await exportJWK(publicKey);
jwk.kid = KID;
jwk.alg = 'ES256';
jwk.use = 'sig';
const jwks = { keys: [jwk] };

const mint = (sub) =>
  new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: KID })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(privateKey);

const paidSub = process.env.PAID_USER_ID ?? '00000000-0000-0000-0000-0000000000aa';
const unpaidSub = process.env.UNPAID_USER_ID ?? '00000000-0000-0000-0000-0000000000bb';
const tokenPaid = await mint(paidSub);
const tokenUnpaid = await mint(unpaidSub);

createServer((req, res) => {
  if (req.url?.includes('jwks')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(jwks));
  } else {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  const jwksUrl = `http://127.0.0.1:${PORT}/.well-known/jwks.json`;
  const origin = new URL(ISSUER).origin;
  console.log(`
mint-test-jwt — local JWKS + signed tokens (DEV ONLY, offline)

  JWKS:   ${jwksUrl}
  Issuer: ${ISSUER}

1) Start the proxy pointed at this JWKS (KEEP THIS PROCESS RUNNING), in another terminal:

  npx wrangler dev \\
    --var SUPABASE_URL:${origin} \\
    --var SUPABASE_JWKS_URL:${jwksUrl} \\
    --var MOCK_UPSTREAM:1

2) Export tokens + curl the gate:

  export TOKEN_PAID='${tokenPaid}'
  export TOKEN_UNPAID='${tokenUnpaid}'
  BODY='{"model":"claude-sonnet-4-6","messages":[]}'

  curl -si localhost:8787/v1/messages -H "content-type: application/json" -d "$BODY"                                   # 401 (no token)
  curl -si localhost:8787/v1/messages -H "authorization: Bearer bad" -H "content-type: application/json" -d "$BODY"    # 401 (bad token)
  curl -si localhost:8787/v1/messages -H "authorization: Bearer $TOKEN_PAID" -H "content-type: application/json" -d "$BODY"    # 200 if sub ${paidSub} is entitled in local Supabase, else 402

(paid sub=${paidSub}, unpaid sub=${unpaidSub} — override with PAID_USER_ID / UNPAID_USER_ID. Ctrl-C to stop.)
`);
});
