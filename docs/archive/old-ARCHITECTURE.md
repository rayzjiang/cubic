# Cubic — Architecture

This document explains the whole system: the parts, how they communicate, and what
happens end-to-end when you use the app. Read it top to bottom and you should be able
to find and modify any part of Cubic with confidence.

> **Product, in one line:** Cubic is an AI agent that builds native After Effects
> animations from natural language. You chat; it reads your live AE project, decides
> what to do, and writes the animation directly into your comp — recovering from
> errors on its own.

### How this document is organized

This doc is in two halves plus a workflows section. Read the part you need:

- **Part I — The codebase today** (§1-10). The system exactly as it is built and runs
  right now: four programs on one machine, the brain talking to Anthropic directly with
  a local key. This is what you get from `npm run dev`. **Everything here exists today.**
- **Part II — The production system after Phase 5.** The planned hosted design: the
  shipped app no longer holds the Anthropic key or the secret prompt — a hosted proxy
  does, behind sign-in and billing. **None of Part II is built yet** (Phase 5 has not
  started); it is the target documented in [`TODOS/TODO-phase5.md`](../TODOS/TODO-phase5.md).
- **Dev & test workflows.** The four ways to run Cubic and what infrastructure (and cost)
  each one touches — useful for picking a mode without burning cloud or token spend.

Part I and Part II describe the *same* local programs; Part II only adds a cloud tier and
re-points one call. Wherever they differ, Part II says so explicitly.

---

# Part I — The codebase today

> **Current as of 2026-06-21 (pre-Phase-5).** This part describes the system that runs
> from `npm run dev` on the developer's machine, with no hosted services involved. It is
> the live, built architecture. Part II (further down) covers the planned production
> design layered on top of it.

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
- **Port** — a numbered "door" a program listens on. The backend asks the OS for a **free
  port** at launch (so a port conflict can never make startup fail) and publishes which one it
  got; everything that wants to talk to it connects to `127.0.0.1:<that port>` (`127.0.0.1` =
  "this same computer"). To keep out impostors (e.g. a malicious web page that also knows how to
  dial `localhost`), the backend mints a **per-launch token** and drops any socket that doesn't
  present it.

Keep **process, IPC, WebSocket, port** in mind and the rest follows.

---

## 2. The big picture — four programs in a ring

When Cubic runs, four separate programs cooperate. The **Backend is a switchboard in
the middle**: the UI, the Claude brain, and the AE panel are all just *clients* that
connect to it over the same WebSocket port. Nobody talks to anyone directly —
everything is routed through the backend.

```
┌────────────────────┐                       ┌───────────────────────────────┐
│  1. The UI         │   (1) IPC: "port?"    │  The Launcher                 │
│  React chat app    │◄────────────────────► │  (Electron main process)      │
│  what you SEE      │                       │  opens window, starts backend │
└─────────┬──────────┘                       └───────────────┬───────────────┘
          │                                                  │ spawns
          │  (2) WebSocket  ws://127.0.0.1:<port>  (token-authed)  ▼
          └──────────────────────────────────► ┌──────────────────────────────┐
                                               │  2. The Backend              │
          ┌──────────────────────────────────► │  • WebSocket bridge (router) │
          │  (2) same WebSocket port           │  • Claude brain (agent loop) │
          │                                    └──────────────────────────────┘
          ▼
┌────────────────────┐
│  3. The AE panel   │  (3) runs ExtendScript code *inside* After Effects
│  (CEP, inside AE)  │
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
2. The Launcher **spawns the Backend** as a child process, over an IPC channel
   (`app/src/main/backend.ts` → `BackendSupervisor.start()`, which runs
   `server/ae-bridge/build/serve.js`). It no longer decides the port.
3. The Backend opens the WebSocket door on an **OS-assigned free port** (`bind 127.0.0.1:0`),
   mints a **per-launch token**, writes both to `~/.cubic/conn.json`, and **reports `{port, token}`
   back up** to the Launcher over the IPC channel
   (`server/ae-bridge/src/bridge/wsBridge.ts` → `start()`; report in `startBackend.ts`).
4. The Launcher opens the window (`app/src/main/window.ts`) and loads the **UI**.
5. The UI is sandboxed and doesn't know the connection, so it asks via **IPC**:
   `window.cubic.getBackendPort()` → resolves `{port, token}` once the backend reported them
   (`app/src/main/ipc.ts`). (The only bridge between the sandbox and the launcher is
   `app/src/preload/index.ts`, which safely exposes that single function — nothing else.)
6. The UI opens its **WebSocket** to `ws://127.0.0.1:<port>` and authenticates by sending
   `{type:"hello", token, role:"ui"}` as its first frame
   (`app/src/renderer/src/ws.ts` → `connectBackend()`).
