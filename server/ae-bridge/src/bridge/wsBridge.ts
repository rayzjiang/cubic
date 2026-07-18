import { WebSocketServer, WebSocket } from 'ws';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { COMMANDS } from '../commands.js';

// Baked into serve.js/index.js at build time by scripts/build-backend.mjs (esbuild --define). Read
// ONCE at module load; reported on demand to the dev backend preflight (backendInfo) so it can detect
// a backend running stale code. Never recomputed at runtime. Mirrors the panel's __CUBIC_BUILD_ID__
// guard in cep-extension/src/main.js; null when un-baked (a stray tsc/old build) → preflight proceeds.
declare const __CUBIC_BACKEND_BUILD_ID__: string;
const BACKEND_BUILD_ID: string | null =
  typeof __CUBIC_BACKEND_BUILD_ID__ !== 'undefined' ? __CUBIC_BACKEND_BUILD_ID__ : null;

export class BridgeError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'BridgeError';
  }
}

interface PendingCommand {
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type BridgeEvent = 'connect' | 'disconnect';

/** Chat-channel messages the panel/renderer sends over its socket (Phase 2 agent loop + Phase 4
 *  re-attach/persistence/list). `attach` rejoins a running turn by sessionId; `delete` removes a
 *  stored conversation (fired from the sidebar list, so it targets any sessionId, not just the open
 *  one); `list` requests the current project's conversation list; `loadHistory` fetches one
 *  conversation's committed history as renderable display items. */
export interface ChatInbound {
  type: 'userChat' | 'cancel' | 'queue' | 'editQueue' | 'removeQueue' | 'attach' | 'delete' | 'list' | 'loadHistory' | 'restore' | 'rename' | 'checkFileAccess';
  sessionId?: string;
  text?: string;
  /** The renderer's fresh Supabase access token, attached to each `userChat` (proxy mode). Threaded into
   *  the agent turn → the per-request `Authorization` header the Worker verifies (WT-PROXY-GATING §A-4).
   *  Rides the loopback WS frame, which is already 127.0.0.1-only + token-authed (WT-WS-AUTH). */
  token?: string;
  /** Queue item id (panel-generated for queue/editQueue/removeQueue). */
  id?: string;
  /** Pre-turn snapshot id to revert to (restore: "restore to before this request"). */
  turnId?: string;
  /** New conversation title (rename). */
  title?: string;
}

/** The `ChatInbound['type']` values, for routing. Keep in sync with the union above. */
const CHAT_INBOUND_TYPES = new Set<ChatInbound['type']>([
  'userChat', 'cancel', 'queue', 'editQueue', 'removeQueue', 'attach', 'delete', 'list', 'loadHistory', 'restore', 'rename', 'checkFileAccess',
]);

export type ChatHandler = (ws: WebSocket, msg: ChatInbound) => void;

/** Grace window for a freshly-connected socket to present a valid-token `hello`. A socket that stays
 *  silent (or sends anything else) past this is dropped — bounds the malicious-webpage attacker that
 *  opens the port and waits. Legit clients all send their `hello` synchronously on open. */
const AUTH_TIMEOUT_MS = 2000;

class AEBridge {
  private wss: WebSocketServer | null = null;
  private workerClient: WebSocket | null = null;
  private pending: Map<string, PendingCommand> = new Map();
  private eventHandlers: Map<BridgeEvent, Array<() => void>> = new Map();
  private connectWaiters: Array<() => void> = [];
  private chatHandler: ChatHandler | null = null;
  private chatCloseHandler: ((ws: WebSocket) => void) | null = null;
  public lastResult: string = '';

  /** The OS-assigned port actually bound (set after `listening`) + the per-launch session token minted
   *  at startup. Both are written to ~/.cubic/conn.json and reported up to Electron main; every client
   *  must echo the token in its first `hello` frame. Getters let the entrypoint report them up. */
  private _port = 0;
  private _token = '';
  get port(): number { return this._port; }
  get token(): string { return this._token; }

  /** Sockets that have presented the valid token in their first frame. Every privileged dispatch is
   *  gated on membership; a socket is added on a good `hello` and removed on close. */
  private authed = new Set<WebSocket>();

  /** Bundle id the connected panel reported in `hello` — read by the dev preflight (workerInfo) to
   *  detect a panel running a stale baked-in bundle. Null when no panel / an older panel build. */
  private workerBuildId: string | null = null;

