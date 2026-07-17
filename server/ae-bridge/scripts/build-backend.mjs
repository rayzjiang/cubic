#!/usr/bin/env node
// Build script for the Node backend (serve.js + the MCP index.js).
// Bakes a content-hash build id (__CUBIC_BACKEND_BUILD_ID__) into the bundle so the running backend
// can report it to the dev preflight (scripts/preflight-backend.mjs), which detects a backend running
// stale code. Uses the esbuild JS API (not the bin) so it runs under Electron's ELECTRON_RUN_AS_NODE
// without npm on PATH. Mirrors build-cep-extension.mjs.
//
// Usage: build-backend.mjs [--serve] [--server]   (default: both)

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { computeBackendBuildIdFromSource } from './build-id.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const wantServe = args.includes('--serve') || (!args.includes('--serve') && !args.includes('--server'));
const wantServer = args.includes('--server') || (!args.includes('--serve') && !args.includes('--server'));

// Content-hash build id over both backend source trees (ae-bridge/src + ../ai/src). Changes only when
// the backend code actually changes (no mtimes), so an unchanged rebuild is a no-op for the preflight.
const BACKEND_BUILD_ID = computeBackendBuildIdFromSource(root);

// Prod packaging build (CUBIC_BUILD=prod, driven by app/scripts/dist.mjs): produce a SINGLE
// self-contained bundle. Dev keeps deps external (fast, resolved from node_modules).
const prod = process.env.CUBIC_BUILD === 'prod';

// Same esbuild config as the former one-liners, plus the build-id define. JSON.stringify makes the
// define value a quoted string literal so the bare __CUBIC_BACKEND_BUILD_ID__ identifier is replaced
// with "<id>" everywhere it appears in the bundled-in code (serve.ts/index.ts + relative imports).
async function bundle(entry, outfile) {
  await esbuild.build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: path.join(root, outfile),
    // Prod: inline EVERYTHING (cubic-ai via its symlink + ws + @anthropic-ai/sdk + zod + dotenv + …)
    // into one file so the packaged .app ships a single serve.js — no node_modules, no fragile
    // `cubic-ai` symlink to carry into the bundle. ws's optional native perf addons (bufferutil,
    // utf-8-validate) can't be bundled (.node) → keep them external; ws falls back to pure JS.
    // A CommonJS dep (@anthropic-ai/sdk) inlined into ESM output emits require()/__dirname/__filename,
    // which don't exist in an ES module → shim them from import.meta.url via the banner.
    ...(prod
      ? {
          external: ['bufferutil', 'utf-8-validate'],
          banner: {
            js: [
              "import{createRequire as ___createRequire}from'node:module';",
              "import{fileURLToPath as ___fileURLToPath}from'node:url';",
              "import{dirname as ___dirname}from'node:path';",
              'const require=___createRequire(import.meta.url);',
              'const __filename=___fileURLToPath(import.meta.url);',
              'const __dirname=___dirname(__filename);',
            ].join(''),
          },
        }
      : { packages: 'external' }),
    define: { __CUBIC_BACKEND_BUILD_ID__: JSON.stringify(BACKEND_BUILD_ID) },
  });
  console.log(`  ${outfile}${prod ? ' (self-contained)' : ''}`);
}

console.log('Building backend bundle…');
if (wantServe) await bundle('src/serve.ts', 'build/serve.js');
if (wantServer) await bundle('src/index.ts', 'build/index.js');

// Sidecar build id — debugging aid + offline parity check (the running process reports the baked
// constant directly; this mirrors the panel's dist/build-id sidecar).
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'backend-build-id'), BACKEND_BUILD_ID, 'utf8');
console.log(`  build id — ${BACKEND_BUILD_ID}`);
