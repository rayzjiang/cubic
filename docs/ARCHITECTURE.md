# Cubic — Architecture

This document explains the whole system: the parts, how they communicate, and what
happens end-to-end when you use the app. Read it top to bottom and you should be able
to find and modify any part of Cubic with confidence.

> **Product, in one line:** Cubic is an AI agent that builds native After Effects
> animations from natural language. You chat; it reads your live AE project, decides
> what to do, and writes the animation directly into your comp — recovering from
> errors on its own.

---

## 1. Concepts you need first

The system is several **separate programs running at once**, passing messages. Four
ideas explain all of it:

- **Process** — a running program. Launching Cubic starts *multiple* cooperating
  programs; After Effects is its own program too. They can't read each other's
  memory — they only exchange *messages*.
- **IPC (Inter-Process Communication)** — Electron's built-in "intercom" between two
  parts of the desktop app on the same machine. Cubic uses it for exactly one thing:
  the UI asking the launcher *"what port is the backend on?"*
- **WebSocket** — a network connection that stays *open* so both sides can send
  messages anytime, in both directions. This is the main nervous system of Cubic: the
  AI streams live progress to the UI, and AE streams results back, over open
  WebSocket lines.
- **Port** — a numbered "door" a program listens on. The backend listens on port
  **17923**. Everything that wants to talk to it connects to `127.0.0.1:17923`
  (`127.0.0.1` = "this same computer").

Keep **process, IPC, WebSocket, port** in mind and the rest follows.

---

## 2. The big picture — four programs in a ring

When Cubic runs, four separate programs cooperate. The **Backend is a switchboard in
the middle**: the UI, the Claude brain, and the AE panel are all just *clients* that
connect to it over the same WebSocket port. Nobody talks to anyone directly —
everything is routed through the backend.

```
┌────────────────────┐                      ┌──────────────────────────────┐
│  1. The UI          │   (1) IPC: "port?"   │  The Launcher                 │
│  React chat app     │◄────────────────────►│  (Electron main process)      │
│  what you SEE        │                      │  opens window, starts backend │
└─────────┬──────────┘                       └───────────────┬──────────────┘
          │                                                   │ spawns
          │  (2) WebSocket  ws://127.0.0.1:17923              ▼
          └──────────────────────────────────►┌──────────────────────────────┐
                                               │  2. The Backend               │
          ┌──────────────────────────────────►│  • WebSocket bridge (router)  │
          │  (2) same WebSocket port           │  • Claude brain (agent loop)  │
          │                                    └──────────────────────────────┘
          ▼
┌────────────────────┐
│  3. The AE panel    │  (3) runs ExtendScript code *inside* After Effects
│  (CEP, inside AE)   │
└────────────────────┘
```

| # | Program | What it is | Lives in |
|---|---------|------------|----------|
| 1 | **The UI** | The chat window you see and type into. A sandboxed React web app. | `app/src/renderer/` |
| — | **The Launcher** | Electron's "main process." Opens the OS window, starts the backend, hands off the port, then steps aside. | `app/src/main/` |
| 2 | **The Backend** | One program, two jobs: the **WebSocket bridge** (message router) and the **Claude brain** (the agent). | `server/ae-bridge/` + `server/ai/` |
| 3 | **The AE panel** | A small headless extension loaded *inside* After Effects that runs the actual animation code. | `server/ae-bridge/cep-extension/` |

The repo is a **monorepo of three packages** with no root `package.json`: `app/`
(programs 1 + launcher), `server/ae-bridge/` (the bridge + AE panel + handlers), and
`server/ai/` (the Claude brain). `ae-bridge` depends on `ai` as a local package.

---

## 3. How they connect (the wiring, start to finish)

1. You launch Cubic → the **Launcher** (`app/src/main/index.ts`) starts.
2. The Launcher reads config (`app/src/main/config.ts`, default port 17923) and
   **spawns the Backend** as a child process
   (`app/src/main/backend.ts` → `BackendSupervisor.start()`, which runs
   `server/ae-bridge/build/serve.js`).
3. The Backend opens the WebSocket door on 17923
   (`server/ae-bridge/src/bridge/wsBridge.ts` → `start()`).
4. The Launcher opens the window (`app/src/main/window.ts`) and loads the **UI**.
5. The UI is sandboxed and doesn't know the port, so it asks via **IPC**:
   `window.cubic.getBackendPort()` → answered in `app/src/main/ipc.ts`. (The only
   bridge between the sandbox and the launcher is `app/src/preload/index.ts`, which
   safely exposes that single function — nothing else.)
6. The UI opens its **WebSocket** to `ws://127.0.0.1:17923`
   (`app/src/renderer/src/ws.ts` → `connectBackend()`).
