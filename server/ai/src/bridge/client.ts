import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// wsBridge.ts writes the actual bound port here, but the file can be stale if a
// manually-started instance overwrote it and then died. We try the file's port first,
// then scan the fallback range that bindWithFallback uses (17923–17927).
const PORT_FILE = path.join(os.homedir(), '.ae-mcp-bridge', 'port');
const PORT_SCAN_RANGE = [17923, 17924, 17925, 17926, 17927];

function candidatePorts(): number[] {
  try {
    const filePort = parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim(), 10);
    if (filePort) return [filePort, ...PORT_SCAN_RANGE.filter(p => p !== filePort)];
  } catch { /* no file — start with defaults */ }
  return PORT_SCAN_RANGE;
}

function tryConnect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', () => reject());
  });
}

async function findBridge(): Promise<WebSocket> {
  for (const port of candidatePorts()) {
    try {
      return await tryConnect(port);
    } catch { /* try next port */ }
  }
  throw new Error(
    `Could not connect to AE WS bridge on any of ${PORT_SCAN_RANGE.join(', ')} — ` +
    'is the AE bridge running? (the standalone backend, or the MCP server under Claude Code)'
  );
}

interface PendingEntry {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BridgeClient {
  private ws: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private pending = new Map<string, PendingEntry>();

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const ws = await findBridge();
      this.ws = ws;
      ws.on('message', (data) => {
          let msg: { id: string; ok: boolean; result?: string; error?: string };
          try { msg = JSON.parse(data.toString()); } catch { return; }
          const entry = this.pending.get(msg.id);
          if (!entry) return;
          this.pending.delete(msg.id);
          clearTimeout(entry.timer);
          if (msg.ok) {
            let parsed: unknown;
            try { parsed = JSON.parse(msg.result!); } catch { parsed = msg.result; }
            entry.resolve(parsed);
          } else {
            entry.reject(new Error(msg.error ?? 'Unknown bridge error'));
          }
        });
      ws.on('close', () => { this.ws = null; });
      ws.on('error', () => { this.ws = null; });
    })();

    await this.connecting;
    this.connecting = null;
  }

  // Sends { id, command, args } — handled by routeExternalCommand() in wsBridge.ts
  async callRunScript(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    await this.connect();
    const id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Command "${command}" timed out after 10s — AE may be busy`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ id, command, args }));
    });
  }

  async disconnect(): Promise<void> {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.ws?.close();
    this.ws = null;
  }
}

export const bridgeClient = new BridgeClient();
