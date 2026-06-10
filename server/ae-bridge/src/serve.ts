import { startBackend, installShutdown, AE_BRIDGE_PORT } from "./startBackend.js";

// Standalone backend entrypoint — boots ONLY the WS bridge + agent loop, no MCP
// server / stdio transport. This is the process the standalone app (Phase 4 §B)
// spawns from Electron main; today it runs directly via `npm run serve`. Unlike
// the MCP entrypoint there's no host piping stdin, so shutdown is driven purely
// by termination signals (parent-death handling lands with the Electron shell).
async function main() {
  console.error("Cubic backend (standalone) starting...");
  installShutdown();
  await startBackend();
  console.error(`Cubic backend listening on 127.0.0.1:${AE_BRIDGE_PORT} — awaiting AE worker + chat clients...`);
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