7. Separately, the **AE panel** inside After Effects connects to the same port and
   announces itself with `{type:"hello"}`
   (`server/ae-bridge/cep-extension/src/main.js` → `connect()`).
8. The **Claude brain** runs inside the Backend process and connects to the bridge as
   a loopback client (`server/ai/src/bridge/client.ts`).

Now all three clients (UI, AE panel, brain) share one switchboard, and Cubic is live.

---

## 4. The wire protocol (the contract everyone speaks)

All messages are JSON over the WebSocket. There are two logical channels. The full
spec is in [`server/ae-bridge/PROTOCOL.md`](../server/ae-bridge/PROTOCOL.md); the
essentials:

**Command channel** — drives After Effects (used by the brain → bridge → AE panel):

```jsonc
→ { "id": "abc", "command": "createLayer", "args": { "type": "solid" } }
← { "id": "abc", "ok": true,  "result": "<JSON string>" }   // success
← { "id": "abc", "ok": false, "error": "<message>" }        // transport failure
```

The **`id` is the key trick.** A WebSocket is asynchronous — answers arrive later and
possibly out of order. So every request is stamped with a unique id; the reply carries
the same id; the bridge matches them to wake the right caller. One open line can juggle
many simultaneous commands without confusing the answers. If no reply arrives within
~10s, a timer reports a timeout instead of hanging.

A successful `result` can still describe a *handler* error from inside AE, e.g.
`{ "status":"error", "errorCode":"LAYER_NOT_FOUND", "message":"..." }`. These are
what the agent self-heals from (Section 7).

**Chat channel** — drives the agent (used by the UI ↔ backend):

```jsonc
→ { "type": "userChat", "sessionId": "...", "text": "make this text pop in" }
→ { "type": "cancel" | "queue" | "attach" | "list" | "loadHistory", ... }
← { "type": "agentEvent", "sessionId": "...", "event": <AgentEvent> }
← { "type": "conversations" | "history" | "attached", ... }
```

`AgentEvent`s are streamed live during a turn: `turn_start`, `snapshot`, `text`
(narration), `tool_start`, `tool_end`, `steer`, `compaction`, `context_full`,
`error`, `cancelled`, `done`.

---

## 5. The four programs in detail (and where to edit each)

### 5.1 The UI — `app/src/renderer/`

An ordinary React web app, **sandboxed** (it cannot touch files or AE directly — only
send/receive WebSocket messages).

| To change… | Look at |
|---|---|
| Window layout / home vs. chat view | `src/App.tsx` |
| The transcript (message list) | `src/components/MessageList.tsx` |
| The input box | `src/components/InputBar.tsx` |
| The conversation sidebar | `src/components/Sidebar.tsx` |
| **All UI state** (messages, connection, current chat) | `src/store.ts` |
| WebSocket connect/send/receive | `src/ws.ts` |
| Message shapes shared with backend | `src/protocol.ts` |

The most important file is **`store.ts`** — a single shared state box (using the
**Zustand** library). Components read from it and re-render automatically. Incoming
`agentEvent`s are applied by `foldEvent()`, which updates the box and thus the screen.
If the UI ever shows something wrong, the truth lives here.

### 5.2 The Launcher — `app/src/main/`

Starts everything, then gets out of the way.

| Responsibility | File / symbol |
|---|---|
| Boot sequence | `index.ts` |
| Open the OS window | `window.ts` → `createWindow()` |
| **Spawn + supervise the backend** | `backend.ts` → `BackendSupervisor.start()` |
| Config (port, environment) | `config.ts` → `loadConfig()` |
| Answer "what port?" over IPC | `ipc.ts` (handles `cubic:getBackendPort`) |
| Sandbox-safe IPC surface | `../preload/index.ts` |

### 5.3 The Backend, part A — the WebSocket bridge — `server/ae-bridge/`

The switchboard. Core file: **`src/bridge/wsBridge.ts`**.

It opens port 17923 and tells clients apart by their first message: the AE panel says
`{type:"hello"}` (tagged "the worker" — the *only* client allowed to run AE code); the
UI sends chat messages; the brain sends commands. `sendCommand()` implements the
id-matching described in Section 4.

| To change… | Look at |
|---|---|
| Connection handling / message routing | `src/bridge/wsBridge.ts` |
| The message contract | `PROTOCOL.md` |
| What the backend does on startup | `src/serve.ts` (this is what the Launcher runs) |
| Dev/Claude-Code entrypoint (MCP over stdio) | `src/index.ts` |
| Chat session wiring, persistence, reattach | `src/agentChat.ts`, `src/persist.ts`, `src/reattach.ts` |

Two entrypoints share the same core (`src/startBackend.ts`): **`serve.ts`** is what
the Electron app spawns; **`index.ts`** exposes the same backend as an MCP server over
stdio for development in Claude Code. The Electron app never uses `index.ts`.

