#!/usr/bin/env node
// Build the cubic-ai bundle (src/index.ts → build/index.js). A node entrypoint (esbuild JS API, not
// the bin) so the ae-bridge dev preflight can rebuild this package under Electron's
// ELECTRON_RUN_AS_NODE without npm on PATH. JS only — the runtime backend imports build/index.js;
// .d.ts types (npm run build:types) are for editor/tsc consumers and aren't needed at runtime.

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// `@secrets` — the crown-jewels chokepoint. Direct-local dev bundles the REAL prompt + tool
// catalog from the proxy/ Worker package; the prod packaging build (CUBIC_BUILD=prod) aliases it
// to an empty stub so the secrets physically cannot enter the shipped binary (§A-1 / §E). The
// runtime CUBIC_ENV fork (loop.ts) is what actually selects bare-vs-full at request time; this
// strip is defense-in-depth that guarantees the bytes aren't present in prod.
const prod = process.env.CUBIC_BUILD === 'prod';
const secretsPath = prod
  ? path.join(root, 'src', 'secrets', 'stub.ts')
  : path.resolve(root, '..', '..', 'proxy', 'src', 'secrets', 'index.ts');

// L2: on a prod packaging build, wipe any stale direct-local bundle first (it bundled the REAL
// secrets) so the shipped build/ can only contain stub-resolved output — belt with the prod-build
// leak-guard test's suspenders. Skipped for dev/watch so incremental rebuilds stay fast.
if (prod) fs.rmSync(path.join(root, 'build'), { recursive: true, force: true });

const options = {
  entryPoints: [path.join(root, 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(root, 'build', 'index.js'),
  packages: 'external',
  alias: { '@secrets': secretsPath },
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log(`cubic-ai → build/index.js (watching; @secrets → ${prod ? 'stub' : 'proxy secrets'})`);
} else {
  await esbuild.build(options);
  console.log(`cubic-ai → build/index.js (@secrets → ${prod ? 'stub' : 'proxy secrets'})`);
}
