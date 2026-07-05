import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { bridge } from './wsBridge.js';

/**
 * Transport auth gate (§???-2): every socket must present the per-launch token in its FIRST `hello`
 * frame or be dropped. Spins the real bridge on an OS-assigned port (bind :0) and drives raw ws clients
 * — no AE needed (the `listCommands` command resolves node-side). HOME is pointed at a temp dir first so
 * bridge.start()'s ~/.cubic/conn.json write never touches the developer's real one.
 */

let tmpHome: string;

beforeAll(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cubic-wsauth-'));
  process.env.HOME = tmpHome; // os.homedir() honors $HOME on POSIX
  process.env.USERPROFILE = tmpHome; // …and %USERPROFILE% on Windows
  await bridge.start(0); // 0 → OS assigns a free port; mints bridge.token; writes conn.json under tmpHome
});

afterAll(() => {
  bridge.close();
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function connectRaw(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

describe('wsBridge auth gate', () => {
  it('publishes a dynamic port + a token to conn.json', () => {
    expect(bridge.port).toBeGreaterThan(0);
    expect(bridge.token).toMatch(/[0-9a-f-]{36}/);
    const conn = JSON.parse(fs.readFileSync(path.join(tmpHome, '.cubic', 'conn.json'), 'utf8'));
    expect(conn).toEqual({ port: bridge.port, token: bridge.token });
  });

  it('locks conn.json to owner-only 0600 and ~/.cubic to 0700 (#11)', () => {
    if (process.platform === 'win32') return; // POSIX modes are a no-op on Windows (ACLs) — see wsBridge.start
    const connMode = fs.statSync(path.join(tmpHome, '.cubic', 'conn.json')).mode & 0o777;
    const dirMode = fs.statSync(path.join(tmpHome, '.cubic')).mode & 0o777;
    expect(connMode).toBe(0o600); // the token that grants AE scripting must not be world/group-readable
    expect(dirMode).toBe(0o700);
  });

  it('closes a socket whose first frame lacks the token (4001)', async () => {
    const ws = await connectRaw();
    const code = await new Promise<number>((resolve) => {
      ws.once('close', (c) => resolve(c));
      ws.send(JSON.stringify({ type: 'hello' })); // no token
    });
    expect(code).toBe(4001);
  });

  it('closes a socket presenting a wrong token (4001)', async () => {
    const ws = await connectRaw();
    const code = await new Promise<number>((resolve) => {
      ws.once('close', (c) => resolve(c));
      ws.send(JSON.stringify({ type: 'hello', token: 'nope', role: 'ui' }));
    });
    expect(code).toBe(4001);
  });

  it('closes a silent socket after the auth timeout', async () => {
    const ws = await connectRaw();
    const code = await new Promise<number>((resolve) => {
      ws.once('close', (c) => resolve(c)); // send nothing → dropped at AUTH_TIMEOUT_MS
    });
    expect(code).toBe(4001);
  }, 5000);

  it('keeps a socket with the valid token and routes a command', async () => {
    const ws = await connectRaw();
    const reply = await new Promise<{ ok: boolean }>((resolve, reject) => {
      const id = 'auth-test-1';
      const timer = setTimeout(() => reject(new Error('no reply')), 2000);
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.id === id) { clearTimeout(timer); resolve(m); }
      });
      ws.send(JSON.stringify({ type: 'hello', token: bridge.token, role: 'dev' })); // authenticate
      ws.send(JSON.stringify({ id, command: 'listCommands', args: {} })); // resolves node-side
    });
    expect(reply.ok).toBe(true);
    ws.close();
  });
});
