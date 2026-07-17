#!/usr/bin/env node
// Obfuscate one or more bundled JS files IN PLACE (§E-1). dist.mjs applies this to the two
// logic-bearing bundles — server/ae-bridge/build/serve.js (agent loop + tool dispatch + tool names)
// and app/out/main/index.js — AFTER the prod build strips secrets and BEFORE electron-builder
// packs/signs, so the obfuscated bytes are what gets signed.
//
// Deliberately NOT applied to the ExtendScript .jsx (ES3 + load-bearing eval/JSON polyfill; a single
// mangle silently kills the panel, and there's no IP in AE-API glue) nor the renderer (Vite already
// minifies it; no secrets). Settings are moderate + library-safe: rename identifiers + relocate
// strings, but NO self-defending / debugProtection (crash under Electron) and NO renameGlobals /
// transformObjectKeys (would break bundled third-party libs). Both bundles are ESM w/ import.meta.url,
// which the obfuscator preserves.
//
// Usage: node obfuscate.mjs <file> [<file> ...]

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import JavaScriptObfuscator from 'javascript-obfuscator'

const OPTIONS = {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false, // CRITICAL — bundled libs rely on globals
  transformObjectKeys: false, // avoid breaking library object shapes
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: [], // no rc4/base64 — startup cost + fragility
  controlFlowFlattening: false,
  deadCodeInjection: false,
  numbersToExpressions: false,
  unicodeEscapeSequence: false,
  selfDefending: false, // breaks under Electron
  debugProtection: false, // breaks DevTools / the ELECTRON_RUN_AS_NODE spawn
  target: 'node',
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('obfuscate.mjs: no input files given')
  process.exit(1)
}

for (const f of files) {
  const p = resolve(process.cwd(), f)
  if (!existsSync(p)) {
    console.error(`obfuscate.mjs: file not found — ${p}`)
    process.exit(1)
  }
  const src = readFileSync(p, 'utf8')
  const out = JavaScriptObfuscator.obfuscate(src, OPTIONS).getObfuscatedCode()
  writeFileSync(p, out, 'utf8')
  console.log(`  obfuscated ${f} (${(src.length / 1024).toFixed(0)}K → ${(out.length / 1024).toFixed(0)}K)`)
}
