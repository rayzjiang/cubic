/**
 * WT-AUTO-UPDATE (§F-1) — serve the electron-updater feed from a PRIVATE R2 bucket.
 *
 * The Worker is the only public read path (the `RELEASES` bucket has no public access), so the update
 * artifacts stay off a public hostname — same host as the proxy, just a new path. electron-updater is a
 * raw HTTP client (it holds no Supabase JWT), so `GET /releases/*` is deliberately UNAUTHENTICATED; the
 * artifacts are signed+notarized binaries anyway, and Cloudflare's edge DDoS layer sits in front.
 *
 * Range-aware on purpose: electron-updater fetches the OLD + NEW `.blockmap` and then issues ranged GETs
 * for only the changed chunks of the `.zip` (differential download). We honor `Range` → 206; a client
 * that sends no Range gets the full 200 body (so it degrades to a full download, never breaks). NOT
 * rate-limited: a single differential download bursts many ranged requests, which a per-IP cap would
 * wrongly trip.
 *
 * Keys are bare filenames (`latest-mac.yml`, `Cubic-<v>-arm64-mac.zip`, `.blockmap`, `.dmg`) — the
 * upload script (`app/scripts/release.mjs`) puts them at the bucket root, and this maps `/releases/<key>`
 * → `RELEASES.get(<key>)`.
 */

import type { Env } from './index.js';

const PREFIX = '/releases/';

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

/** Compute the served byte window from R2's returned `range` (offset/length or suffix forms). */
function resolveRange(range: R2Range, size: number): { start: number; end: number } {
  if ('suffix' in range) {
    return { start: Math.max(0, size - range.suffix), end: size - 1 };
  }
  const start = range.offset ?? 0;
  const end = range.length !== undefined ? Math.min(size - 1, start + range.length - 1) : size - 1;
  return { start, end };
}

export async function handleReleases(request: Request, env: Env): Promise<Response> {
  const bucket = env.RELEASES;
  if (!bucket) {
    // Binding not attached (deploy misconfig / `wrangler dev` without the R2 binding). Never 500 —
    // return a clean 404 so an update check just no-ops and the app keeps running.
    console.error('RELEASES R2 binding missing');
    return notFound();
  }

  const url = new URL(request.url);
  const key = decodeURIComponent(url.pathname.slice(PREFIX.length));
  // Guard against empty key + path traversal (bare filenames only).
  if (!key || key.includes('/') || key.includes('..')) return notFound();

  // HEAD — Squirrel/electron-updater may probe size/etag before ranged GETs.
  if (request.method === 'HEAD') {
    const head = await bucket.head(key);
    if (!head) return notFound();
    const headers = new Headers();
    head.writeHttpMetadata(headers);
    headers.set('etag', head.httpEtag);
    headers.set('accept-ranges', 'bytes');
    headers.set('content-length', String(head.size));
    return new Response(null, { status: 200, headers });
  }

  const object = await bucket.get(key, { range: request.headers });
  if (!object) return notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers); // content-type (from upload) + cache-control etc.
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');

  // A ranged request that R2 satisfied → 206 Partial Content with a Content-Range.
  const rangeRequested = request.headers.get('range') !== null;
  if (rangeRequested && object.range) {
    const { start, end } = resolveRange(object.range, object.size);
    headers.set('content-range', `bytes ${start}-${end}/${object.size}`);
    headers.set('content-length', String(end - start + 1));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('content-length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}
