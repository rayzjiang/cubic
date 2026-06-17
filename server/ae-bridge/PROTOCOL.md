# Cubic bridge wire protocol

The stable contract between the Node backend and any host adapter (today: the After
Effects CEP worker; future: Premiere/DaVinci/etc.). **A host adapter only needs to
implement what's on this page** — nothing else in the codebase is part of the contract.

> Source of truth for the shapes: `src/bridge/wsBridge.ts` (`ChatInbound`, command
> routing), `server/ai/src/agent/events.ts` (`AgentEvent`), `src/scripts/bridge.jsx`
> (`ERROR_CODES`). If those drift from this doc, those win — update this doc.

## Transport

- **One WebSocket server** on `127.0.0.1:17923` (fixed; no fallback). Opened by the
  backend (`bridge.start()` in `wsBridge.ts`, via the shared `startBackend()` — the app
  spawns `src/serve.ts`; the MCP dev entrypoint is `src/index.ts`). A port
  conflict is a hard error — only one backend runs at a time.
- Every message is a single JSON object, one per WS frame. Messages are dispatched by
  shape (see *Routing* below), not by a wrapping envelope.
- **Three kinds of client** connect to this one port:
  | Client | Role | Identifies itself by |
  |---|---|---|
  | CEP worker (the AE panel) | **Role B** — runs `evalScript`, the only client that executes commands in AE | sends `{type:"hello"}` on connect |
  | `server/ai` loopback (`bridgeClient`) | the agent loop fetching live state / running tool calls | sends `{id,command,args}` |
  | Electron renderer (Phase 4) | the chat UI | sends chat-channel messages (`userChat`…) |

  > The Electron renderer learns the port from the app's main process via a
  > `getBackendPort()` IPC (main owns the port and passes it to the spawned backend) —
  > it does **not** read `~/.ae-mcp-bridge/port`. That file is for the independently
  > launched CEP worker + loopback client.

## Routing (how the backend tells messages apart)

In order, on each inbound message (`setupConnectionHandler` in `wsBridge.ts`):
1. `type === "hello"` → register/replace the single **worker** client.
2. `type ∈ ChatInbound` (`userChat`/`cancel`/`queue`/`editQueue`/`removeQueue`/`attach`/`delete`/`list`/`loadHistory`) → agent **chat channel**.
3. has an `ok` field → a **command response** from the worker (correlated by `id`).
4. has a `command` field → a **command request** from an external caller.

## Channel 1 — Command / response (drive AE)

Request (backend → worker, or external caller → backend):
```json
{ "id": "<correlation-id>", "command": "createLayer", "args": { "type": "solid" } }
```
Response (worker → backend):
```json
{ "id": "<correlation-id>", "ok": true,  "result": "<JSON string>" }
{ "id": "<correlation-id>", "ok": false, "error":  "<message>" }
```
- `id` correlates request↔response (UUID or any unique string). `args` defaults to `{}`.
- `result` is a **string** — usually a JSON-encoded payload the caller parses; for a
  successful mutation it may be a plain status string.
- `command` names come from `src/commands.ts` (the `COMMANDS` registry). The special
  `listCommands` is answered **node-side** by the backend (returns the registry) — it
  never round-trips to the worker.
- Default command timeout: 10s (`bridgeClient`) / 30s (external route in `routeExternalCommand`).

### Structured handler errors (inside a successful `ok:true` response)
A command can *succeed at the transport level* (`ok:true`) but report a domain error in
its `result` JSON. A host adapter that executes commands should emit this shape on failure:
```json
{ "status": "error", "errorCode": "LAYER_NOT_FOUND", "message": "...", "line": 42 }
```
`errorCode` ∈ `COMP_NOT_FOUND`, `LAYER_NOT_FOUND`, `LAYER_INDEX_OOB`, `PROPERTY_NOT_FOUND`,
`INVALID_ARGS`, `TIME_OUT_OF_RANGE`, `RENDER_FAILED` (retryable), `UNKNOWN_COMMAND`,
`HANDLER_UNCAUGHT`, `INTERNAL_ERROR`, `BATCH_FAILED` (per-command codes in `results[]`).
Transport-level failures instead use `ok:false` + `error` (a `BridgeError` on the Node side).

## Channel 2 — Agent chat (drive the loop)

Inbound (UI → backend), the `ChatInbound` union:
```json
{ "type": "userChat",    "sessionId": "<uuid>", "text": "make it bounce" }
{ "type": "cancel",      "sessionId": "<uuid>" }
{ "type": "queue",       "sessionId": "<uuid>", "text": "...", "id": "<queue-item-id>" }
{ "type": "editQueue",   "sessionId": "<uuid>", "text": "...", "id": "<queue-item-id>" }
{ "type": "removeQueue", "sessionId": "<uuid>", "id": "<queue-item-id>" }
{ "type": "attach",      "sessionId": "<uuid>" }
{ "type": "delete",      "sessionId": "<uuid>" }
{ "type": "list" }
{ "type": "loadHistory", "sessionId": "<uuid>" }
{ "type": "restore",     "sessionId": "<uuid>", "turnId": "<ms-timestamp>" }
```
- `sessionId` is **renderer-minted** (uuid on "New chat"), used verbatim as the backend
  session-map key AND the persisted JSONL filename. Omitted → `"default"`.
- A `userChat` arriving mid-run is treated as a steer (queued, drained at the next
  iteration boundary) — mirrors Claude Code. `cancel` stops at the next boundary.