7. Separately, the **AE panel** inside After Effects reads `~/.cubic/conn.json`, connects to the
   same port, and announces itself with `{type:"hello", token, role:"worker", buildId}`
   (`server/ae-bridge/cep-extension/src/main.js` → `connect()`).
8. The **Claude brain** runs inside the Backend process and connects to the bridge as
   a loopback client (reads `conn.json`, sends its own authed `hello` — `server/ai/src/bridge/client.ts`).

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
| **Spawn + supervise the backend** (+ receive its `{port, token}` report) | `backend.ts` → `BackendSupervisor.start()` |
| Config (environment; the backend owns the port) | `config.ts` → `loadConfig()` |
| Answer "what port + token?" over IPC | `ipc.ts` (handles `cubic:getBackendPort` → `{port, token}`) |
| Sandbox-safe IPC surface | `../preload/index.ts` |

### 5.3 The Backend, part A — the WebSocket bridge — `server/ae-bridge/`

The switchboard. Core file: **`src/bridge/wsBridge.ts`**.

It opens an OS-assigned port (`bind 127.0.0.1:0`), requires a per-launch token in each socket's
first `hello` frame (else it drops the socket), and tells authenticated clients apart by their
messages: the AE panel's hello is tagged "the worker" (`role:"worker"` — the *only* client allowed
to run AE code); the UI sends chat messages; the brain sends commands. `sendCommand()` implements
the id-matching described in Section 4.

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

---

# Part II — Production system design (after Phase 5)

> **Planned, not yet built.** Nothing in this part exists in the codebase today — Phase 5
> has not started. This is the target architecture for the first public, paid release.
> The authoritative spec (every component, with rationale and a build order) is
> [`TODOS/TODO-phase5.md`](../TODOS/TODO-phase5.md); this section is the architectural
> map, not a substitute for it. Section IDs below (§A, §B, …) point into that spec.

The whole of Part I keeps running unchanged in production — the four local programs, the
WebSocket switchboard, the agent loop, the ExtendScript handlers. Part II only **adds a
cloud tier** and **re-points one call**. If you understand Part I, you already understand
90% of production.

## 11. The one change that matters — inversion of trust

