# SLIGHTLY OUTDATED - Phase 4 — Deferred / post-MVP

> These were scoped out of the **v1 MVP** (`TODO-phase4.md`) to ship faster. **None are needed for v1, and none affect project safety** (context-window management + pre-turn snapshots stay in v1). Each item notes the **§section of `TODO-phase4.md`** it was originally planned in, so it can be slotted back when promoted.
> Do these after v1 is build-ready — before, or alongside, Phase 5.

## From §C — Chat UI
- [ ] **Token-level streaming** — stream assistant text token-by-token (swap `chat()` → `stream()` in the loop; no event-shape change). v1 already shows text per agent-iteration, which feels responsive enough.
- [ ] **Context-usage meter** — show `Session.lastContextTokens` vs the model's `contextWindow` (e.g. a subtle "context 60% full" gauge). Nice-to-have; `context_full` handling in v1 already covers the failure case.

## From §C2 — Conversation history + persistence
- [ ] **Haiku auto-titles** — after turn 1, fire a tiny `claude-haiku-4-5` call (via `getLLM()`) to generate a clean conversation title, swap it into `index.json`. v1 ships with the truncated-first-message placeholder instead.
- [ ] **Retention (age-based auto-delete)** — auto-delete a conversation ~30 days after its last activity (one knob = CC's `cleanupPeriodDays`). v1 keeps everything + manual delete only.
- [ ] **Manual rename** — row dropdown → Rename; overrides the auto-title and sets the `renamed` flag so a future Haiku title won't clobber it.
- [ ] ensure my application doesn't break + allows users to cleanly resume work if they cmdQ/exit the app fully

## From §D — Agent-run controls
> Backend already supports all of this (Phase 2: `pendingMessages` FIFO + `queue`/`editQueue`/`removeQueue` handlers). Deferred work is **UI-only**.
- [ ] **Type-while-running (steering)** — send `{type:'queue', id, text}` to steer the agent (injected at the next tool boundary / as a follow-up turn).
- [ ] **Queue management UI** — show queued/steering messages + allow edit/remove before they fire (`editQueue`/`removeQueue` by `id`); mark a row "sent" when its `steer` event (carrying that `id`) arrives.

## From §E — Backup recovery
- [ ] **Undo-history viewer + dedicated keybind** — a richer browse-all-snapshots view + a keyboard shortcut. v1 ships the restore button + agent-driven "undo that"; this is the power-user layer on top.

## From §F — Transient API-error resilience (backend)
- [ ] **Quick win (anytime):** `new Anthropic({ apiKey, maxRetries: 4 })` for a bit more resilience on transient 429/529/network.
- [ ] **Mid-turn retry** — a mid-turn failure (dies iter 6/10 after already changing the project) currently abandons the whole turn → auto-retry the failed iteration so the turn resumes instead of restarting. Post-launch polish (history intact + AE changes already applied stay; user just re-sends today).

## From "Super important" (post-launch hardening)
- [ ] **Mid-turn state-staleness guard** ("modified since read"). Destructive drift is already caught (stale-target tool call → `LAYER_NOT_FOUND` → self-heal re-reads); **silent drift is not** — if the user nudges a layer mid-turn, the next tool call *succeeds* against stale context, so nothing throws and self-heal never fires. AE has no free revision counter → capture a cheap project-state **fingerprint** at turn start, re-check before each *mutating* tool call, mismatch → emit `STATE_STALE` into the self-heal path → model re-reads fresh. Only bites if the user edits *while* a turn runs (rare; turns are seconds).
- [ ] **Motion-quality judgement call** (deferred from Phase 2). Once the UI exists, drive real prompts + watch output. Decide if the model's "juicy" motion understanding needs improving (recipes + system prompt may already suffice). If yes: tune recipe defaults / adjective→recipe mapping / composite recipes / visual feedback loop — NOT a preset library.
- [ ] **Let the AI view generated video** (not images) — likely via Gemini's video capability.
