import { WebSocketServer, WebSocket } from 'ws';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { COMMANDS } from '../commands.js';

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
  type: 'userChat' | 'cancel' | 'queue' | 'editQueue' | 'removeQueue' | 'attach' | 'delete' | 'list' | 'loadHistory' | 'restore' | 'rename';
  sessionId?: string;
  text?: string;
  /** Queue item id (panel-generated for queue/editQueue/removeQueue). */
  id?: string;
  /** Pre-turn snapshot id to revert to (restore: "restore to before this request"). */
  turnId?: string;
  /** New conversation title (rename). */
  title?: string;
}

/** The `ChatInbound['type']` values, for routing. Keep in sync with the union above. */
const CHAT_INBOUND_TYPES = new Set<ChatInbound['type']>([
  'userChat', 'cancel', 'queue', 'editQueue', 'removeQueue', 'attach', 'delete', 'list', 'loadHistory', 'restore', 'rename',
]);

export type ChatHandler = (ws: WebSocket, msg: ChatInbound) => void;

class AEBridge {
  private wss: WebSocketServer | null = null;
  private workerClient: WebSocket | null = null;
  private pending: Map<string, PendingCommand> = new Map();
  private eventHandlers: Map<BridgeEvent, Array<() => void>> = new Map();
  private connectWaiters: Array<() => void> = [];
  private chatHandler: ChatHandler | null = null;
  private chatCloseHandler: ((ws: WebSocket) => void) | null = null;
  public lastResult: string = '';

  /**
   * Bind the single canonical port (17923) — no fallback scan. One backend + one CEP
   * worker connection at a time is the invariant; a port conflict means another Cubic
   * backend is already running (or one was orphaned), so we fail loudly instead of
   * silently binding a neighbour port where the new bridge sits blind (no panel
   * connected). The headless panel always dials this same port (cep-extension/src/main.js).
   */
  async start(port: number): Promise<void> {
    await this.bind(port);
    const bridgeDir = path.join(os.homedir(), '.ae-mcp-bridge');
    try {
      fs.mkdirSync(bridgeDir, { recursive: true });
      fs.writeFileSync(path.join(bridgeDir, 'port'), String(port), 'utf8');
    } catch { /* non-fatal */ }
    console.error(`WS bridge listening on 127.0.0.1:${port}`);
  }

  private bind(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: '127.0.0.1', port });
      wss.once('listening', () => {
        this.wss = wss;
        this.setupConnectionHandler();
        resolve();
      });
      wss.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(
            `A Cubic backend is already running on 127.0.0.1:${port} — close it first. ` +
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
      ws.on('message', (data) => {
        let msg: any;
        try { msg = JSON.parse(data.toString()); } catch { return; }

        if (msg.type === 'hello') {
          // CEP panel registering as the ExtendScript worker
          if (this.workerClient && this.workerClient !== ws) {
            this.workerClient.close(4000, 'superseded by new worker');
          }
          this.workerClient = ws;
          for (const w of this.connectWaiters) w();
          this.connectWaiters = [];
          this.emit('connect');
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
        // Notify the chat layer so it can drop this socket from the re-attach fan-out set
        // (harmless for non-chat sockets — agentChat just won't find it in any set).
        this.chatCloseHandler?.(ws);
        if (this.workerClient === ws) {
          this.workerClient = null;
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
            'AE plugin not connected — open the MCP Bridge panel in After Effects'
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
