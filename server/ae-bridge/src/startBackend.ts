import { bridge } from "./bridge/wsBridge.js";
import { registerAgentChat } from "./agentChat.js";

// The WS bridge port. Override via AE_BRIDGE_PORT for tests; defaults to the
// canonical 17923 (the bridge hard-binds this with no fallback — see wsBridge.ts).
export const AE_BRIDGE_PORT = parseInt(process.env.AE_BRIDGE_PORT ?? "17923", 10);

/**
 * Boot the backend: open the WS bridge and fold in the agent loop. Shared by
 * both entrypoints — the MCP dev interface (`index.ts`) and the standalone
 * server the app spawns (`serve.ts`). The open WS server keeps the event loop
 * alive, so no stdio transport is needed to stay running.
 */
export async function startBackend(port: number = AE_BRIDGE_PORT): Promise<void> {
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