- `editQueue`/`removeQueue` revise a queued steer by `id` before it fires (no-op once drained).
- `attach` (re-attach after a renderer reload): the backend replies with one `attached` envelope
  (below) — the run state + the in-flight turn's events so far — so the renderer rejoins a live
  turn. Committed history loads separately from the JSONL store, so `attach` covers only the live
  turn. A cold conversation is rehydrated from disk on the first message for its `sessionId`.
- `delete`: removes a stored conversation (its JSONL + index entry) and drops it from memory.
  Fired from the sidebar list, so it may target **any** `sessionId`, not just the open one.
  **Refused while that conversation has a turn in flight** (replied as an `error` agentEvent).
- `list`: request the conversation list for the **currently-open AE project** (the backend resolves
  the project path itself). Replied with one `conversations` envelope (below).
- `loadHistory`: fetch one conversation's committed history (by `sessionId`) as renderable
  `DisplayItem[]`. Read from the JSONL store (full untrimmed transcript). Replied with one `history`
  envelope (below).
- `restore` ("restore to before this request"): revert the AE project to the `turnId`'s pre-turn
  backup AND rewind the saved transcript to before that turn (one-way — newer backups pruned, history
  truncated). `turnId` comes from the prompt's `DisplayItem.user.turnId` (or the live `snapshot` event).
  Refused while a turn is in flight. Replied with one `restored` envelope (below).

Outbound (backend → UI) — streamed per iteration as the turn runs, plus the one-shot replies:
```json
{ "type": "agentEvent",    "sessionId": "<uuid>", "event": <AgentEvent> }
{ "type": "attached",      "sessionId": "<uuid>", "running": true, "events": [ <AgentEvent>, ... ], "userText": "<in-flight prompt | omitted>" }
{ "type": "conversations", "projectPath": "<path>", "conversations": [ <ConversationMeta>, ... ] }
{ "type": "history",       "sessionId": "<uuid>", "items": [ <DisplayItem>, ... ], "running": false }
{ "type": "restored",      "sessionId": "<uuid>", "ok": true, "message": "<reason when ok:false>" }
{ "type": "aeStatus",      "connected": true }
```
`conversations` is scoped to the current project, newest-first (`ConversationMeta` = id, title,
projectPath, lastActivity, renamed — see `src/persist.ts`). `history.items` is a flat
`DisplayItem[]` (`{kind:'user'|'assistant',text}` or `{kind:'tool',id,label,status:'ok'|'fail'}`,
source of truth `src/displayItems.ts`); the renderer's live `agentEvent` reducer produces the same
shape so history + live turn share one render path. `history.running` flags an in-flight turn.
`aeStatus` reports live AE (CEP worker) connectivity for the always-on status dot: pushed once on the
`list` handshake (so a fresh renderer starts correct) and re-broadcast to every chat socket on each
bridge connect/disconnect. App-global (no `sessionId`) — distinct from a renderer's own backend link.
`agentEvent` fans out to every socket attached to the session (the original sender + any reloaded
renderer). `attached` is the direct reply to an `attach`: `running` drives the spinner/Stop button,
`events` replays the in-flight turn so the renderer catches up with no gap and no dup, and `userText`
(present only while running) is the in-flight turn's prompt — not yet committed to history nor an
event, so the reloaded renderer needs it to render the prompt bubble above the replayed events.
`AgentEvent` (`server/ai/src/agent/events.ts`) is a tagged union:
| `event.type` | meaning / key fields |
|---|---|
| `turn_start` | turn began |
| `snapshot` | pre-turn `.aep` backup — `ok`, `path?`, `reason?` |
| `text` | assistant narration — `text` |
| `tool_start` | `id`, `name`, `label` (human-readable, never raw JSON) |
| `tool_end` | `id`, `ok`, `errorCode?`, `retried?` |
| `steer` | a queued steer was consumed — `id`, `text` |
| `cancelled` | turn stopped by `cancel` |
| `compaction` | history compaction — `status: start\|done\|failed`, `reason?` (a `done`/`cleared` also covers `/clear`). A subtle indicator, **not** an error. |
| `context_full` | hard ceiling — `message`. A "start a new chat" CTA, **not** an error. |
| `error` | `message` (raw SDK text; the UI renders it friendly) |
| `done` | turn finished — `stopReason` |

## Persistence (backend-side, not part of the wire contract)

Conversations are stored as append-only JSONL (one `Message`/line, full history — compaction trims
only the model context, never disk) at `~/.cubic/sessions/<encoded-project-path>/<sessionId>.jsonl`,
with a global `~/.cubic/sessions/index.json` (id, title, projectPath, lastActivity, renamed). This
is internal to the backend (`src/persist.ts`); UI clients never read these files — they drive the
list via the `list` → `conversations` query and `delete`, and load a conversation's transcript via
`loadHistory` → `history` (backend transforms `Message[]` → `DisplayItem[]` in `src/displayItems.ts`).

## Who sends what (adapter checklist)

A new **host adapter** (Role B worker) must:
- Connect to `ws://127.0.0.1:17923` and send `{type:"hello"}`.
- Receive `{id,command,args}`, execute it in the host, reply `{id,ok,result}` /
  `{id,ok:false,error}`. Emit the structured-error shape above on domain failures.
- Reconnect automatically on socket close. It does **not** touch the chat channel.

A new **UI client** speaks Channel 2 only (`userChat`/`cancel`/`queue`/`attach`/`delete`/`list`/
`loadHistory` in; `agentEvent`/`attached`/`conversations`/`history`/`aeStatus` out).
