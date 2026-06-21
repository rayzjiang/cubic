# Cubic

**Motion Copilot for After Effects.** Cubic is an AI agent that builds native After Effects animations and motion graphics from natural language. Ask it to "make this text pop in" or "add a smooth slide transition," and it reads your live AE project, reasons about the motion, and writes the animation directly into your comp — self-healing through any errors along the way.

Built for video editors, not developers: a standalone desktop app with a consumer-style chat UI, no scripting required.

## How it works

```
┌─────────────────┐     IPC      ┌──────────────────┐
│  Electron app   │◄────────────►│   Node backend   │
│ (React chat UI) │   WebSocket  │  (AE bridge +    │
└─────────────────┘◄────────────►│   Claude brain)  │
                                 └────────┬─────────┘
                                          │ WebSocket (127.0.0.1:17923)
                                          ▼
                                 ┌──────────────────┐
                                 │  CEP extension   │
                                 │  in After Effects│ ── runs ExtendScript
                                 └──────────────────┘
```

1. You type a request in the desktop app.
2. The **Claude brain** fetches live AE state (active comp, selected layers, assets) and reasons about the motion.
3. It executes **ExtendScript commands** over a local WebSocket bridge into a CEP extension running inside After Effects.
4. If AE throws a compile error, the agent feeds it back to the model and retries — a forward **self-healing loop** (no undo), with a pre-turn `.aep` snapshot for safety.
5. The result appears natively in your AE timeline.

## Project structure

This is a monorepo of three independent packages (no root `package.json`).

```
cubic/
├── app/                  # Electron desktop app — React + Zustand + Tailwind chat UI
│   ├── src/main/         #   Electron main process: window, IPC, spawns the backend
│   ├── src/preload/      #   IPC security boundary
│   ├── src/renderer/     #   React chat UI (transcript, sidebar, live agent events)
│   └── src/shared/       #   Shared IPC types
│
├── server/
│   ├── ae-bridge/        # WebSocket bridge + ExtendScript handlers + CEP extension
│   │   ├── src/serve.ts  #   Standalone backend entrypoint (spawned by Electron)
│   │   ├── src/bridge/   #   WS server relaying commands to the CEP worker in AE
│   │   ├── src/scripts/  #   ExtendScript (.jsx) handlers: layers, text, shapes,
│   │   │                 #     animation, effects, masks, footage, markers, etc.
│   │   └── cep-extension/ #  CEP panel running inside AE (runs the bundled .jsx)
│   │
│   └── ai/               # Claude brain — the agent loop
│       ├── src/agent/    #   Iteration loop, tool execution, self-healing, cancel/steer
│       ├── src/context/  #   Live AE state fetching, caching, prompt formatting
│       ├── src/llm/      #   Anthropic SDK wrapper
│       ├── src/prompt/   #   System prompt + command catalog assembly
│       └── src/tools/    #   Command registry
│
├── docs/                 # Product + architecture docs (PRD, ARCHITECTURE)
└── TODOS/                # Phase roadmap and checklists
```

## Features

- **Natural-language motion design** — describe the animation, get it built natively in AE.
- **Live project awareness** — reads the active comp, selected layers, and assets before acting.
- **Self-healing code loop** — catches ExtendScript errors and retries by reasoning over the error, up to 15 iterations per turn.
- **Pre-turn snapshots** — auto-saves an `.aep` backup before each turn for restore.
- **Stateful sessions** — append-only JSONL transcripts per project; survive crashes and app reloads.
- **Steer & cancel** — queue follow-up messages mid-run; cancel at iteration boundaries (Esc).
- **Context-window safety** — auto-compacts old turns near the limit; full history always preserved on disk.

## Tech stack

| Layer | Tech |
|-------|------|
| Desktop app | Electron, React, Zustand, Tailwind CSS, TypeScript |
| Build | electron-vite, esbuild |
| Transport | WebSocket (`ws`), Electron IPC |
| AI | Anthropic SDK (Claude Sonnet 4.6 default, configurable) |
| AE scripting | ExtendScript via CEP extension |
| Validation / data | Zod, JSON/JSONL files |
| Testing | Vitest + live tests against AE |

## Getting started

**Prerequisites:** Node 18+, After Effects 2024+, and an `ANTHROPIC_API_KEY`.

```bash
# 1. Build the Claude brain
cd server/ai && npm install && npm run build

# 2. Build the AE bridge (and install the CEP extension into AE)
cd ../ae-bridge && npm install && npm run build:serve && npm run install-plugin

# 3. Build & run the app
cd ../../app && npm install && npm run dev
```

Shortcut:
```bash
# The "rebuild everything, don't think" version
cd server/ai        && npm run build
cd server/ae-bridge && npm run build            # build:server + build:serve + build:plugin
cd server/ae-bridge && npm run install-plugin   # only if AE plugin changed (+restart AE)
cd app              && npm run dev              # restart this to pick up fresh backend
```

The app launches a native window, spawns the backend, and connects to After Effects. Open a project in AE, and start chatting.

### Configuration

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Required. Claude API key. |
| `CUBIC_MODEL` | `sonnet` (default), `haiku`, or `opus` — switch models without rebuild. |
| `CUBIC_ENV` | `local` (default, direct Anthropic calls) or `prod` (routes through hosted proxy). |

### Production build

```bash
cd app
npm run build    # → out/
npm run start    # preview the build
```

## Status

Cubic is in active development. The agent brain and AE bridge are working (Phase 2 complete); the standalone Electron app is being finished (Phase 4). Hosted API proxy, billing, and packaging for distribution come in Phase 5 — Cubic is not yet shipped to end users.

See [`TODOS/TODO.md`](TODOS/TODO.md) for the full roadmap and [`docs/PRD.md`](docs/PRD.md) for the product vision.
