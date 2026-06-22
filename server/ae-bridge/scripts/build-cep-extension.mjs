#!/usr/bin/env node
// Build script for the CEP extension.
// 1. Concatenates all ExtendScript domain files into handlers.bundled.jsx
// 2. Inlines HANDLERS_BUNDLE into cep-extension/dist/src/main.js
// 3. Copies CSXS/manifest.xml, index.html, .debug, src/CSInterface.js into dist/

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { buildHandlersBundle, hashBuildId } from './build-id.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const scriptsDir = path.join(root, 'src', 'scripts');
const extSrc = path.join(root, 'cep-extension');
const distDir = path.join(extSrc, 'dist');
const distSrcDir = path.join(distDir, 'src');
const distCsxsDir = path.join(distDir, 'CSXS');

// ─── Step 1: Concatenate handlers (domain file list + concat live in build-id.mjs, shared with
//             the preflight so its cheap staleness check can't drift from the real build) ─────────

console.log('Building handlers bundle…');
let handlersBundle;
try {
  handlersBundle = buildHandlersBundle(scriptsDir);
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, 'handlers.bundled.jsx'), handlersBundle, 'utf8');
console.log(`  handlers.bundled.jsx — ${Math.round(handlersBundle.length / 1024)}KB`);

// ─── Step 2: Inline HANDLERS_BUNDLE into main.js ──────────────────────────────

console.log('Building main.js…');
fs.mkdirSync(distSrcDir, { recursive: true });

const mainSrc = fs.readFileSync(path.join(extSrc, 'src', 'main.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(extSrc, 'index.html'), 'utf8');

// Content-hash build id (same fn the preflight uses): changes only when the panel/handler code
// actually changes. The preflight compares it against the id the open panel reports in its `hello`.
const BUILD_ID = hashBuildId(handlersBundle, mainSrc, indexSrc);

const bundleJson = JSON.stringify(handlersBundle);
// __CUBIC_BUILD_ID__: the panel reports it in `hello` so the dev preflight can detect a stale panel.
const inlinedConst = `var HANDLERS_BUNDLE = ${bundleJson};\nvar __CUBIC_BUILD_ID__ = ${JSON.stringify(BUILD_ID)};\n`;

// Strip the linter pragma and prepend the inlined constant
let mainOut = mainSrc.replace(/\/\*\s*global HANDLERS_BUNDLE.*?\*\/\n?/, '');
mainOut = inlinedConst + mainOut;

fs.writeFileSync(path.join(distSrcDir, 'main.js'), mainOut, 'utf8');
console.log(`  dist/src/main.js — ${Math.round(mainOut.length / 1024)}KB`);
console.log(`  build id — ${BUILD_ID}`);

// Copy CSInterface.js alongside main.js
fs.copyFileSync(
  path.join(extSrc, 'src', 'CSInterface.js'),
  path.join(distSrcDir, 'CSInterface.js')
);
console.log('  dist/src/CSInterface.js');

// ─── Step 3: Copy static assets ───────────────────────────────────────────────

console.log('Copying static assets…');

fs.mkdirSync(distCsxsDir, { recursive: true });
fs.copyFileSync(
  path.join(extSrc, 'CSXS', 'manifest.xml'),
  path.join(distCsxsDir, 'manifest.xml')
);

// Stamp the build id onto the main.js <script> query so a panel reload re-fetches a fresh main.js
// (cache-bust) rather than a cached copy.
const indexOut = indexSrc.replace(
  /(<script\s+src=")(src\/main\.js)(?:\?b=[^"]*)?(")/,
  `$1$2?b=${BUILD_ID}$3`
);
fs.writeFileSync(path.join(distDir, 'index.html'), indexOut, 'utf8');

fs.copyFileSync(
  path.join(extSrc, '.debug'),
  path.join(distDir, '.debug')
);

// Sidecar build id — the dev preflight reads this as the "latest built" id to compare against the panel.
fs.writeFileSync(path.join(distDir, 'build-id'), BUILD_ID, 'utf8');

console.log('  CSXS/manifest.xml, index.html, .debug, build-id');

console.log('\nCEP extension built → cep-extension/dist/');
console.log('Run "npm run install-plugin" to copy to Adobe CEP folder and enable PlayerDebugMode.');