### 5.4 The AE panel + handlers — `server/ae-bridge/`

After Effects only runs an old Adobe dialect called **ExtendScript**, so the actual
animation logic lives in `.jsx` files that run *inside* AE.

- **The panel** (`cep-extension/src/main.js`) is a tiny invisible extension loaded via
  Adobe's **CEP** system. It connects to the bridge, waits for `{id, command, args}`,
  runs the matching ExtendScript via `evalScript`, and returns `{id, ok, result}`. It
  auto-reconnects if the line drops.
- **The handlers** (`src/scripts/*.jsx`) are the real code, by topic:

| File | Controls in AE |
|---|---|
| `compositions.jsx` | Comps: create, list, properties, save frame to PNG |
| `layers.jsx` | Layers: create, move, parent, precompose, track mattes, properties |
| `text.jsx` / `shapes.jsx` | Text layers + animators / shape layers + operators |
| `animation.jsx` | **Keyframes, easing, expressions, motion recipes** |
| `effects.jsx` | Apply / configure effects |
| `masks.jsx`, `footage.jsx`, `markers.jsx`, `project.jsx` | Masks, media import, markers, save/backup/restore |
| `bridge.jsx` | **The dispatcher** — a `switch` mapping command name → handler, plus undo grouping |

Flow inside AE: `command:"createLayer"` → `bridge.jsx` switch → `createLayer()` in
`layers.jsx`. A build step bundles all `.jsx` together and installs the panel
(`npm run build:plugin` / `install-plugin`). Every mutation is wrapped in an **undo
group**, so one Cubic operation = one ⌘Z in After Effects.

**To add a new AE capability:** write the handler here *and* register it in the brain's
command registry (Section 5.5) — the two must stay in sync.

### 5.5 The Backend, part B — the Claude brain — `server/ai/`

The intelligence: it talks to Claude, decides which AE commands to run, runs them,
recovers from errors, and repeats. Core: **`src/agent/loop.ts` → `runAgentTurn()`**.

| To change… | Look at |
|---|---|
| Loop logic, iteration cap, cancel/steer, snapshots | `src/agent/loop.ts` |
| **Claude's personality + rules + motion principles** | `src/prompt/rules.ts` |
| **The commands the AI is allowed to use** (source of truth) | `src/tools/command-params.ts` |
| Tool schemas sent to the API | `src/tools/definitions.ts` |
| Turn a Claude tool-call into an AE command | `src/agent/executeTool.ts` |
| Anthropic API wrapper / model choice | `src/llm/anthropic.ts` → `defaultModel()` (`CUBIC_MODEL`) |
| Fetch + cache + format live AE state | `src/context/` |
| The brain's own WebSocket client | `src/bridge/client.ts` |
| Memory / summarization | `src/agent/compaction.ts` |

**A "turn"** is one round-trip from your message to the agent saying `done`. Inside a
turn the brain may loop up to **15 iterations**:

1. **Look at AE** — fetch selection, playhead, comp info (`context/buildContext.ts`).
2. **Write Claude's instructions** — permanent rules + command catalog + live AE
   snapshot (`prompt/`). The stable rules+catalog are marked for **prompt caching**
   (~90% cheaper re-reads); only the live state changes each turn.
3. **Ask Claude** (`llm/anthropic.ts`).
4. **Did Claude request tools?** **No →** turn ends. **Yes →** run each via the bridge
   (`executeTool.ts`), collect results (including errors), feed them back, **go to 3.**

**Single source of truth:** every command is declared once in
`tools/command-params.ts`. The catalog Claude reads, the API tool schemas, and a drift
test against the real AE handlers all derive from that one file, so they can't silently
diverge.

### Tool surfaces — 3 vs 4

Two surfaces on two entrypoints, don't conflate:
- **UI users → 3 tools.** `serve.ts` → agent loop = `AE_TOOLS` (`tools/definitions.ts`):
  `runScript`, `batch`, `createComposition`. The real product surface.
- **MCP dev path → 4 tools.** `index.ts` `registerTool` (Claude Code over stdio):
  `runScript`, `getHelp`, `runBridgeTest`, `createComposition`. The app never uses it.

Extras differ per surface: the AI gets `batch` (own array+`groupLabel` schema, one ⌘Z/turn
— not `runScript({script:"batch"})`); MCP gets `getHelp`/`runBridgeTest` diagnostics the AI
skips (it already has the full catalog in-prompt). `createComposition` is typed on both for
schema guidance + local Zod validation before hitting AE; every other verb stays behind `runScript`.

---

## 6. Sessions, persistence, and reconnect

- Every conversation is saved to disk as an append-only **JSONL** file (one line per
  message), per AE project (`server/ae-bridge/src/persist.ts`). History survives app
  restarts and crashes.
