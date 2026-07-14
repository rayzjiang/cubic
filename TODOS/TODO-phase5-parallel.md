# Phase 5 — Worktree execution plan (grouping · order · parallelization)

> Build order for `TODO-phase5.md`: every source item (§A-1 … §G-4, §???) reorganized into worktrees, labeled with its source ID. Numbers = worktrees / Claude sessions. Assumes Phase 4 done.

**Why it parallelizes well:** the big chunks are *separate services* — Cloudflare Worker (proxy), Supabase (auth+DB), Stripe (billing), the local WS layer, build/release tooling — not one shared `app/` dir. Contention is only where client integration touches `app/` and where the proxy's gating steps need auth+billing to exist first.

**Critical path:** `(1 ∥ 2 ∥ 3) → 4 → 5 → WT-ANALYTICS → 6 → 7 → launch gates`. WT-WS-AUTH floats free of all of it; WT-ANALYTICS is a *late* float — pinned after Wave 3 (see Wave 3.5 below).

---

## Front-load NOW (procurement/decisions — long lead, block later waves; not worktrees)
- [x] §B-2 — buy Apple Developer account ($99/yr); blocks WT-AUTH (Apple OAuth) + WT-PACKAGING (sign/notarize)
- [ ] §C-8 — lock price + allowance/trial-cap numbers; WT-BILLING config + WT-PROXY-GATING metering need real numbers

---

## Wave 1 — paid-backend foundation (up to 3 parallel; separate services → near-zero file overlap)

**1. WT-PROXY-CORE** ✅ **DONE — merged to main** — §A core (new `proxy/` Worker; testable with just the API key)
- [x] §A-0 keep the four test surfaces alive (MCP-only · direct-local `npm run dev` · full-stack-local via `wrangler dev`+`supabase start`+Stripe test · prod). §A-3 forks the client (proxy vs direct), keeps the `CUBIC_ENV=local` direct branch as default; full-stack-local = `CUBIC_ENV=prod` + `CUBIC_PROXY_URL=localhost:8787`. Dev every §A–§C component against its emulator before deploy.
- [x] §A-1 move crown jewels server-side → Worker (`prompt/rules.ts` + `tools/definitions.ts`; strip from client)
- [x] §A-2 Worker = Anthropic-shaped streaming passthrough (`ANTHROPIC_API_KEY` as Worker secret)
- [x] §A-3 repoint client (`llm/anthropic.ts` `new Anthropic` → proxy `baseURL`, no on-device key)
- [x] §A-9 keep `cache_control` breakpoint on the static prefix (prompt-cache win)

**2. WT-AUTH** ✅ **DONE — verified end-to-end (merged to main)** — §B (Supabase project + `app/` auth UI; stand up the Supabase project here first)
- [x] §B-1 Google + Apple OAuth via system browser → `cubic://` deep link _(Google live + verified; Apple = config-only follow-up, §B-2 account acquired)_
- [x] §B-3 secure on-device session — Electron `safeStorage` + auto-refresh
- [x] §B-4 sign-in / sign-out UI + signed-out state + session recovery on launch (+ account-menu *shell/initial ui*: name/avatar/Log out; plan+Upgrade fill in at §D-5)
- _Real Supabase cloud project stood up + Google OAuth configured; local emulator deferred to WT-BILLING. §B-5 (branded OAuth success page) → Wave 3 WT-PAYWALL-UX._

**3. WT-BILLING** ✅ **DONE — backend built + verified (offline + Stripe test-mode E2E for subscribe→entitled); merged to main** — §C (Stripe + Supabase; `supabase/` dir owned + created here)
- [x] §C-1 `subscriptions` (PK user_id, never-delete, `stripe_customer_id` inline — no separate `customers` table) + `plans` (allowance SSOT) + `usage` (cost-cents counter) + `get_entitlement` RPC — webhook-written only
- [x] §C-2 Stripe Checkout + Customer Portal edge functions → `cubic://` back _(Checkout verified E2E; Portal built, not yet clicked-through → §G-3)_
- [x] §C-3 webhooks → Supabase sync (only writer of paid-state) _(verified for subscribe; cancel/past_due via real Stripe webhooks → §G-3)_
- [x] §C-4 trial built but **DEFAULT OFF** (trial-agnostic: `trial_period_days` flag + `trialing` status + cap constant) — no free tier, everyone paid day 1
- [ ] §C-5 trial-cap sizing → deferred to §G-1 (trial currently OFF; `TRIAL.capCents` placeholder exists)
- [x] §C-7 abuse defenses — Stripe Radar (dashboard) + one-active-sub-per-customer; one-trial-per-card moot (no trial); per-user rate-limit = §A-7 (Wave 2)
- _Locked: 2 tiers (Pro+Max), allowance = internal cost-cents shown as %-bar, billing-cycle-anchored reset, past_due ~24h fail-fast grace, entitlement gates the LLM call (not app access). §C-6 cap enforcement = Wave-2 proxy. §C-8 price/allowance numbers = placeholders → §G-1. Full E2E (Portal, real cancel/past_due webhooks, prod deploy) → §G-3._