  /**
   * Boot the WS server. `port` is 0 in normal use → the OS assigns a free port (`bind 127.0.0.1:0`),
   * so a port conflict can never make startup fatal on a stranger's machine; an explicit AE_BRIDGE_PORT
   * (tests) binds that exact port and still fails loudly on conflict. Mints a per-launch session token,
   * then publishes {port, token} to ~/.cubic/conn.json for the independently-launched clients (CEP
   * panel + cubic-ai loopback) to discover; the entrypoint additionally reports them up to Electron
   * main (for the renderer) via the child IPC channel.
   */
  async start(port: number): Promise<void> {
    await this.bind(port); // sets this._port to the actual bound port
    this._token = crypto.randomUUID();
    // All Cubic runtime state lives under one home dir (~/.cubic also holds sessions/ — see persist.ts).
    const bridgeDir = path.join(os.homedir(), '.cubic');
    const connPath = path.join(bridgeDir, 'conn.json');
    try {
      fs.mkdirSync(bridgeDir, { recursive: true });
      // conn.json holds the token that grants arbitrary ExtendScript execution in the open AE project —
      // lock it to the owner so no other local account can read it (#11). chmod explicitly (not just a
      // `mode:` on write): the dir/file usually already exist from a prior launch, and mode-on-create
      // doesn't tighten an existing file. Locking the dir to 0700 also shields ~/.cubic/sessions.
      // NOTE: POSIX modes are a no-op on Windows/NTFS (ACLs) — Windows hardening (icacls) is a POSTMVP item.
      fs.chmodSync(bridgeDir, 0o700);
      fs.writeFileSync(connPath, JSON.stringify({ port: this._port, token: this._token }), { mode: 0o600 });
      fs.chmodSync(connPath, 0o600);
    } catch { /* non-fatal */ }
    console.error(`WS bridge listening on 127.0.0.1:${this._port}`);
  }

