#!/usr/bin/env node
// §F-1 — upload the signed release artifacts + latest-mac.yml to the Cloudflare R2 update feed.
// Run AFTER `npm run dist` (which produces app/release/). electron-updater then pulls these via the
// cubic-proxy Worker's GET /releases/* (proxy/src/releases.ts). R2 is S3-compatible → the AWS S3 SDK.
//
//   npm run release            → upload the current version's artifacts (refuses to clobber a shipped version)
//   npm run release -- --force → overwrite even an already-uploaded versioned artifact
//
// Creds live in gitignored app/.env.release (mirror .env.signing); see app/.env.release.example.
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (default cubic-releases)

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE_DIR = resolve(APP_DIR, 'release')
const FORCE = process.argv.includes('--force')

// Load app/.env.release (gitignored) into process.env — mirrors dist.mjs's loadSigningEnv. A real
// shell export wins (we don't overwrite already-set vars).
function loadReleaseEnv() {
  const f = resolve(APP_DIR, '.env.release')
  if (!existsSync(f)) return
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = val
  }
}

const CONTENT_TYPES = {
  '.yml': 'text/yaml',
  '.zip': 'application/zip',
  '.dmg': 'application/x-apple-diskimage',
  '.blockmap': 'application/octet-stream',
}
function contentType(name) {
  return CONTENT_TYPES[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream'
}

async function keyExists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return false
    throw e
  }
}

async function main() {
  loadReleaseEnv()
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env
  const bucket = process.env.R2_BUCKET || 'cubic-releases'
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.error(
      '\n[release] Missing R2 creds. Set up app/.env.release (see app/.env.release.example):\n' +
        '          R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY  (R2_BUCKET optional)\n'
    )
    process.exit(1)
  }
  if (!existsSync(RELEASE_DIR)) {
    console.error('\n[release] No release/ dir — run `npm run dist` first.\n')
    process.exit(1)
  }

  const version = JSON.parse(readFileSync(resolve(APP_DIR, 'package.json'), 'utf8')).version

  // The moving pointer (always overwritten) + the immutable per-version artifacts.
  const pointer = 'latest-mac.yml'
  const versioned = [
    `Cubic-${version}-arm64-mac.zip`,
    `Cubic-${version}-arm64-mac.zip.blockmap`,
    `Cubic-${version}-arm64.dmg`,
    `Cubic-${version}-arm64.dmg.blockmap`,
  ]
  // Update-critical (must exist): the pointer, the update zip + its blockmap. The dmg is the fresh-install
  // download link — nice to host, not required for auto-update (skipped if absent).
  const required = new Set([pointer, `Cubic-${version}-arm64-mac.zip`, `Cubic-${version}-arm64-mac.zip.blockmap`])

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  })

  console.log(`\n[release] Cubic v${version} -> r2://${bucket}\n`)

  // Guard immutable versioned artifacts BEFORE uploading anything, so latest-mac.yml never ends up
  // pointing at a half-uploaded/overwritten build. A shipped version is frozen; only --force overrides.
  if (!FORCE) {
    for (const name of versioned) {
      if (existsSync(resolve(RELEASE_DIR, name)) && (await keyExists(client, bucket, name))) {
        console.error(
          `[release] ${name} already in the bucket — a shipped version is immutable.\n` +
            '          Bump app/package.json version, or re-run with --force to overwrite.\n'
        )
        process.exit(1)
      }
    }
  }

  // Versioned artifacts first, the pointer LAST — so latest-mac.yml only goes live once its targets are up.
  for (const name of [...versioned, pointer]) {
    const path = resolve(RELEASE_DIR, name)
    if (!existsSync(path)) {
      if (required.has(name)) {
        console.error(`[release] missing required artifact ${name} — did \`npm run dist\` finish?\n`)
        process.exit(1)
      }
      console.log(`[release] skip ${name} (not built)`)
      continue
    }
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: name, Body: readFileSync(path), ContentType: contentType(name) })
    )
    console.log(`[release] uploaded ${name} (${(statSync(path).size / 1e6).toFixed(1)} MB)`)
  }

  console.log('\n[release] DONE — feed live at <proxy>/releases/latest-mac.yml\n')
}

main().catch((e) => {
  console.error(`\n[release] FAILED: ${e.message}`)
  process.exit(1)
})