**(floats — slot into any free lane; ship-blocker, collides with nothing)**
**WT-WS-AUTH** ✅ **DONE** — §??? (local transport hardening; `wsBridge.ts` + `getBackendPort()` IPC + `bridge/client.ts` + AE panel + preflight/tests)
- [x] §???-4 dynamic backend port — `bind 127.0.0.1:0`; backend reads the actual port back + reports `{port, token}` up to main (getBackendPort now returns `{port, token}`) + publishes `~/.cubic/conn.json`; fixes Phase-4 §B "port-in-use"
- [x] §???-1 per-launch session token minted at startup (`crypto.randomUUID`), delivered via `getBackendPort()` IPC (renderer) + `~/.cubic/conn.json` (panel + loopback)
- [x] §???-2 reject sockets whose `hello` frame lacks the token (all 3 client types + dev preflight + integration tests); close `4001` on bad token / ~2s no-auth timeout
- [x] §???-3 explicit `127.0.0.1` bind — preserved as `bind 127.0.0.1:0` (loopback-only)

---

## Wave 2 — make the proxy gate + meter (integration; same `proxy/` codebase as WT-1 → follows it)

**4. WT-PROXY-GATING** — §A remainder (needs WT-AUTH + WT-BILLING merged) — **gate built + verified locally; only the real-deploy capstone (§A-8) remains**
- [x] §A-4 verify Supabase JWT on every request (needs WT-AUTH) — `proxy/src/auth.ts`, JWKS via `jose`; token rides the `userChat` frame → per-request header
- [x] §A-5 entitlement check — read `subscriptions`, cached ~30–60s (needs WT-BILLING) — `entitlement.ts`, service-role `get_entitlement`, strict fail-closed (503)
- [x] §A-6 usage metering — write usage + deduct allowance + reject over cap (needs WT-BILLING + locked numbers) — `metering.ts`/`usage-parse.ts`, tee + async `waitUntil` → new `record_usage` RPC
- [x] §C-6 cap/trial enforcement at the proxy → emits the "out of allowance / trial ended" signal — over-cap → 402; client maps 401/402/429 (interim copy; §D screens = Wave 3)
- [x] §A-7 per-user rate-limit + abuse guard — Cloudflare native `RATE_LIMITER` (per user) + `IP_RATE_LIMITER` (per IP) + free edge DDoS
- [ ] §A-8 wire the client to prod-by-default + real-deploy E2E capstone. The Worker + cloud Supabase are already deployed; what's left client-side: **bake the prod proxy URL + Supabase URL/anon-key into the prod build** so a signed app auto-routes through the proxy with no env vars (today `app/src/main/config.ts` reads `CUBIC_PROXY_URL`/`SUPABASE_*` from the shell with no baked default → the app can't reach the deployed Worker unless you pass them manually); **refresh the stale "stub" comments** that still claim the proxy doesn't exist yet (`config.ts:29` + `:37`, and `app/README.md`'s §B7 line); then run the **full clean-machine E2E** (also lands the pulled-forward §G-3 cloud-Supabase check). Keep direct-local the dev default.

---

## Wave 3 — consumer-facing flow (`app/` renderer)

> **Long wave → split into 3 sequential sub-plans, each its own grill+plan+execute session: `P1 → P2 → P3`.** WT-PAYWALL-UX overall needs WT-AUTH + WT-BILLING + WT-PROXY-GATING merged.
> **Shared spine (architecture primer):** the renderer never talks to Supabase. **Main** owns every Supabase/Stripe call and hands data to the renderer over **IPC** (mirrors `app/src/main/auth.ts` + `getAccessToken()`); the renderer only displays + triggers. Two separate entitlement reads: the **gate** (allow/deny a chat) already lives in the Worker (Wave 2 → 402, UI maps it in `store.ts:59-78`); Wave 3 builds the **display** side (plan tag, usage %-bar, Upgrade/Manage/paywall) — a net-new Main-fetch + IPC surface. **§D-6 app-switcher = DONE** (`AeStatus.tsx`).
> **Per-sub-plan close-out convention:** each sub-plan's execution ends with (1) a Summary of code changes + functionality, (2) a manual-verification section (exact terminal/curl commands + what to click/look at), (3) a table of one-line conventional commit messages ↔ files.