Today the shipped machine holds three secrets: the **Anthropic API key**, the **system
prompt** (`prompt/rules.ts`), and the **tool definitions** (`tools/definitions.ts`). That
is fine on the developer's laptop; it is fatal once strangers can install the app — anyone
could extract the key (and spend your money) or lift the prompt (the product's IP).

Phase 5 inverts this. A **hosted proxy** (a Cloudflare Worker) takes custody of all three.
The shipped app keeps only the parts that *must* be local because they drive After Effects:
the agent loop, tool dispatch, and the ExtendScript handlers. Only the tool **names** ship;
their meanings, the prompt, and the key live server-side.

So the brain no longer calls Anthropic directly. It calls the proxy with a **sign-in token**;
the proxy checks you are signed in (§B) and paid up (§C), meters your usage (§A), injects the
secret prompt + tool catalog + key, forwards to Anthropic, and streams the answer back. The
brain receives the same `tool_use` it gets today and dispatches it locally to AE, exactly as
in Part I §8. The loop is unchanged; only its *first hop* moved.

## 12. The whole system, deployed in prod

Two tiers. The **on-device tier** is Part I, untouched. The **cloud tier** is new. The only
wire that crosses between them for an AI turn is the brain → proxy call.

```
ON-DEVICE  (the user's signed, installed app)            CLOUD  (hosted services)
┌──────────────────────────────────────────┐
│  1. The UI (React)                         │  sign-in / pay (system browser)
│     + sign-in, paywall, account menu  ─────┼───────────────►  Google / Apple OAuth
│                                            │                        │
│  The Launcher (Electron main)              │                        ▼
│     CUBIC_ENV=prod, deep-link cubic://,   │◄── cubic:// ──┐  ┌──────────────────────┐
│     session in OS keychain (safeStorage)   │   redirect    └──│  Supabase             │
└───────────────┬────────────────────────────┘                  │  • Auth (OAuth)  (§B) │
                │ local WebSocket (authenticated, dynamic port)  │  • Postgres:          │
   ┌────────────┴───────────────┐                                │    subscriptions/     │
   │  2. The Backend             │                               │    usage         (§C) │
   │   • WS bridge (router)      │                               └──────┬──────▲─────────┘
   │   • Claude brain (loop) ────┼── HTTPS + sign-in token ──┐    verify │ meter│ entitlement
   └────────────┬───────────────┘                           │           ▼      │
                │ runs ExtendScript                          │    ┌─────────────┴─────────┐
                ▼                                            └───►│  Cloudflare Worker     │
   ┌────────────────────────────┐                                │  = the proxy      (§A) │
   │  3. The AE panel (CEP)      │                                │  holds KEY + PROMPT +  │
   │     inside After Effects    │                                │  tool defs; gates +    │
   └────────────────────────────┘                                │  meters every call     │
                                                                  └──────────┬─────────────┘
   app  ◄── signed update feed ──  Cloudflare R2  (§F)                       │ inject + forward
   backend  ── events ──►  PostHog  (§H)                                     ▼
   Stripe  (Checkout/Portal + webhooks → Supabase)  (§C)            Anthropic API (Claude)
```

The on-device half is identical to Part I §2 — the four programs in a ring. Everything to
the right of the dividing line is new and hosted.

## 13. What stays local vs what moves to the cloud

| Stays **on-device** (drives AE, must be local) | Moves to the **cloud** (secrets / shared state) |
|---|---|
| Agent loop, iteration/cancel/steer (`agent/loop.ts`) | Anthropic **API key** (Worker secret) |
| Tool **dispatch** + `executeTool.ts` | **System prompt** (`prompt/rules.ts`) |
| ExtendScript handlers (`scripts/*.jsx`) | **Tool definitions / schemas** (`tools/definitions.ts`) |
| WebSocket bridge (`wsBridge.ts`) | Auth + identity (Supabase) |
| Live AE state fetch (`context/`) | Billing + entitlement (Stripe → Supabase `subscriptions`) |
| The UI, the Launcher | Usage metering + rate-limit (proxy) |
| | Update feed (R2), analytics (PostHog) |

The local list is "anything that touches AE or the user's screen." The cloud list is
"anything that is a secret or must be shared/enforced across all users."

## 14. The cloud components (and why)

Each maps to a section of [`TODO-phase5.md`](../TODOS/TODO-phase5.md); rationale lives there
as `WHY:` notes — not duplicated here.

| Component | Role in production | Spec |
|---|---|---|
| **Cloudflare Worker** (the proxy) | Holds key + prompt + tool defs; verifies sign-in, checks entitlement, meters usage, rate-limits, then forwards to Anthropic and streams back. Gates everything. | §A |
| **Supabase Auth** | Google / Apple sign-in (OAuth only — the audience is non-technical). Issues the token the proxy verifies. | §B |
| **Supabase Postgres** | `subscriptions` table = the single source of truth for "is this user paid," written only by Stripe webhooks; plus usage rows. | §C |
| **Stripe** | Hosted Checkout + Customer Portal (no payment UI to build); webhooks sync paid-state into Supabase. | §C |
| **Cloudflare R2** | Object storage holding signed update artifacts + `latest.yml` for the auto-updater. | §F |
| **PostHog** | Product analytics — verb usage, activation + conversion funnels. Fired server-side from the backend; no prompt or project content ever sent. | §H |

## 15. Key production flows

Same walkthrough style as Part I §8. Each is new in Phase 5.

- **Sign-in (§B).** The app opens the *system browser* to Google/Apple → Supabase →
  redirects back into the app via a `cubic://` deep link. The session is stored in the OS
  keychain via Electron `safeStorage` and auto-refreshed, so the user stays signed in
  across launches.
- **Subscribe / manage (§C, §D).** "Upgrade" opens Stripe Checkout in the browser →
  `cubic://` back; "Manage subscription" opens the Stripe Customer Portal. The **Stripe
  webhook is the only writer** of the `subscriptions` table — the client can never grant
  itself access.
- **Changing prices / limits (operator, §C).** `supabase/scripts/change-plan.ts` *versions* a
  tier: it creates a new Stripe Price, flips the active `plans` row (`set_active_plan_version`),
  and schedules existing subscribers via Stripe **Subscription Schedules** to migrate at their
  own next renewal — price + allowance flip together, no mid-cycle recharge, a ≥30-day notice
  guard on increases. New signups get the new price immediately; the same webhook absorbs the
  scheduled flip (no webhook change). Emits a JSON roster of who's migrated + when. `--dry-run` first.
- **An AI turn in prod (§A).** The brain sends `messages` + live `<live_ae_state>` to the
  proxy with the sign-in token. The proxy: verifies the token → checks entitlement (cached
  ~30-60s, so a cancel revokes access in seconds) → rate-limits → injects the system prompt
  + full tool catalog + key → forwards to Anthropic → **streams the response straight back**.
  The brain gets `tool_use`, dispatches it locally through the bridge to AE, and feeds the
  result back — the entire local half is identical to Part I §8. After the response, the
  proxy meters the token usage and deducts it from the user's monthly allowance.
- **Auto-update (§F).** `electron-updater` checks the R2 feed, downloads a **signed** update
  in the background, and prompts "restart to update." Updates reuse the app's signing
  identity (no Gatekeeper re-prompt) and never touch or reload the AE panel.
- **Analytics (§H).** The backend agent loop emits events to PostHog — `command_run`
  (verb + outcome + retries) plus activation/conversion funnel events. Server-side only;
  event payloads carry verb names and counts, never prompt text or project contents.

## 16. What changes from Part I (the diff)

Everything else in Part I is unchanged. These are the only edits production makes, by file:

| Seam (file) | Today (Part I) | Production (Part II) | Spec |
|---|---|---|---|
| `server/ai/src/prompt/rules.ts`, `tools/command-params.ts`, `tools/definitions.ts` | Live in the shipped backend | **Relocated into the Worker**; client keeps only tool *names* | §A-1 |
| `server/ai/src/llm/anthropic.ts` | `new Anthropic({apiKey})`, direct, no `baseURL` | `baseURL` = proxy URL, auth = sign-in token, **no key on device** | §A-3 |
| `app/src/main/config.ts` | `CUBIC_ENV` switch exists; `prod` is an inert stub | Ships defaulting to `prod` → real proxy URL | §A-8 |
| `app/src/renderer/` | Chat UI only | Adds sign-in, paywall, and account/billing menu | §B-4, §D |

> **Note — local transport hardening already landed in Part I (§???).** The WS transport is no
> longer a Part-I→Part-II diff: `wsBridge.ts` already binds an **OS-assigned dynamic port** and
> **requires a per-launch token** in each socket's first `hello` frame (published to
> `~/.cubic/conn.json` + reported to main over `getBackendPort()`). This is local-transport
> hardening, independent of the `CUBIC_ENV` proxy switch, so it holds in every mode (direct-local,
> full-stack-local, prod) — Part I §1/§2/§3/§5 describe it as the current reality.