  private bind(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: '127.0.0.1', port });
      wss.once('listening', () => {
        this.wss = wss;
        // Read the actual port back — with port 0 the OS picked it; with an override it echoes `port`.
        const addr = wss.address();
        this._port = (typeof addr === 'object' && addr) ? addr.port : port;
        this.setupConnectionHandler();
        resolve();
      });
      wss.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // Only reachable via an explicit AE_BRIDGE_PORT override (normal boot binds :0 → the OS never
          // hands out a taken port). Tagged PORT_IN_USE so serve.ts maps it to EXIT_PORT_IN_USE and
          // Electron main shows "another copy of Cubic is running" without scraping stderr.
          reject(new BridgeError('PORT_IN_USE',
            `A Cubic backend is already bound to 127.0.0.1:${port} (AE_BRIDGE_PORT override) — close it first. ` +
            `Only one backend may run at a time (it owns the single AE bridge connection).`
          ));
        } else {
          reject(err);
        }
      });
    });
  }

  private setupConnectionHandler(): void {
    this.wss!.on('connection', (ws) => {
      // Every client must present the per-launch token in its first frame; drop a socket that never
      // authenticates (a webpage can't read ~/.cubic/conn.json, so it can never present the token).
      const authTimer = setTimeout(() => {
        if (!this.authed.has(ws)) ws.close(4001, 'auth timeout');
      }, AUTH_TIMEOUT_MS);

      ws.on('message', (data) => {
        let msg: any;
        try { msg = JSON.parse(data.toString()); } catch { return; }

        // ── Gate: the FIRST frame must be a valid-token hello; nothing else is dispatched until then ──
        if (!this.authed.has(ws)) {
          if (msg.type === 'hello' && msg.token === this._token) {
            this.authed.add(ws);
            clearTimeout(authTimer);
            // The AE panel's hello doubles as worker registration (role:'worker' / carries a buildId);
            // the renderer/loopback/dev hellos authenticate only.
            if (msg.role === 'worker' || typeof msg.buildId === 'string') {
              if (this.workerClient && this.workerClient !== ws) {
                this.workerClient.close(4000, 'superseded by new worker');
              }
              this.workerClient = ws;
              this.workerBuildId = typeof msg.buildId === 'string' ? msg.buildId : null;
              for (const w of this.connectWaiters) w();
              this.connectWaiters = [];
              this.emit('connect');
            }
          } else {
            ws.close(4001, 'unauthorized');
          }
          return;
        }

        if (msg.type === 'hello') {
          // Already authenticated — a duplicate hello is a no-op (re-registration goes through the gate).
          return;
        } else if (msg.type === 'devReload') {
          // Dev preflight (scripts/preflight-panel.mjs) asks a stale panel to reload onto fresh code.
          this.reloadWorker();
        } else if (msg.type === 'workerInfo') {
          // Dev preflight queries the connected panel's build id to compare against the latest build.
          ws.send(JSON.stringify({ type: 'workerInfo', buildId: this.workerBuildId }));
        } else if (msg.type === 'backendInfo') {
          // Dev preflight queries THIS process's OWN baked build id (distinct from workerInfo, which
          // relays the PANEL's id) to detect a backend running stale code. Static baked constant.
          ws.send(JSON.stringify({ type: 'backendInfo', buildId: BACKEND_BUILD_ID }));
        } else if (CHAT_INBOUND_TYPES.has(msg.type)) {
          // Agent-chat channel: panel → loop (the full ChatInbound union — userChat/
          // cancel/queue/editQueue/removeQueue). The handler streams agentEvent
          // messages back over this same socket (see registerAgentChat in agentChat.ts).
          this.chatHandler?.(ws, msg as ChatInbound);
        } else if ('ok' in msg) {
          // Response from CEP panel to a pending command
          const pending = this.pending.get(msg.id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(msg.id);
          if (msg.ok) {
            this.lastResult = msg.result ?? '';
            pending.resolve(msg.result ?? '');
          } else {
            pending.reject(new BridgeError('AE_HANDLER_ERROR', msg.error ?? 'Unknown error from AE'));
          }
        } else if (msg.command !== undefined) {
          // Command from an external caller (e.g. test helper or direct WS client)
          this.routeExternalCommand(ws, msg as { id: string; command: string; args: object });
        }
      });

      ws.on('close', () => {
        clearTimeout(authTimer);
        this.authed.delete(ws);
        // Notify the chat layer so it can drop this socket from the re-attach fan-out set
        // (harmless for non-chat sockets — agentChat just won't find it in any set).
        this.chatCloseHandler?.(ws);
        if (this.workerClient === ws) {
          this.workerClient = null;
          this.workerBuildId = null;
          this.emit('disconnect');
          for (const [, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(new BridgeError('AE_DISCONNECTED', 'AE plugin disconnected'));
          }
          this.pending.clear();
        }
      });
    });
  }

  private routeExternalCommand(
    callerWs: WebSocket,
    msg: { id: string; command: string; args: object }
  ): void {
    // listCommands is resolved node-side — no round-trip to AE needed.
    // server/ai calls this to drift-check its COMMAND_NAMES mirror.
    if (msg.command === 'listCommands') {
      callerWs.send(JSON.stringify({ id: msg.id, ok: true, result: JSON.stringify([...COMMANDS]) }));
      return;
    }
    this.sendCommand(msg.command, msg.args, 30000)
      .then(result => callerWs.send(JSON.stringify({ id: msg.id, ok: true, result })))
      .catch(err => callerWs.send(JSON.stringify({ id: msg.id, ok: false, error: String(err) })));
  }

  async sendCommand(command: string, args: object = {}, timeoutMs = 10000): Promise<string> {
    if (!this.workerClient || this.workerClient.readyState !== WebSocket.OPEN) {
      await this.waitForWorker(3000);
    }
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError('TIMEOUT', `Command "${command}" timed out after ${timeoutMs}ms — AE may be busy`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.workerClient!.send(JSON.stringify({ id, command, args }));
    });
  }

  private waitForWorker(ms: number): Promise<void> {
    if (this.workerClient?.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          reject(new BridgeError(
            'AE_NOT_CONNECTED',
            'AE plugin not connected — open the Cubic panel in After Effects'
          ));
        }
      }, ms);
      this.connectWaiters.push(() => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }

  isConnected(): boolean {
    return this.workerClient !== null && this.workerClient.readyState === WebSocket.OPEN;
  }

  /** True when a panel is connected but running an OUTDATED build — its hello `buildId` no longer matches
   *  the panel this app version ships (`CUBIC_PANEL_BUILD_ID`, injected by Electron main). CEP loads the
   *  panel once at AE launch, so an app update that changed the panel leaves the running one stale until
   *  AE restarts → the renderer nudges "Restart After Effects" (§F-4). Unknown ids → false (never a false
   *  positive). */
  isWorkerStale(): boolean {
    const shipped = process.env.CUBIC_PANEL_BUILD_ID;
    return this.isConnected() && !!this.workerBuildId && !!shipped && this.workerBuildId !== shipped;
  }

  /** Ask the connected panel to reload (re-fetch main.js with the fresh baked-in bundle). Dev only —
   *  triggered by the preflight via the `devReload` control message. */
  reloadWorker(): void {
    if (this.workerClient?.readyState === WebSocket.OPEN) {
      this.workerClient.send(JSON.stringify({ type: 'reload' }));
    }
  }

  /**
   * Release the WS bridge: reject in-flight commands, drop the worker socket, and
   * close the listening server so the port is freed immediately. Called from the
   * process shutdown path so a terminating server never orphans its port.
   */
  close(): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new BridgeError('AE_DISCONNECTED', 'bridge shutting down'));
    }
    this.pending.clear();
    this.workerClient?.close();
    this.workerClient = null;
    this.wss?.close();
    this.wss = null;
  }

  on(event: BridgeEvent, handler: () => void): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
  }

  /**
   * Register the agent-chat handler. Inbound userChat/cancel/queue messages from the
   * panel are routed here; the handler streams agentEvent messages back over the
   * provided socket. Only one handler is supported (the agent loop owns it).
   */
  onChat(handler: ChatHandler): void {
    this.chatHandler = handler;
  }

  /** Register a callback fired when ANY socket closes, so the chat layer can remove it from its
   *  re-attach fan-out set. Only one handler is supported (the agent loop owns it). */
  onChatClose(handler: (ws: WebSocket) => void): void {
    this.chatCloseHandler = handler;
  }

  private emit(event: BridgeEvent): void {
    for (const h of this.eventHandlers.get(event) ?? []) h();
  }
}

export const bridge = new AEBridge();