**5a. Plan 1 — Billing & account surfaces (the money path)** ✅ **DONE (core) — client built + verified (typecheck + 22 unit tests + `electron-vite build`); still open: manual E2E click-through, the §D-3 Dashboard toggle, and a Settings tabbed-reorg + blurred-backdrop follow-up (below)** — §D-2 · §D-3 · §D-5 + Settings + plumbing
> Foundation first (the plumbing), then every surface that reads entitlement or opens Stripe.
> **P1 status / deviations from the sketch:** (1) **`past_due` is fail-fast (0 grace)** now, so it's an in-context banner, NOT the old "escalates after 24h" idea. (2) Unified blocking rule (from the grill): **full-takeover only when blocked AND 0 chats** (true cold start); blocked-with-history (canceled/past_due/over_cap) → in-context banner + gated composer; `reason` drives copy/CTA only. (3) **Delete-account entry DEFERRED to P2**, **legal/support links DEFERRED to §G-2/§G-4** (no dead rows). (4) Two-tier picker; **display prices are §G-1 placeholders** in `app/src/renderer/src/billing/plans.ts`. (5) ⚠️ **§D-3 Portal "switch plans" Dashboard toggle + the `cubic://billing/*` cloud redirect-allow-list are still MANUAL/pending.**
- [x] **Client billing plumbing (the spine)** — Main-side, exposed over IPC mirroring `auth.ts`: `getEntitlement()` (call `get_entitlement` RPC with the user's JWT — self-read already granted to `authenticated`, returns `spent_cents`/`allowance_cents`/`period_end`/`status`/`plan`); `openCheckout(plan)` / `openPortal()` (fetch the `create-checkout`/`create-portal` edge-fn URL → `shell.openExternal`); `cubic://billing/*` deep-link return → refresh entitlement. No Supabase in the renderer. _(DONE: new `app/src/main/billing.ts` `BillingManager` mirrors `AuthManager` + `cubic:billing:*` channels; return uses a **bounded-backoff poll** to absorb webhook lag; renderer `billing` store slice + focus-refresh + 402 backstop; billing helpers in `renderer/src/billing/`.)_
- [x] **§D-5 account menu** — replace the `AccountWidget.tsx:83` "Plan" placeholder with the real tier; add Upgrade CTA (→ Checkout §D-2), Manage subscription (→ Portal §D-3), Settings entry. Dropdown stays quick-actions only (name, plan pill, Settings, Log out); detail moves to Settings (ChatGPT/Claude split). _(DONE: real plan pill; contextual **Upgrade** only when no active sub; **Settings** row; Manage moved to Settings. Dropdown animates open+close via `AnimatePresence`, mirroring `AeStatus`.)_
- [x] **Settings page/modal** — opened from the §D-5 pill. MVP-minimal: **Account** (email, current plan, Manage subscription → Portal §D-3, **Delete-account entry point** — wired live in P2), client-readable **usage %-bar** (`spent_cents`/`allowance_cents` from `get_entitlement` — the billing model's headline meter; the user's own row is already readable via their JWT, no new SQL), and **legal/support links** (Privacy + ToS §G-2, support/contact §G-4). Optional: theme toggle (deferred). _(declutters the overloaded §D-5 dropdown)_ _(DONE: `SettingsModal.tsx` (animated open+close) = Account (email, plan, state-aware Manage subscription→Portal / Subscribe→picker) + usage %-bar (percent + reset date, amber/red). **Delete-account entry DEFERRED to P2**; **legal/support links DEFERRED to §G-2/§G-4** — omitted rather than shown as dead rows. Usage % uses normal rounding.)_
- [x] **§D-2 paywall + limit states** — real screens replacing the interim `store.ts:59-78` band, routed off the existing 402 `reason` (`no_plan`/`over_cap`/`past_due`) → Checkout. _Initial direction (finalize in P1's session): no_plan → blocking paywall (post-signup); over_cap → blocks sending but chats stay viewable/interactive; past_due → non-blocking top banner → escalates to blocking after the ~24h grace._ _(DONE — reusable `Paywall.tsx` (takeover + in-context banner + picker modal, all animated). **Finalized rule:** full-takeover only when blocked AND 0 chats (cold start); blocked-with-history → in-context banner + gated composer. `past_due` is fail-fast (0 grace) → in-context, not the "escalate after 24h" sketch. Driven by proactive entitlement state + a 402 refetch backstop; reason→copy: no_plan→picker(Checkout) · over_cap tier-aware→Portal · past_due→Portal.)_
- [x] **§D-3 "Manage subscription" → Customer Portal.** **Portal config (Dashboard, zero-code):** enable "Customers can switch plans" + list both Pro & Max prices so **upgrade/downgrade** works self-serve (cancel + payment-method work by default; plan-switching is OFF until enabled). "Upgrade" routes through Checkout only for the first paid conversion; everything post-subscribe (up/downgrade / cancel / payment method / invoices) is the Portal — no custom in-app plan-change UI. _(DONE client-side: `openPortal` wired from Settings + the over_cap/past_due paywall CTAs. ⚠️ **STILL MANUAL/pending**: the Dashboard "Customers can switch plans" toggle + listing both prices — without it the over_cap Pro→Max path can't switch. Do before the §G-3 E2E.)_
- [x] **Account-widget polish** (carried from WT-AUTH) — done in-pass since §D-5 rewrites `AccountWidget.tsx`: (1) window-resize responsiveness — widget glitches on window grow/shrink → reflow cleanly, mirror ChatGPT/Claude desktop apps; (2) chat-page sidebar-collapse — avatar Y position shifts, must stay pinned at the same Y level. _(DONE: popover re-anchors to the trigger on window resize (was stale fixed coords); collapsed avatar pinned to the same Y as expanded via `pb-1.5` compensating the expanded widget's extra padding.)_
- [x] **Settings tabbed reorg (reorganize only — no new features) + blurred backdrop** — restructure `SettingsModal.tsx` into a left **sidebar of tabs**, each with a tiny icon, top-down: **General** (gear icon; default tab; empty now → placeholder text), **Account** (person/avatar icon), **Billing** (credit-card icon), **Usage** (bar-graph icon), plus a future **Learn more** tab (legal/policy → §G-2; placeholder for now). Move the EXISTING content into tabs: **Account** = email; **Billing** = current plan + Manage subscription (→ Portal, existing) + **"Renews `<date>`"** (from `period_end`, active subs — pure display, no backend, renewal-date only); **Usage** = the %-bar. Blank tabs show placeholder text. Also **blur/dim the modal backdrop** (`backdrop-blur`, Claude-style) on the Settings + picker modals. _(No new functionality — the fullscreen plan-selection/paywall redesign + upgrade/downgrade labels are DEFERRED to P3 below.)_

**5b. Plan 2 — Account deletion (isolated · destructive · backend-heavy)** — §D-5 delete flow
> Reuses P1's plumbing + the Settings "Delete account" entry. Net-new backend (Wave-1 `supabase/` is finalized → lands here, not there). Different from plan cancelling/upgrading.
> **P2 decisions (LOCKED 2026-07-12, grill+plan session):** (1) **Claude-style cancel-before-delete gate** — Delete lives under Settings→Account, **BLOCKED** while a sub is still renewing (`cancel_at_period_end=false`) → shows a direct **Cancel plan** CTA; **unlocks the moment cancellation is scheduled** (`cancel_at_period_end=true`) / already `canceled` / no sub — same-day, NOT waiting for the period to lapse. (2) Cancel = Stripe Portal **at-period-end** (keep access til period end, no refund — SaaS standard). Delete edge fn = defensive immediate `stripe.subscriptions.cancel` → `deleteUser`. (3) **Confirm** = type `delete` to enable a red "this can't be undone" button (type-to-confirm + warning). (4) **Local data = session only** — chats are AE-project-scoped/device-local (Claude Code model), so NOT wiped on delete; `~/.cubic` (sessions/frames) cleanup **deferred to the §E uninstaller**; never touch `.cubic-backups/`. (5) **Direct "Cancel plan" deep link** via Stripe `flow_data.type=subscription_cancel` (no Portal-home hunting) — needs `create-portal {flow:'cancel'}` + `openPortal('cancel')`. (6) Needs exposing `cancel_at_period_end` from `get_entitlement` (new migration; it wasn't returned before). **Claude reference (verified privacy.claude.com):** stricter — cancel, then WAIT until the period lapses, THEN delete. **Churn-max switch (future):** flip the client unlock predicate from `cancel_at_period_end` to `status='canceled'` (~one line) to copy Claude exactly.
- [x] **Net-new `delete-account` edge function** (service-role) — **cancel the Stripe subscription FIRST** (`stripe.subscriptions.cancel`, mirror `stripe-webhook/index.ts:131`), **then** `admin.auth.admin.deleteUser` (cascade clears `subscriptions`/`usage`). ⚠️ Deleting the Supabase user alone does **NOT** stop billing — only the Stripe cancel does → cancel-first mandatory (reverse order orphans a live sub billing a ghost). _(DONE: `supabase/functions/delete-account/index.ts` retrieves the live Stripe sub, immediate-cancels unless already terminal, FAILS CLOSED (502, no delete) on any non-`resource_missing` cancel error, then `deleteUser`. `config.toml` `verify_jwt=false`. Note: our final flow does the ordinary cancel at-period-end via the Portal (keep access); the edge fn's cancel is the defensive immediate backstop at delete time.)_
- [x] **Webhook ordering hardening** — `apply_subscription` INSERTs on `subscriptions.user_id` (FK → `auth.users`); a late `customer.subscription.*` after the user is deleted → FK failure → 500 + Stripe retry loop. Make `stripe-webhook` **no-op gracefully on an unresolvable/already-deleted user**. _(DONE: `resolveUserId` returns `null` (was throw) → `applySubscription` logs + no-ops; and the RPC's `23503` FK violation is caught → logs + no-ops. Both → 200, no retry loop. Offline harness asserts the 23503 case + cascade.)_
- [x] **Destructive confirm UI** — a "Delete account" entry (Settings, from P1) → a **deliberate, explicitly-confirmed, irreversible** flow (destructive-action warning per house rule). _(DONE: `DeleteAccountModal.tsx` — type `delete` to enable a red "this can't be undone" button; animated; inline error + session-left-intact on failure; success routes to AuthScreen via the auth `change` broadcast.)_
- [x] make sure the ui for deleting account is under the settings -> account AND users have to cancel subscription before deleting account (same way claude does it) _(DONE: entry in Settings→Account, gated by `canDeleteAccount(billing)`; blocked state shows a direct **Cancel plan** (Stripe `flow_data`) CTA. Built + statically verified (app typecheck/26 tests/build; `deno check` all edge fns; `bash -n` harness); runtime offline-harness + full-stack-local E2E still to run.)_

**5c. Plan 3 — Onboarding & polish (pre-paid wrap + capstone)** — §B-5 · §D-1 · §D-1a · §D-4 + AuthScreen + fullscreen paywall + settings-finalize
> **Split into 3 sequential sub-plans, each its own grill+plan+execute: `P3a → P3b → P3c`.** The 7 items span 5 work-types (visual UI · greenfield flow · new renderer↔bridge plumbing · Worker infra · copy sweep) → one plan would bleed. Order forced by deps: build screens → wire them into the flow → OAuth page + copy sweep last. Full scoping rationale + per-item file notes: `~/.claude/plans/lets-start-planning-work-rosy-crayon.md`.

**P3a — Surfaces & polish** (pure visual; first, so P3b/P3c consume finished screens)
- [x] **Enrich the signed-out `AuthScreen`** — engaging (use-case carousel / before→after) vs today's bare "Welcome to Cubic / Sign in." Distinct from signed-in `HomeView`. _(DONE — landed as a full-bleed **WebGL flowing-lines hero** (`AuthBackground.tsx`, `ogl` + a custom GLSL shader, all knobs in one tunable CONFIG) behind a centered card-less Google sign-in; perf-guarded (DPR cap, pause-on-blur, unmounts off the hot path) + reduced-motion/WebGL-fail static fallback. Copy placeholder → P3c.)_
- [x] **§D-3 fullscreen conversion paywall** — promote P1's picker modal → full-screen Claude-styled page w/ back button; per-card **Checkout** (first sub) vs **Portal** (up/down-grade) routing + contextual upgrade/downgrade/"current plan" labels; always reachable for both tiers; drive conversions. _(DONE — `FullscreenPaywall.tsx`: ONE reason-driven surface = cold-start takeover + store-driven overlay, replacing `PaywallTakeover` + `PlanPickerModal`; per-card Checkout / one-click Portal-**switch** routing + Current/Upgrade/Downgrade labels + highlight bullets; Back button; layers over Settings. Plus `create-portal` **deep-links** (`cancel` / `update_card` / `switch`=`subscription_update_confirm`) + `openPortal(flow,plan)` across the IPC surface. ⚠️ `switch` needs the manual Stripe "switch plans" toggle; cancel-deep-link fix to confirm at §G-3.)_
- [x] **Finalize the Settings page for MVP** — looks ugly post-P2 → match Claude. _(DONE (core) — kept the structure, **no scrim blur** (per decision): darker two-tone tab rail, fixed the doubled dividers, populated tabs — General=**About + live version** (new `getAppVersion` IPC), Account=**profile + Log out**, Billing=**Change plan** (→ paywall) / Manage / Cancel, Usage=**plan name** + %-bar; P2 delete + cancel-confirm intact. Follow-ups below still open.)_
    - [x] make sure its responsive (if the width of the window gets too small, move the tabs to the top like claude code + make it horizontally scrollable with no more icons) _(DONE — below 768px (`useIsNarrow`) the left rail collapses to a top `Settings` + ✕ header bar with a horizontal, `overflow-x-auto`, text-only tab strip; shared per-tab content; instant snap.)_
    - [x] add invoice history to billing page (just like claude, i think stripe gives us the data for that) _(DONE — new `billing-details` edge fn (mirrors create-portal) returns the default card + recent invoices via `stripe.invoices.list`; plumbed as `getBillingDetails()` + `openInvoice(url)` over IPC; Billing tab rebuilt Claude-style: plan block (Adjust plan) + Payment (live card + Update→update_card) + Invoices table (Date·Due·Total·Status·View) + Cancellation. **Dropped "Manage subscription"** (every action now deep-linked). Icon/copy deferred.)_
    - [x] finalize settings page (to match claude ui i guess) _(Billing tab now matches Claude; remaining polish on the other tabs still open.)_
- [x] Add Cubic (company name duh) to the sign in page + home page + new chat page? (def sign in page, prob make it the BIGGEST font of the 3 and put it right below logo? - or maybe to the right of logo)

**P3b — First-run flow + AE-access gate** (flow orchestration + new transport plumbing)
- [x] Onboarding sequence?? (before paywall)
- [x] **§D-1 first-run sequence** — sign in → connect AE → try it → **paywall last** (greenfield; ends at P3a's paywall).
    - [ ] save somewhere in this todo phase 5 to use fable to ensure states + file organization (like components, its hella long rn) are optimal + cleanly organized like a good engineering codebase + non redundant (i want it efficient, id rather ensure im engineering things well now, then have to figure out whats wrong later as my codebase gets bigger + laggier potentially)
- [x] **§D-1a require AE file access** — renderer→bridge `checkFileAccess` (backend done; needs a renderer request/response caller); on `canWriteFiles:false` block w/ the AE **Settings → Scripting & Expressions → "Allow Scripts to Write Files…"** step, re-check until enabled.

**P3c — OAuth page + copy closeout** (isolated infra + final sweep)
- [ ] **§B-5 branded OAuth success page** — hosted HTTPS page fires `cubic://auth/callback?code=…` + "close this tab"; repoint `auth.ts` `redirectTo` + Supabase allow-list; host on the Worker. Not a blocker (deep link already works).
- [ ] **§D-4 non-technical copy pass** — consumer tone across ALL Wave-3 screens (incl. P2 delete copy) → **dead last**.

**Order / deps:** P1 → P2 → P3 (**P3 = P3a → P3b → P3c**, see §5c). P2 needs P1's plumbing + the Settings delete-entry; P3's first-run ends at P3a's paywall, and its copy pass sweeps P2's screens. Then Wave 3.5 (WT-ANALYTICS).

---

## Wave 3.5 — instrument the finished flow (WT-ANALYTICS; after Wave 3, before packaging)

**WT-ANALYTICS** — §H (PostHog event hooks, server-side, in the backend agent loop + dispatcher). **Pinned here, not a free float:** wiring it after Waves 1–3 and before §E packaging means every dependency is already in place → one unblocked pass, no returning to it later.

**Why here (nothing blocks it anymore):**
- **Identity for free (from Wave 2):** §H-1 `identify(userId)` needs the Supabase user id *inside the backend child*, which today carries only `CUBIC_ENV`. WT-PROXY-GATING §A-4 already plumbs the Supabase JWT renderer→backend for the proxy call (the `CUBIC_AUTH_TOKEN` stub in `llm/anthropic.ts`); its `sub` is the user id. After Wave 2, `identify` piggybacks instead of building throwaway plumbing.
- **Final surfaces + conversion fire sites (from Wave 3):** §H-3 instruments the first-run flow (`app_opened`/`ae_connected`/`first_prompt_sent`/`first_edit_succeeded`) that WT-PAYWALL-UX §D rebuilds — instrument once, after it's final. §H-4's `paywall_hit`/`trial_started`/`subscribed`/`canceled` only have fire sites once §D (+ the Wave-2 gate) exist.
- **Before §E packaging:** §H-1 fires server-side to "survive §E obfuscation" → the analytics code must be in the bundle *before* WT-PACKAGING obfuscates/signs it, and gets exercised by the §G-3 clean-machine E2E.

- [ ] §H-1 PostHog project + `posthog-node` in backend; identify by Supabase user id (id now available via Wave-2 §A-4)
- [ ] §H-2 dispatcher `command_run { command, ok, retries }` event — the high-signal one (fire at the `executeTool` chokepoint, the 92-verb path). _Only §H item with standalone value pre-launch — can pull forward for dogfooding failure rates during §G-0 if wanted._
- [ ] §H-3 activation funnel (`app_opened`/`ae_connected`/`first_prompt_sent`/`first_edit_succeeded`) — instrument the *final* §D first-run flow
- [ ] §H-4 conversion funnel (`trial_started`/`paywall_hit`/`subscribed`/`canceled`) — fire sites land with the Wave-2 gate + §D; note `subscribed`/`canceled` are a *separate* integration in the remote Supabase `stripe-webhook` (Deno runtime, not `posthog-node`)
- [ ] §H-5 privacy line (no prompt/project content sent — verb names + outcomes + counts only) → feeds §G-2 Privacy Policy

---

## Wave 4 — ship the binary (serial — build/release tooling)

**6. WT-PACKAGING** — §E (needs app feature-complete + Apple account)
- [ ] §E-1 obfuscate bundled Electron JS + `.jsx` (`javascript-obfuscator`)
- [ ] §E-2 harden Electron — asar + asar-integrity + fuses
- [ ] §E-3 code-sign + notarize (Apple Developer account)
- [ ] §E-4 DMG drag-to-Applications installer — **on UNINSTALL, clean `~/.cubic` (`sessions/` chat history + `frames/`)**: P2 deliberately leaves this device/project-scoped local data in place on account-delete (chats are AE-project-scoped, Claude-Code-style, not account-tied), so uninstall is where it gets removed. Never touch project-side `.cubic-backups/`.
- [ ] §E-5 prod-harden the AE-bridge install (P5W2 audit L1) — today `installBridge.ts` flips Adobe `PlayerDebugMode=1` (permanent, machine-wide, never reverted) + copies an UNSIGNED CEP panel on **every** launch, ungated (`index.ts:104`). It can't just be `!app.isPackaged`-gated (packaged builds would then have no working bridge). **Decision needed:** gate/scope the debug-mode flip to dev + accept the tradeoff, **vs** adopt a signed ZXP. ⚠️ **PRD tension** — `docs/PRD.md:35` deliberately chose *no ZXP* ("enables debug mode… No separate plugin installer, no ZXP"), so the signed-ZXP fix reverses a stated design goal; resolve here, not by default.
- [x] §E-6 seamless AE bridge — **DONE + live-verified.** Invisible auto-starting headless panel via Adobe's invisible-extension recipe: `<Type>Custom</Type>` + `<AutoVisible>false` + `<StartOn>` (ApplicationInitialized/Activate) + no `<Menu>` → loads invisibly on AE launch, never in Window→Extensions, auto-connects with zero user setup. **Instant + zero-idle-poll connect** via Node `--enable-nodejs` + `fs.watch` on `~/.cubic/conn.json` (dormant/0 CPU while Cubic closed; wakes the instant Cubic writes conn.json; bounded quick-retries for transient drops; ExtendScript-read + backoff fallback if node absent). Also: `checkFileAccess` detection command (→ §D-1a gate), `.debug` Extension-Id fix (DevTools at http://localhost:8088 is the ONLY way to debug the invisible panel — see `server/ae-bridge/CLAUDE.md`). (Earlier `<Type>Panel>` attempt failed — dockable → workspace-persisted + throttled — and was corrected. Cubic can't load/unload the extension itself; CEP loads only at AE startup/activate, so dormancy is the idle model.) The app-switcher status dropdown that grew out of this is consumer UI → moved to Wave 3 §D-6.

**7. WT-AUTO-UPDATE** — §F (strictly after WT-PACKAGING — reuses its signing identity)
- [ ] §F-1 update feed on Cloudflare R2 (release script uploads signed artifacts + `latest.yml`)
- [ ] §F-2 signed updates (reuse §E identity → no Gatekeeper re-trigger)
- [ ] §F-3 update UX — background download → "restart to update"
- [ ] §F-4 seamless updates — never touch/reload the AE panel
- [ ] §F-5 (optional) staged rollout / beta channel

---

## Launch gates — final, sequential (not a worktree; gates ship)
- [ ] §G-1 price + cap numbers locked (confirms §C-8 decision is made, not TBD)
- [ ] §G-2 ToS + Privacy Policy published — *start drafting early (legal lead time)*
- [ ] §G-3 full paid flow tested E2E on a clean machine (install → sign in → trial → cap → pay → use → cancel → revoked)
- [ ] §G-4 refund + support process — real inbox + refund SOP. **Data-erasure / account-closure guard:** the self-serve delete flow (Wave 3 §D-5) covers the common case; for any **manual** deletion (admin-initiated erasure on request), follow the same invariant — **cancel the Stripe subscription BEFORE deleting the Supabase user**, or the `ON DELETE CASCADE` clears the local `subscriptions` cache while the real Stripe sub keeps billing a ghost.
- [ ] **Stripe customer emails ON** (zero-code Dashboard config) — turn on the payment emails customers expect: successful-payment **receipts** (the sample statement), **failed-payment / dunning** (retry + "update your card", schedule matched to the ~24h fail-fast `past_due` grace), and renewal / card-expiry reminders (Settings → Customer emails + Settings → Billing → failed payments). Two things to verify or they don't land right: (1) the Stripe **Customer carries the user's email** (Checkout attaches it by default — confirm in the §G-3 E2E), (2) clean **product/price display names** so the receipt reads "Max plan," not a `prod_…` id. _(promoted to MVP from POSTMVP "Enable Stripe dunning emails")_
- [ ] §G-5 dev/ops runbook (`docs/RUNBOOK.md`) — the maintainer's index of every operational surface so post-ship "where do I change/fix X" has one home. **Do this LAST** (rescan the finished codebase first, so procedures reflect final prod state). Structure: Tier-1 items get full inline procedures (they have no other home) — change a plan's price/allowance (`supabase/scripts/change-plan.ts`, `--dry-run` first, Subscription-Schedules staggered migration), prod deploy (Worker + Supabase functions/migrations + Stripe webhook endpoint), secrets registry + rotation, Stripe manual ops/refund/dispute SOP (folds in §G-4), incident/rollback. Tiers 2–3 = thin pointers to the per-package source-of-truth docs (`app/README.md`, `proxy/CLAUDE.md`, `supabase/README.md`, `server/*/CLAUDE.md`, `docs/ARCHITECTURE.md`, `migrations/`) — index, don't restate. Tier 4 = stub the not-yet-built ops (§E/§F/§H) to fill on completion. Mirrors how `ARCHITECTURE.md` defers to its sources rather than duplicating.
    - claude --resume 91773af0-93fc-4396-aeec-2f7e81af3d18
    - i want to document somewhere (either a new md file or to my root readme.md) all the dev stuff for my product (so ik where to do/fix/change certani things after i ship). do a thorough scan of my codebase for things like this to lmk what could go here. eg: one thing for certain i want to add is the new price migration script for changing price plans or allowance for users on certain plans (since its not documented anywhere rn, id probably forget i have this functionality, so i want somewhere easy for me to find all the stuff like this). Give me a bucketed list into tiers of highest to lowest priority of stuff that should go into a doc like this (think of it as dev documentation so that future develoeprs can help out/maintani my entire cubic software/customers/applicatoin) do u understand?
---

## Order / dependencies
- **Wave 1:** 1 ∥ 2 ∥ 3 (set up the Supabase project in WT-AUTH before WT-BILLING leans on it). WT-WS-AUTH floats — drop into any open lane.
- **Wave 2:** WT-4 integrates 1+2+3 (needs all merged); same `proxy/` codebase as WT-1 so it follows it. WT-WS-AUTH can run parallel here.
- **Wave 3:** WT-5 needs 2+3+4. Internally split into 3 sequential sub-plans: **P1** (billing/account surfaces) → **P2** (account deletion) → **P3** (onboarding/polish) — each its own grill+plan+execute session.
- **Wave 3.5:** WT-ANALYTICS runs after WT-5, before WT-6 — identity from WT-4 (§A-4), final fire sites from WT-5 (§D), wired before §E obfuscates/signs the bundle.
- **Wave 4:** 6 → 7 strictly serial (7 needs 6's signing). Then launch gates.
- **If doing 2 parallel:** Wave 1 = 1 ∥ 2, then 3 in the freed lane (it soft-depends on 2 anyway); fit WT-WS-AUTH wherever.

## Contention notes
- WT-1 and WT-4 share the `proxy/` Worker codebase → sequential, not parallel.
- WT-2, WT-5, WT-6 all touch `app/` (auth UI / paywall / packaging) → different waves, so no collision.
- WT-WS-AUTH is local-transport only (`wsBridge.ts` + IPC + AE bridge) → parallel-safe with everything.
- WT-ANALYTICS is instrumentation-only (adds event calls in the backend loop/dispatcher) → collides with nothing, BUT pinned late (Wave 3.5): it wants Wave-2 identity plumbing (§A-4) + Wave-3 §D fire sites, and must land before §E packaging. Not an early free float.
- WT-1 strips `rules.ts`/`definitions.ts` from the client; nothing else in Phase 5 edits those.
- **Local-first (§A-0):** every paid-backend WT (1–4, BILLING, AUTH) is built+tested against local emulators (`wrangler dev` / `supabase start` / Stripe test) — real cloud/Supabase compute is spent only at the WT-PROXY-GATING §A-8 flip and the §G-3 clean-machine E2E. direct-local `npm run dev` stays untouched throughout.
- Heavy parallelism is Wave 1 (3 separate services at once); Waves 2–4 narrow toward serial as integration + client/build work converge.
