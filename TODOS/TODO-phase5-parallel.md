# Phase 5 — Worktree execution plan (grouping · order · parallelization)

> Build order for `TODO-phase5.md`: every source item (§A-1 … §G-4, §???) reorganized into worktrees, labeled with its source ID. Numbers = worktrees / Claude sessions. Assumes Phase 4 done.

**Why it parallelizes well:** the big chunks are *separate services* — Cloudflare Worker (proxy), Supabase (auth+DB), Stripe (billing), the local WS layer, build/release tooling — not one shared `app/` dir. Contention is only where client integration touches `app/` and where the proxy's gating steps need auth+billing to exist first.

**Critical path:** `(1 ∥ 2 ∥ 3) → 4 → 5 → 6 → 7 → launch gates`. WT-WS-AUTH floats free of all of it.

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

**2. WT-AUTH** ✅ **DONE — verified end-to-end (PR ready)** — §B (Supabase project + `app/` auth UI; stand up the Supabase project here first)
- [x] §B-1 Google + Apple OAuth via system browser → `cubic://` deep link _(Google live + verified; Apple = config-only follow-up, §B-2 account acquired)_
- [x] §B-3 secure on-device session — Electron `safeStorage` + auto-refresh
- [x] §B-4 sign-in / sign-out UI + signed-out state + session recovery on launch (+ account-menu *shell/initial ui*: name/avatar/Log out; plan+Upgrade fill in at §D-5)
- _Real Supabase cloud project stood up + Google OAuth configured; local emulator deferred to WT-BILLING. §B-5 (branded OAuth success page) → Wave 3 WT-PAYWALL-UX._

