# Phase 5 — Worktree execution plan (grouping · order · parallelization)

> Detailed checklist → `TODO-phase5.md`. This is the build order: which TODO items group into each worktree, what each depends on, and what can run in parallel. Numbers = worktrees / Claude sessions. Assumes Phase 4 is done.

**Why Phase 5 parallelizes better than Phase 4:** the big chunks are *separate codebases/services* — the Cloudflare Worker (proxy), Supabase (auth+DB), Stripe (billing), the local WS layer, and build/release tooling — not one shared `app/` dir. The contention is only where client integration touches `app/` (auth UI, paywall UX, packaging) and where the proxy's gating steps depend on auth+billing existing.

**Critical path:** `(②proxy-core ∥ ③auth ∥ ④billing) → ⑤proxy-gating → ⑥paywall-UX → ⑦packaging → ⑧auto-update → ⑨launch gates`. ①WS-auth floats free of all of it.

---

## Front-load NOW (not worktrees — long lead times that block later waves)
- **Apple Developer account ($99/yr)** — verification can take days. Blocks ③ (Apple OAuth) **and** ⑦ (sign/notarize). Buy first.
- **Lock price + allowance/cap numbers** (§C last item + §G) — a *decision*, not code. ④ billing config and ⑤ usage-metering both need real numbers. Decide before Wave 1 finishes.
- **Draft ToS + Privacy Policy** (§G) — legal lead time; required to charge money. Start in the background.

---

## Wave 1 — the paid-backend foundation (up to 3 parallel; separate services → near-zero file overlap)

1. **WT-PROXY-CORE — §A core** — stand up the Cloudflare Worker as a bare passthrough that holds the key + secret prompt + tool defs. Items: move crown jewels server-side (relocate `server/ai/src/prompt/rules.ts` `STATIC_RULES`/`{{COMMAND_CATALOG}}` + `server/ai/src/tools/definitions.ts` descriptions/`input_schema` into the Worker); Worker = Anthropic-shaped streaming passthrough (`ANTHROPIC_API_KEY` as Worker secret); repoint client (`server/ai/src/llm/anthropic.ts:150` `new Anthropic({apiKey})` → proxy `baseURL`, drop on-device key); keep the `cache_control` breakpoint (line 110). **Testable with just the API key — no auth/billing yet.** New `proxy/` codebase + edits to `anthropic.ts` + strip prompt/tool-defs from client.

2. **WT-AUTH — §B** — Supabase Auth project + Google/Apple OAuth (system browser → `cubic://` deep link), secure on-device session via Electron `safeStorage` + auto-refresh, sign-in/out UI + signed-out state + session recovery on launch. New Supabase config + `app/` auth components. **Stand up the Supabase project here first** (④ rides on it). Needs the Apple account (front-loaded).

3. **WT-BILLING — §C** — `subscriptions` table in Supabase (sole writer = Stripe webhooks) + Stripe Checkout/Customer Portal (browser → `cubic://` back) + webhooks→Supabase sync + card-up-front 7-day trial + small trial cap + abuse defenses (one-trial-per-card, Radar). Stripe config + webhook handler + table. **Soft-depends on ③** (shares the Supabase project; do the project setup in ③ first, then these parallelize). Needs locked price numbers (front-loaded).

> **Independent, slot into any free lane:** **①WS-auth (§???)** — per-launch session token: backend mints a secret at startup, passes it via the `getBackendPort()` IPC; `wsBridge.ts` rejects sockets whose `hello` frame lacks it (the `hello` frame + `127.0.0.1` bind already exist — this is smaller than written). Touches `wsBridge.ts` + IPC + AE bridge only → collides with nothing. A ship-blocker, so do it whenever a slot opens (alongside Wave 1 if you go 4-wide, else during Wave 2).

## Wave 2 — make the proxy actually gate + meter (integration)

4. **WT-PROXY-GATING — §A remainder** — verify Supabase JWT (needs ③); entitlement check reading `subscriptions` cached ~30–60s (needs ④); usage metering → write to Supabase + deduct allowance + reject over cap (needs ④ + locked numbers); per-user rate-limit; flip the Phase-4 §B env-switch to the prod proxy URL. **Same Worker codebase as ②** → runs *after* ② (sequential in `proxy/`), and needs ③ + ④ merged. Mostly a solo integration worktree; ①WS-auth can run parallel to it.

## Wave 3 — consumer-facing flow

5. **WT-PAYWALL-UX — §D** — first-run sequence (sign in → connect AE → try it → **paywall last**); paywall/limit states ("trial ended" / "out of allowance" → Checkout); "Manage subscription" → Customer Portal; non-technical copy throughout. `app/` renderer. Needs ③ (auth UI) + ④ (Checkout) + ⑤ (cap-enforcement signal).

## Wave 4 — ship the binary (serial — build/release tooling)

6. **WT-PACKAGING — §E** — obfuscate bundled Electron JS + `.jsx` (`javascript-obfuscator`); harden Electron (asar + asar-integrity + fuses); code-sign + notarize (Apple account); DMG drag-to-Applications installer. Needs the app feature-complete (after ⑥) + Apple account.
7. **WT-AUTO-UPDATE — §F** — electron-updater + Cloudflare R2 feed (release script uploads signed artifacts + `latest.yml`); signed updates (reuse ⑦'s identity); background-download → "restart to update" UX; AE panel untouched on update; *(optional)* staged rollout/beta channel. **Needs ⑦'s signing identity** → strictly after packaging.

## Final — not a worktree
8. **§G launch gates** — price+cap locked · ToS+Privacy published · full paid flow tested E2E on a clean machine (install → sign in → trial → hit cap → pay → use → cancel → access revoked) · refund + support SOP. Sequential checklist gating ship.

---

## Order / dependencies
- **Wave 1:** **② ∥ ③ ∥ ④** (set up the Supabase project in ③ before ④ leans on it). **①WS-auth** floats — drop it into any open lane.
- **Wave 2:** **⑤** integrates ②+③+④ (needs all three merged); same `proxy/` codebase as ② so it follows ②. ① can run parallel here.
- **Wave 3:** **⑥** needs ③+④+⑤.
- **Wave 4:** **⑦ → ⑧** strictly serial (⑧ needs ⑦'s signing).
- **Then ⑨** launch gates.
- **If doing 2 parallel:** Wave 1 = ② ∥ ③, then ④ in the freed lane (it soft-depends on ③ anyway); fit ① wherever.

## Contention notes
- ② and ⑤ share the `proxy/` Worker codebase → sequential, not parallel.
- ③, ⑥, ⑦ all touch `app/` (auth UI / paywall UX / packaging) → kept in different waves, so no collision.
- ① is local-transport only (`wsBridge.ts` + IPC + AE bridge) → parallel-safe with everything.
- ② strips `rules.ts`/`definitions.ts` out of the client; nothing else in Phase 5 edits those, so no conflict.
- **Heavy parallelism is Wave 1** (3 separate services at once); Waves 2–4 narrow toward serial as integration and client/build work converge.
