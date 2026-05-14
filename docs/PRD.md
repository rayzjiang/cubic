Product Requirements Document (PRD): Motion Copilot for After Effects (MVP)
Product Name: Motion Copilot (Placeholder)
Document Status: V2 (Refactored)
Target Platform: Adobe After Effects (via UXP/CEP Panel)

1. The Vision & Problem Statement
The industry standard for high-end SaaS and app launch videos (e.g., Anthropic, Duolingo, Apple) relies on "juicy" motion graphics—smooth easing, clean animations, kinetic typography, and physics-based bounces. Achieving this requires deep technical knowledge of After Effects, specifically the graph editor, JavaScript expressions, etc..
Motion Copilot acts exactly like GitHub Copilot or Claude Code, but for video editing. Instead of generating flat, uneditable MP4s, it writes the code/JavaScript/ExtendScript/interactions necessary to build the actual After Effects project file natively. It gives general video editors an AI agent that lives in their workspace, reads their timeline, and instantly builds complex motion graphics that they can manually tweak.
2. Target Audience
Primary: General video editors and entry-level motion designers who want a Copilot-style assistant to speed up their workflow and execute complex animations without touching the graph/video editor.
Secondary (Post-MVP): Complete beginners (founders, marketers) who want to generate startup-style videos entirely via prompt.
3. Core Features (The MVP)
3.1 The Agent Interface & Context System
The Analogy: The AE Timeline is the "codebase." The Copilot panel is the chat interface.
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
Avoid standard Adobe ZXP installer friction. The product will be packaged in a standard .exe (Windows) and .pkg (Mac) installer that automatically drops the plugin files into the correct hidden Adobe system directories.

4. Technical Architecture
Frontend: Adobe UXP (or CEP) built with React/HTML/CSS.
Backend / Middleware: A local node server (adapting logic from the open-source MCP bridge) to pass code securely between the web panel and the AE engine.
MCP logic was written out by someone else, we gotta verify it works as intended: https://github.com/Dakkshin/after-effects-mcp
LLM Integration: A single, highly capable model (e.g., Claude 3.5 Sonnet) hardcoded for the MVP to ensure stability and simplify development.

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
Premiere Pro / DaVinci Integration: The tool is strictly native to After Effects