**3. WT-BILLING** — §C (Stripe + Supabase `subscriptions`; soft-depends on WT-AUTH's Supabase project)
- [ ] §C-1 `subscriptions` table (entitlement source of truth; webhook-written only)
- [ ] §C-2 Stripe Checkout + Customer Portal (hosted) → `cubic://` back
- [ ] §C-3 webhooks → Supabase sync (only writer of paid-state)
- [ ] §C-4 card-up-front 7-day trial (`trial_period_days`, auto-convert)
- [ ] §C-5 keep trial cap very small (pure CAC, few dollars)
- [ ] §C-7 abuse defenses — one-trial-per-card + Stripe Radar

**(floats — slot into any free lane; ship-blocker, collides with nothing)**
**WT-WS-AUTH** — §??? (local transport hardening; `wsBridge.ts` + `getBackendPort()` IPC + `bridge/client.ts` + AE panel)
- [ ] §???-4 dynamic backend port — `bind 127.0.0.1:0`, discover via `getBackendPort()` (**do first** — token + all clients ride this port; fixes Phase-4 §B "port-in-use")
- [ ] §???-1 per-launch session token minted at startup, passed via `getBackendPort()` IPC
- [ ] §???-2 reject sockets whose `hello` frame lacks the token (all 3 client types)
- [ ] §???-3 (optional) explicit `127.0.0.1` bind — already done; just confirm

**(floats — slim, instrumentation-only; depends only on WT-AUTH for user id; collides with nothing)**
**WT-ANALYTICS** — §H (PostHog event hooks in the backend agent loop + dispatcher)
- [ ] §H-1 PostHog project + `posthog-node` in backend; identify by Supabase user id (soft-needs WT-AUTH)
- [ ] §H-2 dispatcher `command_run { command, ok, retries }` event (the high-signal one — do first)
- [ ] §H-3 activation funnel (`app_opened`/`ae_connected`/`first_prompt_sent`/`first_edit_succeeded`)
- [ ] §H-4 conversion funnel (`trial_started`/`paywall_hit`/`subscribed`/`canceled`) — slots in as §C/§D land
- [ ] §H-5 privacy line (no prompt/project content sent) → feeds §G-2 Privacy Policy

---

## Wave 2 — make the proxy gate + meter (integration; same `proxy/` codebase as WT-1 → follows it)

**4. WT-PROXY-GATING** — §A remainder (needs WT-AUTH + WT-BILLING merged)
- [ ] §A-4 verify Supabase JWT on every request (needs WT-AUTH)
- [ ] §A-5 entitlement check — read `subscriptions`, cached ~30–60s (needs WT-BILLING)
- [ ] §A-6 usage metering — write usage + deduct allowance + reject over cap (needs WT-BILLING + locked numbers)
- [ ] §C-6 cap/trial enforcement at the proxy → emits the "out of allowance / trial ended" signal
- [ ] §A-7 per-user rate-limit + abuse guard
- [ ] §A-8 flip the Phase-4 §B env-switch → prod proxy URL (deploy fr, cloudflare)

---

## Wave 3 — consumer-facing flow (`app/` renderer)

**5. WT-PAYWALL-UX** — §D (needs WT-AUTH + WT-BILLING + WT-PROXY-GATING)
- [ ] §B-5 branded OAuth "you're signed in — close this tab" page (hosted HTTPS page fires the `cubic://` deep link + tells the user to close the tab; replaces the current hanging browser tab). Repoint `auth.ts` `redirectTo` + Supabase allow-list. Slotted here: consumer UX/copy + the Cloudflare Worker (Wave 2) can host it. Not a blocker.
- [ ] §D-1 first-run sequence: sign in → connect AE → try it → **paywall last**
- [ ] §D-2 paywall + limit states ("trial ended" / "out of allowance") → Checkout
- [ ] §D-3 "Manage subscription" → Customer Portal
- [ ] §D-4 non-technical copy throughout (consumer tone, no dev/terminal language)
- [ ] §D-5 finish the account/profile menu (ChatGPT-style) — name/avatar/Log out (§B-4 shell) + plan tag + Upgrade (§D-2) + Manage subscription (§D-3) in one dropdown
- [ ] account-widget polish (carried from WT-AUTH): (1) window-resize responsiveness — avatar/signed-in widget glitches on window grow/shrink → reflow cleanly, mirror ChatGPT/Claude desktop apps; (2) chat-page sidebar-collapse — avatar Y position shifts, must stay pinned at the same Y level

---

## Wave 4 — ship the binary (serial — build/release tooling)

**6. WT-PACKAGING** — §E (needs app feature-complete + Apple account)
- [ ] §E-1 obfuscate bundled Electron JS + `.jsx` (`javascript-obfuscator`)
- [ ] §E-2 harden Electron — asar + asar-integrity + fuses
- [ ] §E-3 code-sign + notarize (Apple Developer account)
- [ ] §E-4 DMG drag-to-Applications installer

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
- **Wave 4:** 6 → 7 strictly serial (7 needs 6's signing). Then launch gates.
- **If doing 2 parallel:** Wave 1 = 1 ∥ 2, then 3 in the freed lane (it soft-depends on 2 anyway); fit WT-WS-AUTH wherever.

## Contention notes
- WT-1 and WT-4 share the `proxy/` Worker codebase → sequential, not parallel.
- WT-2, WT-5, WT-6 all touch `app/` (auth UI / paywall / packaging) → different waves, so no collision.
- WT-WS-AUTH is local-transport only (`wsBridge.ts` + IPC + AE bridge) → parallel-safe with everything.
- WT-ANALYTICS is instrumentation-only (adds event calls in the backend loop/dispatcher) → parallel-safe; soft-needs WT-AUTH for the user id, §H-4 fills in as §C/§D land.
- WT-1 strips `rules.ts`/`definitions.ts` from the client; nothing else in Phase 5 edits those.
- **Local-first (§A-0):** every paid-backend WT (1–4, BILLING, AUTH) is built+tested against local emulators (`wrangler dev` / `supabase start` / Stripe test) — real cloud/Supabase compute is spent only at the WT-PROXY-GATING §A-8 flip and the §G-3 clean-machine E2E. direct-local `npm run dev` stays untouched throughout.
- Heavy parallelism is Wave 1 (3 separate services at once); Waves 2–4 narrow toward serial as integration + client/build work converge.
