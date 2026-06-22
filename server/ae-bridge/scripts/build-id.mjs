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
