import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

/**
 * §B5 — auto-install the AE bridge (CEP extension) into Adobe's CEP folder, idempotently, on every
 * app launch. Gated by a CONTENT HASH of the load-bearing files so we copy only when the bundled
 * extension actually differs from what's installed; that copy is the one signal that drives the
 * renderer's "restart After Effects" hint (a running AE only loads the new panel after a restart).
 *
 * Design invariants:
 *  - NEVER throws. A provisioning problem degrades AE connectivity only (surfaced in the status dot);
 *    it must never block the window or the backend from starting. All failures return {outcome:'failed'}.
 *  - Dev/packaged path seam mirrors backend.ts:resolveBackendEntry — packaging is Phase 5, so the
 *    `process.resourcesPath` branch is kept as an un-exercised seam.
 */

export const NEW_BUNDLE_ID = 'com.cubic.ae-bridge'
export const OLD_BUNDLE_ID = 'com.cubic.ae-mcp-bridge'

const CSXS_VERSIONS = ['11', '12']
// Only the load-bearing files — excludes `.debug` (no behavior) and all mtimes, so the bundled hash
// is stable across launches (deterministic build output) and we don't re-copy on every boot.
const HASH_FILES = ['handlers.bundled.jsx', join('CSXS', 'manifest.xml'), join('src', 'main.js')]

export interface InstallResult {
  /** 'fresh'|'updated' = a copy happened this launch → caller treats as "restart AE" candidate.
   *  'unchanged' = installed hash matched. 'failed' = something threw (AE-only, non-blocking). */
  outcome: 'fresh' | 'updated' | 'unchanged' | 'failed'
  error?: Error
}

/** Bundled cep-extension/dist dir. Dev: walk up from app/out/main to the sibling server package
 *  (same convention as backend.ts). Packaged (Phase 5 seam): process.resourcesPath/cep-extension. */
function resolveDistDir(): string {
  const here = dirname(fileURLToPath(import.meta.url)) // .../app/out/main
  const dev = join(here, '..', '..', '..', 'server', 'ae-bridge', 'cep-extension', 'dist')
  if (app.isPackaged) {
    const packaged = join(process.resourcesPath, 'cep-extension')
    if (existsSync(packaged)) return packaged
  }
  return dev
}

/** The build id of the panel THIS app version ships — the `build-id` sidecar baked into cep-extension/dist
 *  by build-cep-extension.mjs (copied to Resources/cep-extension in prod). Handed to the backend as
 *  CUBIC_PANEL_BUILD_ID so it can flag a stale RUNNING panel — one whose hello buildId no longer matches
 *  what we ship (§F-4). Null if the sidecar is missing/unreadable → staleness simply never triggers. */
export function bundledPanelBuildId(): string | null {
  try {
    return readFileSync(join(resolveDistDir(), 'build-id'), 'utf8').trim()
  } catch {
    return null
  }
}

/** Per-platform Adobe CEP extensions dir for a bundle id. Null on unsupported platforms. */
function cepExtensionsDir(bundleId: string): string | null {
  const home = homedir()
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions', bundleId)
  }
  if (process.platform === 'win32') {
    return join(home, 'AppData', 'Roaming', 'Adobe', 'CEP', 'extensions', bundleId)
  }
  return null
}

/** sha256 over the load-bearing files (name + contents). Null if any is missing/unreadable —
 *  which for the install dir means "not installed" (→ fresh copy). */
function hashExtension(dir: string): string | null {
  try {
    const h = createHash('sha256')
    for (const rel of HASH_FILES) {
      h.update(rel)
      h.update(readFileSync(join(dir, rel)))
    }
    return h.digest('hex')
  } catch {
    return null
  }
}

function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name)
    const d = join(dest, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else copyFileSync(s, d)
  }
}

/** Replace the install dir wholesale (rm then copy) so a rename/removal in the bundle can't leave
 *  a stale file behind. */
function copyFresh(src: string, dest: string): void {
  rmSync(dest, { recursive: true, force: true })
  copyDir(src, dest)
}

/** PlayerDebugMode=1 across CSXS 11/12 (required for unsigned extensions). Best-effort, never throws.
 *  execFile (not a shell string) — no interpolation/injection surface. */
function ensurePlayerDebugMode(): void {
  for (const v of CSXS_VERSIONS) {
    try {
      if (process.platform === 'darwin') {
        execFileSync('defaults', ['write', `com.adobe.CSXS.${v}`, 'PlayerDebugMode', '1'], { stdio: 'ignore' })
      } else if (process.platform === 'win32') {
        execFileSync('reg', ['add', `HKCU\\Software\\Adobe\\CSXS.${v}`, '/v', 'PlayerDebugMode', '/t', 'REG_SZ', '/d', '1', '/f'], { stdio: 'ignore' })
      }
    } catch {
      /* best-effort per version */
    }
  }
}

/** Best-effort removal of the pre-rename artifacts (old bundle dir + old ~/.ae-mcp-bridge port dir),
 *  so a dev machine doesn't end up with two AE panels / a stale port file. Clean break — nothing has
 *  shipped, so no migration is needed. */
function cleanupLegacy(): void {
  const targets = [cepExtensionsDir(OLD_BUNDLE_ID), join(homedir(), '.ae-mcp-bridge')]
  for (const t of targets) {
    try {
      if (t && existsSync(t)) rmSync(t, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }
}

/** Hash bundled vs installed; copy only when different; set PlayerDebugMode; clean legacy. */
export async function provisionBridge(): Promise<InstallResult> {
  try {
    cleanupLegacy()

    const dist = resolveDistDir()
    const bundledHash = hashExtension(dist)
    if (!bundledHash) {
      return {
        outcome: 'failed',
        error: new Error(`bundled CEP extension not found/complete at ${dist} — run "npm run build:plugin"`),
      }
    }

    const dest = cepExtensionsDir(NEW_BUNDLE_ID)
    if (!dest) return { outcome: 'failed', error: new Error('unsupported platform for CEP install') }

    const installedHash = hashExtension(dest)
    if (installedHash === bundledHash) {
      ensurePlayerDebugMode() // cheap + idempotent; keep it correct even when files match
      return { outcome: 'unchanged' }
    }

    const fresh = installedHash === null
    copyFresh(dist, dest)
    ensurePlayerDebugMode()
    return { outcome: fresh ? 'fresh' : 'updated' }
  } catch (error) {
    return { outcome: 'failed', error: error as Error }
  }
}
