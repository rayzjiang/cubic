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

**5. WT-PAYWALL-UX** — §D (needs WT-AUTH + WT-BILLING + WT-PROXY-GATING)
- [ ] §B-5 branded OAuth "you're signed in — close this tab" page (hosted HTTPS page fires the `cubic://` deep link + tells the user to close the tab; replaces the current hanging browser tab). Repoint `auth.ts` `redirectTo` + Supabase allow-list. Slotted here: consumer UX/copy + the Cloudflare Worker (Wave 2) can host it. Not a blocker.
- [ ] enrich the signed-out `AuthScreen` (pre-launch) — first + only surface a logged-out user sees (prod gates home/chat behind sign-in); make it engaging (carousel of use cases / sample before→after outputs) vs today's minimal "Welcome to Cubic / Sign in with Google." Distinct from signed-in `HomeView`.
- [ ] §D-1 first-run sequence: sign in → connect AE → try it → **paywall last**
- [ ] §D-2 paywall + limit states ("trial ended" / "out of allowance") → Checkout
- [ ] §D-3 "Manage subscription" → Customer Portal
- [ ] §D-4 non-technical copy throughout (consumer tone, no dev/terminal language)
- [ ] §D-5 finish the account/profile menu (ChatGPT-style) — name/avatar/Log out (§B-4 shell) + plan tag + Upgrade (§D-2) + Manage subscription (§D-3) in one dropdown
- [ ] account-widget polish (carried from WT-AUTH): (1) window-resize responsiveness — avatar/signed-in widget glitches on window grow/shrink → reflow cleanly, mirror ChatGPT/Claude desktop apps; (2) chat-page sidebar-collapse — avatar Y position shifts, must stay pinned at the same Y level

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
- [ ] §E-4 DMG drag-to-Applications installer
- [ ] §E-5 prod-harden the AE-bridge install (P5W2 audit L1) — today `installBridge.ts` flips Adobe `PlayerDebugMode=1` (permanent, machine-wide, never reverted) + copies an UNSIGNED CEP panel on **every** launch, ungated (`index.ts:104`). It can't just be `!app.isPackaged`-gated (packaged builds would then have no working bridge). **Decision needed:** gate/scope the debug-mode flip to dev + accept the tradeoff, **vs** adopt a signed ZXP. ⚠️ **PRD tension** — `docs/PRD.md:35` deliberately chose *no ZXP* ("enables debug mode… No separate plugin installer, no ZXP"), so the signed-ZXP fix reverses a stated design goal; resolve here, not by default.

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
- [ ] §G-4 refund + support process — real inbox + refund SOP

---

## Order / dependencies
- **Wave 1:** 1 ∥ 2 ∥ 3 (set up the Supabase project in WT-AUTH before WT-BILLING leans on it). WT-WS-AUTH floats — drop into any open lane.
- **Wave 2:** WT-4 integrates 1+2+3 (needs all merged); same `proxy/` codebase as WT-1 so it follows it. WT-WS-AUTH can run parallel here.
- **Wave 3:** WT-5 needs 2+3+4.
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
