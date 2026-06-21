Product Requirements Document (PRD): Motion Copilot for After Effects (MVP)
Product Name: Motion Copilot (Placeholder)
Document Status: V2 (Refactored)
Target Platform: Adobe After Effects, driven from a standalone Cubic desktop app (Electron) that connects to AE over a thin headless CEP bridge. (Architecture is deliberately host-agnostic to allow Premiere/DaVinci later — see §4 & §6.)

Phase 0 — AE basics (enough to evaluate what you're building)
Phase 1 — MCP validated
Phase 1.5 - **Fixing the MCP + adding all functionality that I need + Organizing it for CRUD for each operation
Phase 2 — Build the LLM brain + agent architecture (system prompt + Claude API backend)
Phase 2 (3 collapse into 2) (self-healing/correcting/bug checking loop)
Phase 4 (Standalone Electron desktop app + thin headless AE bridge)

1. The Vision & Problem Statement
The industry standard for high-end SaaS and app launch videos (e.g., Anthropic, Duolingo, Apple) relies on "juicy" motion graphics—smooth easing, clean animations, kinetic typography, and physics-based bounces. Achieving this requires deep technical knowledge of After Effects, specifically the graph editor, JavaScript expressions, etc..
Motion Copilot acts exactly like GitHub Copilot or Claude Code, but for video editing. Instead of generating flat, uneditable MP4s, it writes the code/JavaScript/ExtendScript/interactions necessary to build the actual After Effects project file natively. It gives general video editors an AI agent that lives in their workspace, reads their timeline, and instantly builds complex motion graphics that they can manually tweak.
2. Target Audience
Launch positioning: "Cursor for video editing — accelerate your After Effects workflow." Market it the way every AI code editor markets itself: it makes you faster, it helps you edit better. Keep the messaging confident and slightly vague — do NOT self-deprecate or volunteer caveats about the agent's motion-design taste (no "you bring the taste, we do the clicking"). Internally, taste is still an iteration target and the long-term moat; externally, we simply lead with speed and capability, same as Cursor/Copilot do.
Primary (launch focus): After Effects-literate users — working editors and motion designers who already know the craft and use Cubic to skip manual clicking/keyframing/configuring. This is the launch wedge because they can prompt precisely, can correct the agent when it's wrong, and self-select into reachable communities; they tolerate an imperfect agent in a way non-technical users can't.
Secondary (kept in scope, no longer primary): Non-technical / entry-level video editors who want a Copilot-style assistant without touching the graph editor. Still supported, but serving them well is post-launch iteration work, not the launch bar.
Tertiary (Post-MVP): Complete beginners (founders, marketers) who want to generate startup-style videos entirely via prompt.
UX implication: simple, consumer-grade chat surface (the prior north star) with power-user capability underneath — keep the interface approachable, but never cap what a fluent AE user can drive through it.
3. Core Features (The MVP)
3.1 The Agent Interface & Context System
The Analogy: The AE Timeline is the "codebase." The Cubic desktop app is the chat interface (a separate window that connects to AE, not a docked panel).
Layer Targeting (Context Selection): Users can highlight specific layers in AE to give the Copilot immediate context (similar to highlighting a block of code in VSCode). If nothing is selected, the agent reads the active composition and infers the target based on the prompt.
Project Asset Access (project panel is like the root directory of an AI coding agent’s context): The Copilot can read the user's AE Project Panel, allowing it to pull existing imported assets (like a client logo or app UI screenshot) directly onto the timeline to animate them.
Small side feature - Auto-Composition: If a user submits a prompt in a completely empty project, the plugin automatically generates a default resolution/fps (decide later). Composition to begin work, removing setup friction.
3.2 The Generation Engine (The "Duolingo" Standard)
Capabilities: The MVP must be capable of generating the core animations/movements seen in modern tech ads (like the Duolingo reference video), assuming given the assets needed for the motion edits.
Element Creation: Automatically generate Text layers (with specific weights/colors), Vector Shape layers (rectangles, progress bars, circles), and Solid background layers, animations/keyframes, etc. via prompt.
The "Juice" System: The LLM is heavily system-prompted with specific style guidelines and expression snippets. When a user asks for a "pop in" or a "smooth slide," the AI injects the exact Bezier easing velocities and inertial bounce expressions required to make it look professional, skipping manual keyframing. If users can prompt/reprompt it to make the animation/motion move a certain way.
3.3 Self-Healing Code Loop (Error Handling)
LLMs will occasionally hallucinate bad interactions/code/Javascript/ExtendScript. If After Effects throws a compilation error or execution failure, the Copilot will invisibly catch the error string and pass it back to the LLM to debug and fix itself in the background before showing the result to the user. If it fails after a set number of retries, it gracefully informs the user.
3.4 Zero-Friction Installation
Avoid standard Adobe ZXP installer friction. Users install ONE thing — the Cubic desktop app (signed/notarized .app on Mac, .exe on Windows). On first run / "Connect to After Effects," the app auto-provisions the thin headless CEP bridge into the correct hidden Adobe CEP extensions directory and enables debug mode, so AE auto-connects on next launch. No separate plugin installer, no ZXP. (Analytics/usage instrumentation + feature flags are wanted in the app — vendor TBD; wire the event hooks in as the UI is built.)

4. Technical Architecture
Frontend: Standalone Cubic desktop app — Electron (React/HTML/CSS) renderer. Chosen over native Swift because the backend is all TS/Node (reuse + shared types + hosting the backend as a child process); it's also the industry default for non-terminal AI editors (Cursor/Windsurf/VS Code forks). The chat UI is written once and is host-agnostic — only the per-host bridge adapter changes for future platforms.
Backend / Middleware: A local Node server (the existing MCP bridge + agent loop) hosted by the Electron main process. It opens the WebSocket bridge on 127.0.0.1:17923; the thin headless CEP extension inside AE connects as the worker client and runs ExtendScript via evalScript. The agent loop reaches AE as just another client on the same bridge. The wire protocol (`{id, command, args}` ↔ `{id, ok, result}`) is the stable contract between app and host.
MCP logic was written out by someone else, we gotta verify it works as intended: https://github.com/Dakkshin/after-effects-mcp
LLM Integration: A single, highly capable model for the MVP. In the shipped build the model is selectable at runtime via the `CUBIC_MODEL` env var (alias `sonnet|haiku|opus` or a full id), defaulting to `claude-sonnet-4-6` — read at call time so it flips without a rebuild. (Full provider-swap, e.g. non-Claude models, remains Post-MVP — see §5.)

5. Post-MVP (The Backlog)
These features are confirmed for the roadmap but excluded from the initial MVP build to ensure a fast launch:
**Copilot style approval/view of changes before they’re added?
**Claude code style different modes (default - need approval for each change, plan/grill mode to make sure you and the AI are on the same page, auto accept all changes)
Hot-Swappable Models: Allowing users to switch the backend brain (e.g., from Claude to GPT-4o), similar to the Cursor IDE model dropdown.
Integration of git for video editing (vit)?
Claude.md memory files??: For saving user preferences + information about the project so that it doesn’t waste token usage on each command
Users can upload examples of motion graphics that they want to emulate to the panel: The AI can infer what settings/motion/elements required and implements those edits to the composition
Native AE Slider Mapping: Mapping the AI-generated expressions to native After Effects slider controls so absolute beginners can adjust bounce height or speed without looking at code.
Complex 3D Generation: Automating multi-node 3D camera tracking, deep Z-space environments, or 3D object rotation (like the final tunnel sequence in the Duolingo video).

6. Out of Scope
NLE Trimming: Cutting, trimming, or rearranging raw MP4 video/audio footage.
Premiere Pro / DaVinci Integration: Out of scope for the MVP — After Effects is the only shipped target. NOTE (changed): going standalone was chosen partly so this is no longer a one-way door. The desktop UI is host-agnostic; adding a host later means writing a new bridge adapter that speaks the same wire protocol (Premiere = also CEP, near-free; DaVinci = Python/Lua WS bridge), not rebuilding the app. Final Cut remains unlikely (no real scripting API).
