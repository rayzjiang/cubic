#!/usr/bin/env node
// Packaging orchestrator (§E) — one command turns the current app into a signed+notarized DMG.
//
//   npm run dist              → full signed + notarized build (needs Apple creds; see app/.env.signing)
//   npm run dist -- --unsigned → unsigned dry-run (no creds) that still produces a launchable .app/DMG,
//                                for verifying the pipeline mechanics before the real signed run.
//
// Sequence (each step under CUBIC_BUILD=prod):
//   1. server/ai        → prod build (@secrets → stub; real prompt/tools never enter the bytes)
//   2. server/ae-bridge → serve.js as ONE self-contained bundle
//   3. obfuscate serve.js
//   4. server/ae-bridge → build the CEP panel dist (unobfuscated — ES3 .jsx)
//   5. app              → electron-vite build (bakes the 5 public config values into main)
//   6. obfuscate out/main/index.js
//   7. electron-builder --mac → afterPack flips fuses → sign → notarize → staple → dmg + zip
//
// After packing, the working tree's server build/ is left in prod-stub state, which would silently
// break `npm run dev` (the dev preflight sees a matching build-id and skips the rebuild). So we always
// restore the dev build at the end.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(APP_DIR, '..')
const AI = resolve(REPO, 'server/ai')
const BRIDGE = resolve(REPO, 'server/ae-bridge')
const UNSIGNED = process.argv.includes('--unsigned')

function run(cmd, args, cwd, extraEnv = {}) {
  const env = { ...process.env, CUBIC_BUILD: 'prod', ...extraEnv }
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' })
  if (r.status !== 0) {
    throw new Error(`step failed (exit ${r.status}): ${cmd} ${args.join(' ')} [cwd=${cwd}]`)
  }
}

// Load app/.env.signing (gitignored) into process.env — set-once Apple creds, no re-exporting.
// A real shell export wins (we don't overwrite already-set vars).
function loadSigningEnv() {
  const f = resolve(APP_DIR, '.env.signing')
  if (!existsSync(f)) return
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const key = m[1]
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

function restoreDevBuild() {
  console.log('\n[dist] restoring dev build (server/ai + serve.js, no prod flag)…')
  const devEnv = { ...process.env }
  delete devEnv.CUBIC_BUILD
  spawnSync('node', ['scripts/build-ai.mjs'], { cwd: AI, env: devEnv, stdio: 'inherit' })
  spawnSync('node', ['scripts/build-backend.mjs', '--serve'], { cwd: BRIDGE, env: devEnv, stdio: 'inherit' })
}

async function main() {
  loadSigningEnv()

  if (!UNSIGNED && !process.env.APPLE_ID) {
    console.error(
      '\n[dist] No Apple signing creds found (APPLE_ID unset).\n' +
        '       For the real signed+notarized build, set up app/.env.signing (PAUSE 1 — see the plan):\n' +
        '         APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID\n' +
        '       Or run an unsigned dry-run:  npm run dist -- --unsigned\n'
    )
    process.exit(1)
  }

  console.log(`\n[dist] === Cubic macOS packaging (${UNSIGNED ? 'UNSIGNED dry-run' : 'signed + notarized'}) ===\n`)
  try {
    console.log('[dist] 1/7 build server/ai (prod → @secrets stub)')
    run('node', ['scripts/build-ai.mjs'], AI)

    console.log('[dist] 2/7 bundle serve.js (self-contained)')
    run('node', ['scripts/build-backend.mjs', '--serve'], BRIDGE)

    console.log('[dist] 3/7 obfuscate serve.js')
    run('node', ['scripts/obfuscate.mjs', resolve(BRIDGE, 'build/serve.js')], APP_DIR)

    console.log('[dist] 4/7 build CEP panel dist')
    run('node', ['scripts/build-cep-extension.mjs'], BRIDGE)

    console.log('[dist] 5/7 electron-vite build (bake config)')
    run('node', [resolve(APP_DIR, 'node_modules/electron-vite/bin/electron-vite.js'), 'build'], APP_DIR)

    console.log('[dist] 6/7 obfuscate out/main/index.js')
    run('node', ['scripts/obfuscate.mjs', resolve(APP_DIR, 'out/main/index.js')], APP_DIR)

    console.log('[dist] 7/8 electron-builder --mac')
    const ebArgs = ['--mac']
    const ebEnv = {}
    if (UNSIGNED) {
      ebEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'false' // skip Developer ID signing
      ebArgs.push('-c.mac.notarize=false') // and skip notarization
    }
    run(resolve(APP_DIR, 'node_modules/.bin/electron-builder'), ebArgs, APP_DIR, ebEnv)

    // electron-builder notarizes + staples the .app, but NOT the .dmg wrapper. A downloaded,
    // un-notarized .dmg can trip Gatekeeper's "can't be opened" warning on open — so sign +
    // notarize + staple the .dmg too (Apple's recommendation for DMG distribution). Signed builds
    // only (an unsigned dry-run has no identity/creds).
    if (!UNSIGNED) {
      console.log('[dist] 8/8 sign + notarize + staple the DMG')
      const releaseDir = resolve(APP_DIR, 'release')
      // Match THIS version's dmg (artifacts are Cubic-<version>-arch.dmg), not just the first .dmg —
      // so a stale older-version dmg left in release/ can never be signed/notarized by mistake.
      const version = JSON.parse(readFileSync(resolve(APP_DIR, 'package.json'), 'utf8')).version
      const dmgs = readdirSync(releaseDir).filter((f) => f.endsWith('.dmg') && f.includes(`-${version}-`))
      if (dmgs.length === 0) throw new Error(`no .dmg for v${version} found in release/ to notarize`)
      if (dmgs.length > 1) throw new Error(`multiple .dmg for v${version} in release/: ${dmgs.join(', ')}`)
      const dmgPath = resolve(releaseDir, dmgs[0])
      const identity = process.env.CSC_NAME || 'Developer ID Application'
      run('codesign', ['--force', '--sign', identity, '--timestamp', dmgPath], APP_DIR)
      run('xcrun', ['notarytool', 'submit', dmgPath, '--apple-id', process.env.APPLE_ID, '--team-id', process.env.APPLE_TEAM_ID, '--password', process.env.APPLE_APP_SPECIFIC_PASSWORD, '--wait'], APP_DIR)
      run('xcrun', ['stapler', 'staple', dmgPath], APP_DIR)
    }

    console.log(`\n[dist] DONE → ${resolve(APP_DIR, 'release')}`)
  } finally {
    restoreDevBuild()
  }
}

main().catch((e) => {
  console.error(`\n[dist] FAILED: ${e.message}`)
  process.exit(1)
})
