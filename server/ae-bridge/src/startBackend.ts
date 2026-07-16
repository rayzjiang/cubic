import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultModel, COMPACT_THRESHOLD, KEEP_RECENT_TURNS, setAnalyticsSink } from "cubic-ai";
import { bridge } from "./bridge/wsBridge.js";
import { registerAgentChat } from "./agentChat.js";

// The WS bridge port to bind. Default 0 → the OS assigns a free port (no fixed-port conflict can make
// startup fatal — see wsBridge.ts); the actual bound port is read back + published to ~/.cubic/conn.json.
// An explicit AE_BRIDGE_PORT (tests) forces that exact port instead.
export const AE_BRIDGE_PORT = process.env.AE_BRIDGE_PORT ? parseInt(process.env.AE_BRIDGE_PORT, 10) : 0;

// Distinct (non-1) exit code serve.ts uses when the port is already taken (the bridge threw a
// BridgeError('PORT_IN_USE')). Electron main maps this exact code to the blocking "another copy of
// Cubic is running" state, vs a generic crash (exit 1) which triggers bounded auto-restart.
export const EXIT_PORT_IN_USE = 17;

/**
 * Local-dev convenience: load the single shared `server/.env` (ANTHROPIC_API_KEY + optional
 * CUBIC_MODEL) at boot so the app (`npm run dev`), `npm run serve`, and the server/ai tests all read
 * the SAME file — one source of truth, no per-package drift. Node-native (`process.loadEnvFile`,
 * Node ≥20.12) — no dependency. Real environment variables take precedence (loadEnvFile won't
 * override an already-set var). This file is dev-only and gitignored; in production the key never
 * lives locally — `CUBIC_ENV=prod` routes the brain through the hosted proxy (Phase 5). Resolved
 * relative to this module (build/ → ../../ = server/) so cwd doesn't matter.
 */
function loadLocalEnv(): void {
  try {
    const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
    const proc = process as unknown as { loadEnvFile?: (path?: string) => void };
    if (proc.loadEnvFile && existsSync(envPath)) proc.loadEnvFile(envPath);
  } catch { /* best-effort: a missing/invalid .env never blocks boot */ }
}

/**
 * Boot the backend: open the WS bridge and fold in the agent loop. Shared by
 * both entrypoints — the MCP dev interface (`index.ts`) and the standalone
 * server the app spawns (`serve.ts`). The open WS server keeps the event loop
 * alive, so no stdio transport is needed to stay running.
 */
export async function startBackend(port: number = AE_BRIDGE_PORT): Promise<void> {
  loadLocalEnv();
  // Resolved AFTER loadLocalEnv so a CUBIC_MODEL set in server/.env is reflected (sonnet|haiku|opus
  // or a full model id). An unmissable banner so the active model — and whether it's the costly
  // Sonnet default — is obvious in the `npm run dev` terminal every boot.
  const model = defaultModel();
  const raw = process.env.CUBIC_MODEL?.trim();
  const bar = "=".repeat(46);
  console.error(bar);
  console.error(`  CUBIC MODEL: ${model}`);
  console.error(`  (source: ${raw ? `CUBIC_MODEL=${raw}` : "default — no CUBIC_MODEL set"})`);
  if (!raw) {
    console.error("  ⚠  CUBIC_MODEL unset → defaulting to Sonnet (pricier).");
    console.error("     Set CUBIC_MODEL=haiku in server/.env for cheap dev.");
  }
  // Compaction test knobs — print the EFFECTIVE value (env override or the built-in default) so a
  // stale shell export or an un-restarted backend is obvious when verifying compaction behavior.
  const ctxWin = process.env.CUBIC_CONTEXT_WINDOW?.trim();
  const thresh = process.env.CUBIC_COMPACT_THRESHOLD?.trim();
  const keep = process.env.CUBIC_KEEP_RECENT_TURNS?.trim();
  console.error(`  CONTEXT WINDOW: ${ctxWin ? `${ctxWin} (override)` : "unset → full model window"}`);
  console.error(`  COMPACT THRESHOLD: ${thresh ? `${thresh} (override)` : `${COMPACT_THRESHOLD} (default)`}`);
  console.error(`  KEEP RECENT TURNS: ${keep ? `${keep} (override)` : `${KEEP_RECENT_TURNS} (default)`}`);
  console.error(bar);
  await bridge.start(port);
  registerAgentChat();
  // §H — forward the agent brain's analytics events (command_run, …) UP to the Electron parent, which
  // stamps identity + sends to PostHog. `process.send?` no-ops when there's no IPC channel: the MCP dev
  // entrypoint (Claude Code over stdio) and a bare `npm run serve` both have no analytics parent.
  setAnalyticsSink((event, props) => {
    try { process.send?.({ type: "analytics", event, props }); } catch { /* best-effort */ }
  });
  // Report the actual bound port + per-launch token UP to the Electron parent, which relays them to the
  // renderer via getBackendPort(). No-op when there's no IPC channel — the MCP entrypoint (Claude Code
  // over stdio) and a bare `npm run serve` both discover {port, token} via ~/.cubic/conn.json instead.
  process.send?.({ type: "bridgeReady", port: bridge.port, token: bridge.token });
}

/**
 * Install termination handlers that close the WS server + drop the worker before exit, so a
 * terminating backend never orphans its socket or leaves a stale ~/.cubic/conn.json pointing at a dead
 * port. (The OS-assigned dynamic port means a leaked port no longer blocks the next boot, but clean
 * teardown still matters for the panel's reconnect + a correct conn file.) Returns the `shutdown` fn so
 * the MCP entrypoint can also bind it to its stdin/transport close (the host's signal).
 */
export function installShutdown(): () => void {
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { bridge.close(); } catch { /* best-effort */ }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGHUP", shutdown);
  return shutdown;
}
