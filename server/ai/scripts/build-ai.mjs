#!/usr/bin/env node
// Build the cubic-ai bundle (src/index.ts → build/index.js). A node entrypoint (esbuild JS API, not
// the bin) so the ae-bridge dev preflight can rebuild this package under Electron's
// ELECTRON_RUN_AS_NODE without npm on PATH. JS only — the runtime backend imports build/index.js;
// .d.ts types (npm run build:types) are for editor/tsc consumers and aren't needed at runtime.

import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

await esbuild.build({
  entryPoints: [path.join(root, 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(root, 'build', 'index.js'),
  packages: 'external',
});
console.log('cubic-ai → build/index.js');
