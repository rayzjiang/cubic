#!/usr/bin/env node
// Build script for the CEP extension.
// 1. Concatenates all ExtendScript domain files into handlers.bundled.jsx
// 2. Inlines HANDLERS_BUNDLE into cep-extension/dist/src/main.js
// 3. Copies CSXS/manifest.xml, index.html, .debug, src/CSInterface.js into dist/

import * as fs from 'fs';
import * as path from 'path';
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

const bundleJson = JSON.stringify(handlersBundle);
const inlinedConst = `var HANDLERS_BUNDLE = ${bundleJson};\n`;

// Strip the linter pragma and prepend the inlined constant
let mainOut = mainSrc.replace(/\/\*\s*global HANDLERS_BUNDLE.*?\*\/\n?/, '');
mainOut = inlinedConst + mainOut;

fs.writeFileSync(path.join(distSrcDir, 'main.js'), mainOut, 'utf8');
console.log(`  dist/src/main.js — ${Math.round(mainOut.length / 1024)}KB`);

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

fs.copyFileSync(
  path.join(extSrc, 'index.html'),
  path.join(distDir, 'index.html')
);

fs.copyFileSync(
  path.join(extSrc, '.debug'),
  path.join(distDir, '.debug')
);

console.log('  CSXS/manifest.xml, index.html, .debug');

console.log('\nCEP extension built → cep-extension/dist/');
console.log('Run "npm run install-plugin" to copy to Adobe CEP folder and enable PlayerDebugMode.');