- During a live turn, events are also buffered in memory so a reloaded UI can
  **re-attach** and replay what it missed (`src/reattach.ts`). Events fan out to every
  socket attached to that session.
- `src/displayItems.ts` converts stored messages into the renderable items the UI
  shows.

---

## 7. The behaviors that make Cubic feel smart

- **Self-healing.** When an AE command fails (e.g. `LAYER_NOT_FOUND`), the brain does
  *not* crash. `executeTool.ts` packages the error as a normal tool *result*;
  `loop.ts` feeds it back to Claude, which re-checks state and retries a corrected
  approach on the next iteration. It heals *forward* — there is no automatic undo.
  Transient errors like `RENDER_FAILED` are retried once automatically.
- **Snapshots.** Before each turn, the project `.aep` is backed up to a
  `.cubic-backups/` folder (`loop.ts` → `snapshotProject()`), so a bad turn can be
  reverted explicitly.
- **Memory / compaction.** Claude's context window is finite. Full history lives on
  disk forever, but when the *active* context passes ~90% full, older turns are
  auto-summarized (keeping the last 3 user messages verbatim); at 97% the agent pauses
  and asks for a new chat (`src/agent/compaction.ts`).
- **Cancel & steer.** You can stop a run (Esc) or queue follow-up messages mid-turn;
  the loop checks for these at safe iteration boundaries so a task always finishes
  before queued input is processed (`loop.ts`).

---

## 8. End-to-end walkthrough: "make this text pop in"

1. **UI captures it.** `InputBar.tsx` (Enter) → `sendMessage()` in `store.ts`.
2. **UI sends it.** `store.ts` adds your message to the transcript; `ws.ts` pushes
   `{type:"userChat", text:"make this text pop in"}` to the backend.
3. **Bridge routes it.** `wsBridge.ts` sees a chat message → `agentChat.ts` starts a
   turn → `runAgentTurn()` in the brain.
4. **Brain looks at AE.** `buildContext()` sends read-only commands through the bridge
   → AE panel → AE answers "selected layer is text 'Title' at index 2." A snapshot is
   saved.
5. **Brain asks Claude** with rules + catalog + live state + your message. Claude
   replies with narration plus a tool call — the model's surface is the parameterized
   `runScript`, so it sends
   `runScript(script:"applyMotionRecipe", parameters:{recipe:"popIn", layerIndices:[2]})`.
6. **Brain runs the tool.** `executeTool.ts` → `{id, command:"applyMotionRecipe", ...}`
   → bridge → AE panel → `bridge.jsx` switch → `applyMotionRecipe()` in `animation.jsx`
   sets real keyframes (in one undo group).
7. **Result returns** (`{id, ok:true}`) → bridge → brain.
8. **Brain asks Claude again** with the result; Claude calls no more tools → `done`.
9. **The UI updated live the whole time** — every step streamed back as `agentEvent`s
   and applied by `foldEvent()` in `store.ts`.

If step 6 had failed (wrong index → `LAYER_NOT_FOUND`), step 7's error would be fed
back to Claude, which would re-read the selection, find the right index, and retry —
all within the same turn (Section 7, self-healing).

---

## 9. Quick reference — "where do I change X?"

| I want to… | Go to |
|---|---|
| Change how the chat **looks** | `app/src/renderer/src/components/` |
| Fix wrong UI state / display | `app/src/renderer/src/store.ts` |
| Change the AI's **personality / rules** | `server/ai/src/prompt/rules.ts` |
| **Add an AE capability** | `server/ae-bridge/src/scripts/*.jsx` **+** `server/ai/src/tools/command-params.ts` |
| Change which **model** runs | `CUBIC_MODEL` env var (sonnet/haiku/opus) |
| Change loop behavior (retries, cap, healing) | `server/ai/src/agent/loop.ts` |
| Change the message **contract** | `server/ae-bridge/PROTOCOL.md` + matching code |
| Change **memory / summarization** | `server/ai/src/agent/compaction.ts` |
| Change **startup / window / port** | `app/src/main/` |

---

## 10. Tech stack

| Layer | Tech |
|-------|------|
| Desktop app | Electron, React, Zustand, Tailwind CSS, TypeScript |
| Build | electron-vite, esbuild |
| Transport | WebSocket (`ws`), Electron IPC |
| AI | Anthropic SDK (Claude Sonnet 4.6 default; `haiku` / `opus` via `CUBIC_MODEL`) |
| AE scripting | ExtendScript via a CEP extension |
| Validation / data | Zod, JSON/JSONL files |
| Testing | Vitest + live tests against AE |

For build/run instructions and project status, see the root
[`README.md`](../README.md); for the message contract, see
[`server/ae-bridge/PROTOCOL.md`](../server/ae-bridge/PROTOCOL.md); for product vision
and roadmap, see [`PRD.md`](PRD.md) and [`TODOS/`](../TODOS).
```