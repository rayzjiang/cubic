// Shared build-id logic — the single source of truth for the CEP bundle's content hash, used by
// BOTH the bundler (build-cep-extension.mjs) and the dev preflight (preflight-panel.mjs). Keeping it
// here means the preflight can compute the "latest" id from source WITHOUT running a full build, and
// it can never drift from how the bundler actually hashes.
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Domain files in load order (dependencies first, dispatch last). The bundler concatenates exactly
// these, in this order, into handlers.bundled.jsx.
export const domainFiles = [
  'compositions.jsx',
  'fonts.jsx',        // font resolution helpers (_resolveFont) + listFonts
  'layers.jsx',
  'text.jsx',         // text layers + animators
  'shapes.jsx',       // shape layers + vector operators
  'animation.jsx',
  'masks.jsx',
  'effects.jsx',
  'footage.jsx',
  'markers.jsx',
  'project.jsx',
  'bridge.jsx',       // JSON polyfill + dispatchCommand + batch
];

/** Concatenate the domain .jsx files into the handlers bundle string (the exact bytes the bundler writes). */
export function buildHandlersBundle(scriptsDir) {
  const parts = [];
  for (const file of domainFiles) {
    const filePath = path.join(scriptsDir, file);
    if (!fs.existsSync(filePath)) throw new Error(`Missing handler file: ${filePath}`);
    parts.push(`// ---- ${file} ----\n${fs.readFileSync(filePath, 'utf8')}`);
  }
  return parts.join('\n\n');
}

/** 12-char content hash of the bundle + panel sources. Stable across runs (no mtimes). */
export function hashBuildId(handlersBundle, mainSrc, indexSrc) {
  return crypto.createHash('sha1').update(handlersBundle).update(mainSrc).update(indexSrc).digest('hex').slice(0, 12);
}

/** Compute the build id straight from source (no dist write) — what the preflight uses for its cheap
 *  staleness check. `root` is the ae-bridge package dir. */
export function computeBuildIdFromSource(root) {
  const scriptsDir = path.join(root, 'src', 'scripts');
  const extSrc = path.join(root, 'cep-extension');
  const handlersBundle = buildHandlersBundle(scriptsDir);
  const mainSrc = fs.readFileSync(path.join(extSrc, 'src', 'main.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(extSrc, 'index.html'), 'utf8');
  return hashBuildId(handlersBundle, mainSrc, indexSrc);
}

// ─── Backend build id ─────────────────────────────────────────────────────────
// The Node backend (build/serve.js + the cubic-ai brain it loads at runtime) is a SEPARATE artifact
// from the panel bundle above. Its behavior is fixed by two TS trees: this package's src/ and
// server/ai/src/. This id is baked into serve.js/index.js at build time (__CUBIC_BACKEND_BUILD_ID__)
// and reported by the running backend, so the dev preflight can detect a backend running stale code.

/** Recursively collect .ts source files under `dir` (excluding *.test.ts — specs aren't in the
 *  runtime bundle, so including them would make the running backend report stale forever). Returns
 *  absolute paths. .jsx handlers are excluded for free (we only match .ts). */
function walkTsFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** 12-char content hash of the backend source trees. `trees` is a list of { dir, label }; each file
 *  is keyed by `label/<path-relative-to-dir>` (so a rename changes the id even if bytes match) and the
 *  list is sorted for determinism. */
function hashTsTrees(trees) {
  const entries = [];
  for (const { dir, label } of trees) {
    for (const file of walkTsFiles(dir)) {
      const relKey = `${label}/${path.relative(dir, file).split(path.sep).join('/')}`;
      entries.push({ relKey, content: fs.readFileSync(file, 'utf8') });
    }
  }
  entries.sort((a, b) => (a.relKey < b.relKey ? -1 : a.relKey > b.relKey ? 1 : 0));
  const h = crypto.createHash('sha1');
  for (const e of entries) h.update(e.relKey).update('\0').update(e.content);
  return h.digest('hex').slice(0, 12);
}

/** Compute the backend build id from source (no build). `root` is the ae-bridge package dir; the
 *  server/ai sources live at `<root>/../ai/src` (the canonical file: dep target). Over-approximates
 *  by hashing ALL of ai/src — including files the backend may not import — which matches the panel's
 *  whole-bundle approach and is acceptable for dev tooling (worst case: one harmless extra rebuild). */
export function computeBackendBuildIdFromSource(root) {
  return hashTsTrees([
    { dir: path.join(root, 'src'), label: 'ae-bridge/src' },
    { dir: path.join(root, '..', 'ai', 'src'), label: 'ai/src' },
  ]);
}