---

# Dev & test workflows

There are four ways to run Cubic, ordered by how much infrastructure (and money) they
touch. The first two exist today; the last two arrive with Phase 5. The guiding rule is
**local-first: never burn real cloud or token spend just to test** — develop each paid
component against a local emulator first.

| Surface | What runs | Infra touched | Token / cloud cost | How to launch | Status |
|---|---|---|---|---|---|
| **MCP-only** | The AE bridge alone, over stdio, driven by Claude Code or integration tests | Local AE only | None | The bridge's MCP entrypoint (`server/ae-bridge/src/index.ts`) | **Works today** |
| **direct-local** | The full app; the brain calls Anthropic **directly** with a local key | Local only + Anthropic | Your API tokens | `npm run dev` (`CUBIC_ENV=local`) | **Works today — the default** |
| **full-stack-local** | The full app through the real proxy / auth / billing path, against **local emulators** | `wrangler dev` + `supabase start` + Stripe test mode | Test-mode only — no real cloud spend | `CUBIC_ENV=prod` + `CUBIC_PROXY_URL=http://localhost:8787` | **Not built yet — needs Phase 5 (§A-§C)** |
| **prod** | The full app against real deployed infrastructure | Worker + Supabase + Stripe + R2 (real) | Real money | Signed build, `CUBIC_ENV=prod` + prod proxy URL | **Not built yet — needs Phase 5 (§A-8, §G-3)** |

The single lever between these is the `CUBIC_ENV` switch in `app/src/main/config.ts` (Part I
§5.2): `local` = direct Anthropic; `prod` = forward the call to whatever `CUBIC_PROXY_URL`
points at (a local emulator or the deployed Worker). Phase 5 makes the client *fork* at this
seam (proxy vs. direct) — it does **not** remove the direct-local branch, so today's
`npm run dev` flow keeps working forever.

**Local-first rule (§A-0).** Every paid-backend component is built and tested in
**full-stack-local** against its emulator before anything deploys. Real cloud/Supabase
compute is spent only at two points: flipping the shipped app to the prod URL (§A-8) and the
final clean-machine end-to-end test (§G-3). The authoritative statement of this rule lives in
[`TODO-phase5.md`](../TODOS/TODO-phase5.md) §A-0.

---

For build/run instructions and project status, see the root
[`README.md`](../README.md); for the message contract, see
[`server/ae-bridge/PROTOCOL.md`](../server/ae-bridge/PROTOCOL.md); for product vision
and roadmap, see [`PRD.md`](PRD.md) and [`TODOS/`](../TODOS). The production design (Part II)
is specified in full in [`TODOS/TODO-phase5.md`](../TODOS/TODO-phase5.md), with its build
order in [`TODOS/TODO-phase5-parallel.md`](../TODOS/TODO-phase5-parallel.md).
```