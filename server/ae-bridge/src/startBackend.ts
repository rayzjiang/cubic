import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultModel } from "cubic-ai";
import { bridge } from "./bridge/wsBridge.js";
import { registerAgentChat } from "./agentChat.js";

// The WS bridge port. Override via AE_BRIDGE_PORT for tests; defaults to the
// canonical 17923 (the bridge hard-binds this with no fallback — see wsBridge.ts).
export const AE_BRIDGE_PORT = parseInt(process.env.AE_BRIDGE_PORT ?? "17923", 10);

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
  console.error(bar);
  await bridge.start(port);
  registerAgentChat();
}

/**
 * Install termination handlers that free the WS port before exit. Since the
 * bridge binds 17923 with no fallback and hard-fails on conflict, a squatting
 * stale instance would block every future backend from starting — so freeing
 * the port on exit is load-bearing. Returns the `shutdown` fn so the MCP
 * entrypoint can also bind it to its stdin/transport close (the host's signal).
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
