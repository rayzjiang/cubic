#!/usr/bin/env node
// Build script for the CEP extension.
// 1. Concatenates all ExtendScript domain files into handlers.bundled.jsx
// 2. Inlines HANDLERS_BUNDLE into cep-extension/dist/src/main.js
// 3. Copies CSXS/manifest.xml, index.html, .debug, src/CSInterface.js into dist/

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const scriptsDir = path.join(root, 'src', 'scripts');
const extSrc = path.join(root, 'cep-extension');
const distDir = path.join(extSrc, 'dist');
const distSrcDir = path.join(distDir, 'src');
const distCsxsDir = path.join(distDir, 'CSXS');

// Domain files in load order (dependencies first, dispatch last)
const domainFiles = [
  'compositions.jsx',
  'fonts.jsx',        // font resolution helpers (_resolveFont) + listFonts
  'layers.jsx',
  'text.jsx',         // text layers + animators (was in layers.jsx)
  'shapes.jsx',       // shape layers + vector operators (was in layers.jsx)
  'animation.jsx',
  'masks.jsx',
  'effects.jsx',
  'footage.jsx',
  'markers.jsx',
  'project.jsx',
  'bridge.jsx',       // JSON polyfill + dispatchCommand + batch
];

// ─── Step 1: Concatenate handlers ─────────────────────────────────────────────

console.log('Building handlers bundle…');
const parts = [];
for (const file of domainFiles) {
  const filePath = path.join(scriptsDir, file);
  if (!fs.existsSync(filePath)) {
    console.error(`ERROR: Missing handler file: ${filePath}`);
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  parts.push(`// ---- ${file} ----\n${content}`);
}
const handlersBundle = parts.join('\n\n');

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, 'handlers.bundled.jsx'), handlersBundle, 'utf8');
console.log(`  handlers.bundled.jsx — ${Math.round(handlersBundle.length / 1024)}KB`);

// ─── Step 2: Inline HANDLERS_BUNDLE into main.js ──────────────────────────────

console.log('Building main.js…');
fs.mkdirSync(distSrcDir, { recursive: true });

const mainSrc = fs.readFileSync(path.join(extSrc, 'src', 'main.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(extSrc, 'index.html'), 'utf8');

// Content-hash build id: changes only when the panel/handler code actually changes. The dev
// preflight (scripts/preflight-panel.mjs) compares this against the id the open panel reports in
// its `hello` to tell whether the panel is running a stale bundle.
const BUILD_ID = crypto.createHash('sha1')
  .update(handlersBundle).update(mainSrc).update(indexSrc)
  .digest('hex').slice(0, 12);

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
