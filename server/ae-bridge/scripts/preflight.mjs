#!/usr/bin/env node
// Dev-only preflight — the single entrypoint the Electron app and the panel/backend-requiring test
// scripts invoke. Runs BOTH freshness checks so a single run rebuilds everything stale:
//   - the backend (build/serve.js + the cubic-ai brain it loads)  — preflight-backend.mjs
//   - the open AE panel's handler bundle                          — preflight-panel.mjs
// Both run (no short-circuit) so both stale artifacts rebuild in one pass; exits 1 if EITHER was
// stale, so the dev re-runs once on fully fresh code. Fresh/unverifiable → exit 0.
//
// Not a runtime/product feature: real users get fresh code via the prod auto-updater.
import { run as runBackend } from './preflight-backend.mjs';
import { run as runPanel } from './preflight-panel.mjs';

const backendCode = await runBackend();
const panelCode = await runPanel();
process.exit(backendCode === 1 || panelCode === 1 ? 1 : 0);
