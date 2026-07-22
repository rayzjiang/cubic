# POSTMVP — Cubic deferred-work tracker

> **Single home for everything intentionally deferred past v1 MVP.** Created 6/20/26
> by consolidating the scattered post-MVP items (the old `TODO.md` bottom sections,
> the inline `DEFERRED TO POSTMVP` checkboxes, and all of `TODO-phase4-later.md`).
>
> **Conventions:**
> - Each deferred item lives **only here**. Phase files point here; they do not restate.
> - **Open items only** (`[ ]`). When an item is promoted, move it back into the relevant phase file.
> - Each item is tagged with its origin so provenance stays traceable.
> - **NOT here (on purpose):** the PRE-SHIP taste gate (Phase 5 §G-0 + `taste-eval.md`) and
>   the live `context quality` concern both stay in `TODO.md` — they're ship-gate / current-quality, not deferred.
> - `TODO-phase5.md` ↔ `TODO-phase5-parallel.md` (and `TODO-phase4.md` ↔ the worktree plan in `TODO.md`)
>   are intentional dual-views of the same items — do not "dedupe" them.

---

- [ ] github actions ci/cd for triggering notarization stuff for any new tag/pushed to main

## Editing model (NLE-style)

- [ ] **NLE-style ripple / reorder editing — the one trim/reorder gap.** _(was TODO.md `# postmvp`)_
  Surfaced 6/18/26 while verifying the "trim/reorder footage" TODO. Cubic speaks After Effects' COMPOSITING model:
  every layer has an independent `startTime`, layers stack, and there is no auto-ripple. A "typical AI video editor"
  (CapCut / Premiere) speaks the NLE/timeline-TRACK model: clips butted end-to-end on a track, where trimming or
  deleting a clip RIPPLES everything after it left to close the gap, and "reorder" means changing PLAYBACK ORDER in a
  sequence (not z-order). Cubic has all the primitives (trim/split/merge/sequence/stretch) but no single operation that
  arranges clips back-to-back in a given order or ripple-deletes/ripple-trims to close gaps.
  Why deferred: imposes an NLE mental model onto AE; not yet observed as a real user pain; the agent can approximate it
  today by composing existing tools (compute downstream startTimes manually) — brittle + token-heavy but functional.
  Future options if a user hits it:
  - (a) prompt/agent-guidance only — teach the model "reorder in time = recompute startTime, NOT moveLayer (z-order)";
    cheapest, no new handlers.
  - (b) net-new ripple primitives — e.g. `arrangeSequence(layerIndices, order, gap)` (lay clips end-to-end in order) +
    `rippleDelete`/`rippleTrim` (close the gap by shifting later layers' startTimes). Treat a chosen set of layers as a
    single track; recompute startTimes server-side in one undo group. Biggest lift, most "real video editor" feel.
  Decision when revisited: validate with a real test chat first ("trim these 3 clips and play them back-to-back in this
  order") to see whether composed existing tools already suffice before building (b).

---

## Rewind / restore

- [ ] **Undo depth capped ~10 turns/chat** (can't always rewind to a long chat's start). _(was TODO.md §④)_
  Cause: each backup is a full `.aep` copy (binary, big) — unlike Claude Code's cheap text diffs. Future
  options for deeper "rewind anywhere": (1) gzip each copy, (2) binary deltas (xdelta/bsdiff), (3) git repo
  in `.cubic-backups/`. Ship keep-10 now.

Rewind ships in MVP as a whole-project, one-way revert (decided after grilling: keep it simple, warn honestly in the
confirmation, fix depth later). The deferred improvements below make it safer/surgical. _(was TODO.md `# post mvp (rewind…)`)_

Accepted MVP limitations (the deferred work targets these):
- **Whole-project, not surgical.** Rewind reverts everything to that point, not just the AI's changes. If the user
  edited a *different* comp/piece by hand after that turn, that work is wiped too.
- **Manual edits not preserved.** No pre-restore safety snapshot, so uncaptured hand edits since the last turn are
  destroyed on rewind (disclosed only via the confirmation, not recoverable).
- **Not undoable.** One-way by design; no "undo the rewind."

Deferred improvements (roughly in priority order):
- [ ] **Pre-restore safety snapshot** — copy current state to a recovery point before overwriting, so a rewind never
  truly destroys manual work. (Backend half of an undoable rewind.)
- [ ] **Undoable rewind** — bidirectional timeline (cursor + non-destructive backups + branch-discard on the next
  message), surfaced either as a single "undo rewind" action or collapsible "ahead" turns.
- [ ] **Per-comp / surgical scoped restore** — revert only the comp(s)/objects the AI touched, leaving the user's
  unrelated manual work intact. The proper answer to the original bug; biggest lift. (AE has no programmatic per-object
  undo across the agent loop's async turns — only whole-`.aep` snapshots are reliable.)
- [ ] **Undo-history viewer + dedicated keybind** — a richer browse-all-snapshots view + a keyboard shortcut. MVP
  ships the restore button + agent-driven "undo that"; this is the power-user layer on top. _(was TODO-phase4-later §E)_

---

## Test-truth & handler correctness

- [ ] **Exhaustive test-truth pass.** _(was TODO.md `# post mvp (test-truth…)` + inline POSTMVP #4)_
  Context: an effect shipped broken (wrong AE matchName) while all tests passed, because (a) the broken variant was
  never invoked and (b) tests asserted only "no error", not real read-back. Fixed for the glow class: effects now have
  an AE-sourced matchName fixture + CI guard, and every AE-string-backed enum variant (expression presets, motion
  recipes, easings, text-animator properties, blend modes, light types, alignments, mask modes, track mattes,
  polygon/star) is applied AND read back. That pass found + fixed 4 real bugs (glow matchName, brightness-contrast
  property, easeIn/easeOut, star shape). Remaining (the "exhaustive" tier):
  - Convert the ~40% of OTHER integration tests that still only assert no-error/shape into read-back assertions
    (create* → get* confirms existence; set* → get* confirms the value actually changed).
  - AE-verify the two non-matchName risks the audit flagged: `convertToShape` uses English-only menu strings
    (`findMenuCommandId` — breaks on localized AE), and `layers.jsx` light-falloff is a raw numeric-index map
    ({none:0,smooth:1,inverseSquare:2}) never read back.
  - Regenerate `server/ae-bridge/tests/fixtures/ae-matchnames.json` (run `scripts/introspect-matchnames.mjs`)
    whenever the AE version changes; extend the matchname guard's reviewed baseline if text/shape grows.

- [ ] **Make the multi-field setters diff-aware** so their "all fields already set" noop is correct. _(was TODO.md §④)_
  (= the J2 work; their `NOOP_SCRIPT_LABELS` entries are already in place, dormant until this lands):
  `setLayerProperties`, `batchSetLayerProperties` (the two big layer setters), `setCompositionProperties`,
  `setTextAnimatorRangeSelector`, `setLayerMask` (update branch), `updateMarker`. Each must diff every supplied field
  against current (today text fields diff but non-text fields push to `changedProperties` unconditionally /
  `updateMarker` pushes on supply not on change), then return noop when nothing actually differs. A half-diff noop here
  would be wrong, so deferred from the noop pass.

- [ ] **Fix handler judgment-call issues surfaced by the noop audit** (not noop-related). _(was TODO.md §④)_
  - J3: `batchSetLayerProperties` returns top-level `status:"success"` even if every sub-op errored (should mirror
    `batch`'s `BATCH_FAILED`).
  - J4: `createLightLayer` silently ignores an unknown `lightType`.
  - J5: `setTrackMatte` swallows a `setTrackMatte()` API failure and falls back to a plain assignment that loses the
    matte-layer pointer.
  - J6: `addShapeOperator` swallows bad-setting failures (no `failedProperties`, unlike effects.jsx).
  - J7: `deleteProjectItem` uses `INVALID_ARGS` for "item not found" instead of a NOT_FOUND-family code.
  - J8: `copyKeyframeEasing` success payload omits resolved source/target layer+property names (UI can't describe it).
  - J9: missing atomic-create rollback on `duplicateLayer`/`splitLayer`/`precompose`/`decomposeLayer`/
    `explodeTextLayer`/`addTextAnimator`/`addShapeOperator`/`importAssetToComp` (mid-create throw orphans partial state).
  - J10: `addMarker` silently overwrites an existing marker at the same time.
  - Also `distributeLayers3D` noop deferred here (detection messy — toggles 3D/autoOrient too).

---

## Architecture cleanup (not user-facing)

- [ ] **Brain → bridge direct in-process call.** _(was TODO.md `# post mvp (architecture cleanup)` + inline POSTMVP #3)_
  The Claude agent lives **inside** the backend but reaches the bridge by opening a WS back to localhost
  (`ai/src/bridge/client.ts` → `wsBridge.ts`) — serializing JSON + a network hop to call code in the same process, plus
  a failure mode where the brain can "disconnect" from itself. Leftover from the MCP-first design. Replace the loopback
  with a direct in-process call (same `sendCommand` interface, no socket) for the brain only; the AE panel + UI stay
  real WS clients. Lower priority — works fine, just inelegant + adds latency.

---

## Models

- [ ] **Hot-swappable models.** _(was TODO.md `# post mvp (hot swappable models)`)_
  Do later. Design for it now by keeping all LLM calls behind a single wrapper (one file to change) — already true via
  `getLLM()`. How Cursor does it: direct provider SDKs (Anthropic SDK, OpenAI SDK, Google SDK) + their own adapter
  interface — NOT Vercel AI SDK (need provider-specific features like extended thinking / o1 reasoning that abstraction
  layers lag on).
  ```
  interface LLMProvider {
    chat(messages, opts): Promise<Response>
    stream(messages, opts): AsyncIterable<Chunk>
  }
  class AnthropicProvider implements LLMProvider { ... }
  class OpenAIProvider implements LLMProvider { ... }
  ```
  For MVP: AnthropicProvider only. Add others when needed.

---

## Chat UX polish

- [ ] **Token-level streaming + tool events.** _(was TODO.md `# post mvp` + TODO-phase4-later §C — merged)_
  Stream assistant text token-by-token (swap `chat()` → `stream()` in the loop; no event-shape change). WHY: smoothest
  "typing" feel, most like Claude Code. WHY NOT: must rebuild `stream()` to pass tools + accumulate tool_use JSON deltas
  + reconcile with the loop — meaningfully more code and edge cases. v1 already shows text per agent-iteration, which
  feels responsive enough; this is polish you can add without changing the loop's shape.
  **When this lands, also fix metering (P5W2 audit L5):** `proxy/src/usage-parse.ts` buffers the whole response before
  parsing usage, so a client abort mid-stream would record ZERO usage (`message_delta` never arrives). Parse
  incrementally as chunks arrive (reuse `parseSse`'s running `output_tokens` accumulator) so an aborted stream still
  meters what was generated. Latent today (the non-streaming path always completes) — a code comment flags it at the site.
- [ ] **Context-usage meter** — show `Session.lastContextTokens` vs the model's `contextWindow` (e.g. a subtle
  "context 60% full" gauge). Nice-to-have; `context_full` handling already covers the failure case. _(was TODO-phase4-later §C)_
- [ ] **Haiku auto-titles** — after turn 1, fire a tiny `claude-haiku-4-5` call (via `getLLM()`) to generate a clean
  conversation title, swap it into `index.json`. v1 ships with the truncated-first-message placeholder instead.
  _(was TODO-phase4-later §C2)_
- [ ] **Retention (age-based auto-delete)** — auto-delete a conversation ~30 days after its last activity (one knob =
  CC's `cleanupPeriodDays`). v1 keeps everything + manual delete only. _(was TODO-phase4-later §C2)_
- [ ] **Friendlier huge-chat resume pre-warning.** _(was TODO.md `# postmvp`)_
  On reopen we load full history; the first turn auto-compacts (≥90%) or hits the existing `context_full` CTA (≥97%) —
  same safety net §C renders. A friendlier pre-warning is a later refinement, not built in MVP.

---

## Agent-run controls

> Steering (type-while-running), the removable queued-steer chip, and manual rename all **shipped** in Phase 4 — not listed here.

- [ ] **Edit a queued steer in place before it fires** (remove/cancel already shipped). The `editQueue` wire type
  exists in `protocol.ts` but isn't exposed in the UI (no store action / button). _(was TODO-phase4-later §D queue-mgmt, narrowed)_
- [ ] **Plan mode + accept-edits-one-at-a-time.** _(was NOTES-phase4.md)_ MVP is pure auto-run (tool calls execute
  immediately — safe because every command is ⌘Z-able + pre-turn `.aep` backup, and users are video editors not coders).
  Post-MVP: an optional plan/preview step + per-edit accept/reject.

---

## Resilience / hardening

- [ ] **Quick win (anytime):** `new Anthropic({ apiKey, maxRetries: 4 })` for a bit more resilience on transient
  429/529/network. _(was TODO-phase4-later §F)_
- [ ] **Mid-turn retry** — a mid-turn failure (dies iter 6/10 after already changing the project) currently abandons
  the whole turn → auto-retry the failed iteration so the turn resumes instead of restarting. Post-launch polish
  (history intact + AE changes already applied stay; user just re-sends today). _(was TODO-phase4-later §F)_
- [ ] **Mid-turn state-staleness guard** ("modified since read"). _(was TODO-phase4-later "Super important")_
  Destructive drift is already caught (stale-target tool call → `LAYER_NOT_FOUND` → self-heal re-reads); **silent drift
  is not** — if the user nudges a layer mid-turn, the next tool call *succeeds* against stale context, so nothing throws
  and self-heal never fires. AE has no free revision counter → capture a cheap project-state **fingerprint** at turn
  start, re-check before each *mutating* tool call, mismatch → emit `STATE_STALE` into the self-heal path → model
  re-reads fresh. Only bites if the user edits *while* a turn runs (rare; turns are seconds).

- [ ] **Windows ACL hardening for `~/.cubic/conn.json`.** _(surfaced during P5W2 audit fix — Plan 3 #11)_
  Plan 3 #11 locks the bridge token file to owner-only via POSIX `chmod` (0600 file / 0700 dir) in
  `server/ae-bridge/src/bridge/wsBridge.ts` — a **no-op on Windows/NTFS** (ACL-based, not POSIX modes). When
  Windows support lands, lock it with `icacls` (or a native ACL call) so a second local account can't read the
  token that grants arbitrary ExtendScript execution in the open AE project. Mac/Linux are already protected.

- [ ] **Preload exposes the raw Supabase JWT to the renderer.** _(surfaced during P5W2 audit — Plan 4 L, accepted)_
  `app/src/preload/index.ts` exposes `getAccessToken()` so the renderer can put the token in its WS auth frame
  (`ws.ts`). The JWT thus lives in renderer memory — reachable only by XSS, which is already heavily contained (sandbox
  + contextIsolation + `nodeIntegration:false` + strict CSP + no `rehype-raw`). Full fix: move token ownership into
  Electron main (main brokers the WS auth / injects the Bearer) so the renderer never holds it — a real re-plumb of the
  WS handshake, deferred as a well-contained low.

- [ ] **Backend spawn → Electron `utilityProcess.fork()` so the `RunAsNode` fuse can be disabled.** _(surfaced during WT-PACKAGING §E-2)_
  The backend is spawned via `process.execPath` + `ELECTRON_RUN_AS_NODE=1` (`app/src/main/backend.ts`), which forces the
  `RunAsNode` Electron fuse to stay **enabled** — the one hardening hole left open in the packaged build (a local attacker
  could run the signed binary as a generic Node runtime). Migrating the spawn to Electron's blessed `utilityProcess.fork()`
  (a real re-plumb: its IPC is `MessagePort`-based, not the current stdio-fd `{port,token}` handshake — touches the verified
  WT-WS-AUTH transport) would let `RunAsNode` be disabled for full hardening. Deferred as a deliberate post-MVP security pass.

---

## Platform support

- [ ] **Windows support.** _(surfaced during P5W2 audit fix — Plan 3 #11)_
  Cubic is **Mac-only** today. Expanding to Windows means (at least): the Windows CEP install path + PlayerDebugMode
  (already branched in `installBridge.ts`), the normal Windows window frame (already guarded — Mac-only chrome), and
  **ACL hardening for `~/.cubic/conn.json`** (the POSIX `chmod` from Plan 3 #11 is inert on Windows — see Resilience /
  hardening above). Audit + close any other `process.platform === 'darwin'`-guarded seams before shipping Windows.
    - [ ] Font: make sure it adapts to windows
    - [ ] make sure the buttons/locations are good (since the close window button is in the top right now instead of top left)

---

## Billing / payments ops (Stripe)

- [ ] **Usage-meter write at scale** — the Wave-2 proxy should write the usage counter
  **async / non-blocking** (serve the LLM response first, record out-of-band) and **batch**
  if load demands; entitlement reads are already cached ~30–60s (§A-5). The current counter
  schema supports this unchanged — no schema work, noted so it isn't lost. **Shares the
  `record_usage` write path with the durable/dead-letter item under Metering / usage-tracking
  accuracy below — design the async/batch/durable write once, together.**
- [ ] **Refund / dispute auto-revoke webhooks** — the webhook currently handles only
  `customer.subscription.*`; it IGNORES `charge.refunded`, `charge.dispute.created`, and
  `customer.subscription.paused`, so a refunded/disputed user keeps access until period end.
  MVP handles refunds manually in the Stripe dashboard (cancel-anytime is the live control,
  Radar covers disputes); automate access-revoke on these events once volume warrants. The
  webhook switch + `apply_subscription` already make adding a case trivial. _(see §G-4)_
- [ ] **Auto-send price-change notices** — `supabase/scripts/change-plan.ts` already emits a
  JSON **roster** (`{user_id, email, tier, old_price, new_price, effective_date, change_type}`)
  and schedules increases ≥30 days out (card-network notice). Wiring an email provider (Resend /
  Postmark / Loops) to send the advance-notice emails just consumes that roster — same shape, no
  rework. Manual send until then. _(surfaced during price-versioning build)_
- [ ] **`price_change_notifications` tracking table** — only if/when the auto-send above is built
  AND we want sent/unsent tracking. Optional even then (an email job can read the roster file). No
  table today. _(surfaced during price-versioning build)_
- [ ] **General email / contactability infra** — welcome emails at signup + ad-hoc mass email.
  Separate from price notices. Reaching users today = read `auth.users.email` (dashboard or a
  service-role query). Caveat for later: Apple "Sign in with Apple" Hide-My-Email stores a
  `@privaterelay.appleid.com` relay in Supabase (not the real inbox) — emailing it requires
  registering the sending domain in Apple's Private Email Relay service. _(surfaced during price-versioning build)_

---

## Metering / usage-tracking accuracy & durability

> Proxy-side API-cost accounting (Phase 5 §A-6 `record_usage` pipeline) — keeping every cent of Anthropic
> spend accurately tracked. Distinct from **Billing / payments ops (Stripe)** above (that's the Stripe
> charge/subscription side); this is the internal usage counter that both bills against the allowance and
> gates entitlement. Pricing is correct today (base rates + cache multipliers verified against current
> Anthropic pricing; the 2× cache-write tier is exact only because the Worker pins every breakpoint to
> `ttl:'1h'` in `normalizeCacheControlTo1h` — keep that pin), and the quit/freeze case is already safe
> (metering is server-side, post-response, decoupled from the client save-to-history). **MVP interim
> (ship-time, not deferred, so not filed as items here):** Anthropic **auto-reload OFF** (already set —
> prepaid-balance depletion is the hard dollar cap that survives a total metering outage; a Console spend
> limit is the alternative), plus a weekly manual reconciliation (`sum(spent_cents)` for the period vs the
> Console's actual spend). The
> items below automate that and close the durability gap. _(surfaced during the P5W3 pre-flight
> metering-robustness review, 7/7/26)_

- [ ] **Automated reconciliation + drift alerting** — a scheduled job that compares `sum(spent_cents)` per
  billing period against Anthropic's actual usage/cost (Admin/Cost API or Console export) and alerts when they
  diverge past a threshold. This single check catches all three silent-drift classes at once: a pricing-map
  error, a mass write failure (metered total < actual), and a new billable token type the parser doesn't
  capture (`MODEL_PRICING` / `AnthropicUsage` in `proxy/src/metering.ts` are a hand-maintained mirror with no
  self-check). Ground truth is Anthropic's bill; internal metering is an estimate that should be reconciled
  against it. Replaces the manual weekly eyeball once volume warrants.

- [ ] **Durable persistence of failed usage writes (queue / dead-letter / replay)** — today `recordUsage`
  retries twice inline then logs-and-drops (`proxy/src/metering.ts:77-86`), and `meterResponse` runs in
  `ctx.waitUntil` (`proxy/src/index.ts:289`) with no durable backing — so a Supabase outage, rotated
  service-role key, or worker eviction loses that increment **permanently**. Worse: the entitlement gate reads
  the same `spent_cents` (`get_entitlement` → the gate at `proxy/src/index.ts:203`), so a *mass* write outage
  silently disables the cap (spent never rises → always "under cap" → unbounded spend on the key) — which is
  why the Console hard spend limit is the ship-time backstop. Fix: persist the token counts durably the instant
  the proxy has them — a Cloudflare Queue producer in the request path, or an append-only `usage_events`
  insert — with a retry consumer that records into Supabase; at minimum, dead-letter a failed increment for
  later replay. **Shares the `record_usage` write path with "Usage-meter write at scale" under Billing /
  payments ops above — build the async/batch/durable write once, together.**

- [ ] **Alarm silent metering drops** — `meterResponse` returns silently on a 2xx that yields no parseable
  usage or a null `periodStart` (`proxy/src/metering.ts:104-106`); only the throw path logs. If Anthropic ever
  changes the success-response shape, you'd spend and record nothing, invisibly. Emit a log/metric/counter when
  a 2xx yields no usage (or an entitled caller has a null period) so a systematic parse break surfaces in
  observability instead of zeroing usage undetected. Small (a couple of lines) — could be pulled forward
  pre-ship.

- [ ] **Idempotency to prevent double-metering on SDK retry** — the over-billing direction. The Anthropic SDK
  auto-retries on 429/5xx/timeout; a request Anthropic actually completed but that timed out client-side gets
  re-sent, forwarded again, and metered twice (Anthropic bills you twice too). No idempotency key today. Key the
  meter on the request/response id so a retried-but-already-served call isn't counted twice. Lower priority than
  the under-billing leaks above (it protects the user's fairness + your real cost, not your revenue).

> Related: the **streaming-abort zero-usage fix** (parse usage incrementally so a client abort mid-stream still
> meters what was generated) is already tracked with the `chat()`→`stream()` swap under **Chat UX polish**
> above — not duplicated here.

---

## Motion quality / video

- [ ] **\*\*\* NEEDS GRILLING \*\*\* — AI video generation built into the workflow.** Generate AI video from inside Cubic (UI stays Cubic-side) and have Cubic drop the result straight onto the AE timeline — add as a footage layer / drag-drop into the active comp at the playhead, no manual import round-trip (`importAssetToComp` already does the import half). Grill before building: which gen model/provider; asset storage + naming; how the user prompts/triggers it in the UI; placement + in/out defaults; cost/latency + whether it's a separate credit pool from the LLM allowance; pairs with "let the AI view generated video" below for a generate→inspect→refine loop. Net-new feature, not just a tool.
- [ ] **Let the AI view generated video** (not just images) — likely via Gemini's video capability. _(was TODO-phase4-later "Super important")_
- **Motion-quality judgement / taste tuning** → NOT duplicated here. It is the **Phase 5 §G-0 hard ship gate**;
  protocol + rubric live in `taste-eval.md`. Recipe/tool capability gaps that the taste eval surfaces get filed here as
  concrete items when found.
