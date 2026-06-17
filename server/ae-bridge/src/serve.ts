import { startBackend, installShutdown, AE_BRIDGE_PORT, EXIT_PORT_IN_USE } from "./startBackend.js";

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
  // A port conflict exits with a distinct code so Electron main shows "another copy of Cubic is
  // running" (and does NOT auto-restart — a respawn would just re-collide); everything else is a
  // generic crash (exit 1) eligible for bounded auto-restart.
  const code = (error && (error as { code?: string }).code === 'PORT_IN_USE') ? EXIT_PORT_IN_USE : 1;
  process.exit(code);
});
