import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The backend OS-assigns its WS port and mints a per-launch session token, publishing both to
// ~/.cubic/conn.json. We read it authoritatively (the fixed-port scan is gone — the port is now
// dynamic) and echo the token in the first `hello` frame; the backend drops any socket that doesn't.
const CONN_FILE = path.join(os.homedir(), '.cubic', 'conn.json');

interface BridgeConn { port: number; token: string; }

function readConn(): BridgeConn {
  const { port, token } = JSON.parse(fs.readFileSync(CONN_FILE, 'utf8')) as Partial<BridgeConn>;
  if (typeof port !== 'number' || typeof token !== 'string') throw new Error('malformed conn.json');
  return { port, token };
}

async function findBridge(): Promise<WebSocket> {
  let conn: BridgeConn;
  try {
    conn = readConn();
  } catch {
    throw new Error(
      'Could not read ~/.cubic/conn.json — is the AE bridge running? ' +
      '(the standalone backend, or the MCP server under Claude Code)'
    );
  }
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${conn.port}`);
    ws.once('open', () => {
      // Authenticate as the loopback client before any command is sent.
      ws.send(JSON.stringify({ type: 'hello', token: conn.token, role: 'loopback' }));
      resolve(ws);
    });
    ws.once('error', (e) => reject(e));
  });
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
