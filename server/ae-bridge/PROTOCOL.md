# Cubic bridge wire protocol

The stable contract between the Node backend and any host adapter (today: the After
Effects CEP worker; future: Premiere/DaVinci/etc.). **A host adapter only needs to
implement what's on this page** — nothing else in the codebase is part of the contract.

> Source of truth for the shapes: `src/bridge/wsBridge.ts` (`ChatInbound`, command
> routing), `server/ai/src/agent/events.ts` (`AgentEvent`), `src/scripts/mcp-bridge.jsx`
> (`ERROR_CODES`). If those drift from this doc, those win — update this doc.

## Transport

- **One WebSocket server** on `127.0.0.1:17923` (fixed; no fallback). Opened by the
  backend (`bridge.start()` in `wsBridge.ts`, spawned via `src/index.ts`). A port
  conflict is a hard error — only one backend runs at a time.
- Every message is a single JSON object, one per WS frame. Messages are dispatched by
  shape (see *Routing* below), not by a wrapping envelope.
- **Three kinds of client** connect to this one port:
  | Client | Role | Identifies itself by |
  |---|---|---|
  | CEP worker (the AE panel) | **Role B** — runs `evalScript`, the only client that executes commands in AE | sends `{type:"hello"}` on connect |
  | `server/ai` loopback (`mcpClient`) | the agent loop fetching live state / running tool calls | sends `{id,command,args}` |
  | Electron renderer (Phase 4) | the chat UI | sends chat-channel messages (`userChat`…) |

## Routing (how the backend tells messages apart)

In order, on each inbound message (`setupConnectionHandler` in `wsBridge.ts`):
1. `type === "hello"` → register/replace the single **worker** client.
2. `type ∈ ChatInbound` (`userChat`/`cancel`/`queue`/`editQueue`/`removeQueue`) → agent **chat channel**.
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
- Default command timeout: 10s (`mcpClient`) / 30s (external route in `routeExternalCommand`).

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
```
- `sessionId` is **renderer-minted** (uuid on "New chat"), used verbatim as the backend
  session-map key. Omitted → `"default"`.
- A `userChat` arriving mid-run is treated as a steer (queued, drained at the next
  iteration boundary) — mirrors Claude Code. `cancel` stops at the next boundary.
- `editQueue`/`removeQueue` revise a queued steer by `id` before it fires (no-op once drained).

Outbound (backend → UI) — one envelope, streamed per iteration as the turn runs:
```json
{ "type": "agentEvent", "sessionId": "<uuid>", "event": <AgentEvent> }
```
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

## Reserved (declared, not yet implemented)

Re-attach to an in-flight turn after a renderer reload (§0/§C2 in `TODOS/`). Planned shapes:
```json
{ "type": "attach",   "sessionId": "<uuid>" }
{ "type": "attached", "sessionId": "<uuid>", "running": true, "events": [ <AgentEvent>, ... ] }
```
Not routed today — listed so adapter authors know the namespace is taken.

## Who sends what (adapter checklist)

A new **host adapter** (Role B worker) must:
- Connect to `ws://127.0.0.1:17923` and send `{type:"hello"}`.
- Receive `{id,command,args}`, execute it in the host, reply `{id,ok,result}` /
  `{id,ok:false,error}`. Emit the structured-error shape above on domain failures.
- Reconnect automatically on socket close. It does **not** touch the chat channel.

A new **UI client** speaks Channel 2 only (`userChat`/`cancel`/`queue`/… in, `agentEvent` out).
