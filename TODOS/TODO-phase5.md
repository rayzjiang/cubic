# Phase 5 — Pre-ship gate (hosted proxy + auth + billing + packaging)

> **Scope:** Phase 5 is **the wall** Phase 4 kept pointing at. **Nothing ships to anyone — not one paying stranger — until every box here is checked.** This is what turns the Phase-4 app from "runs on my machine with my key in a `.env`" into "a stranger can pay, install, and use it without draining my API key or stealing my IP."
>
> **The one-line model:** the shipped app no longer holds the Anthropic key or the system prompt. A **hosted proxy** holds both, authenticates the caller (Supabase), checks they're paid (Stripe→Supabase), meters their usage, then forwards to Anthropic and streams back. The agent loop + tool dispatch + ExtendScript stay **local** (they drive AE) — only their *names* leak; the prompt + tool semantics + key live server-side.

> **Stack decided:** Cloudflare Workers (proxy) · Supabase (auth + DB) · Stripe (billing) · Cloudflare R2 (update feed). Rationale for each lives inline as `WHY:`.

---

## §A. Hosted LLM proxy — Cloudflare Workers (gates everything)
> Thin proxy: holds the key + injects the secret prompt/tool defs server-side; the loop stays client-side so each proxy call = **one** Claude response (stateless, short → serverless-friendly). **WHY Workers:** industry-standard for streaming LLM gateways, auto-scales, edge latency, cheapest; streaming wait doesn't count against CPU limit. **⚠️ escape hatch:** if Workers' V8-isolate runtime fights us, switching to an always-on Node box (Railway/Fly/Render) is a ~half-day job — the app only knows the proxy URL. Re-evaluate then.
- [ ] **§A-0** **Four test surfaces survive Phase 5 — local-first, don't burn cloud to test.** The Phase-4 §B `CUBIC_ENV` switch (`app/src/main/config.ts`) is the lever; §A-8 only flips the *shipped* default to `prod`. Keep all four working:
    - **MCP-only** — AE bridge standalone via Claude Code / integration tests. **No Anthropic token spend.** Unchanged by Phase 5 (the bridge never touches the proxy).
    - **direct-local** _(default `npm run dev`, today's flow — STAYS the default)_ — `CUBIC_ENV=local` → agent loop calls Anthropic directly with `ANTHROPIC_API_KEY` from `server/.env`. Fully on-device: no Worker, Supabase, or Stripe. §A-3 makes the client *fork* (proxy vs direct), it does **not** delete this branch.
    - **full-stack-local** — `CUBIC_ENV=prod` + `CUBIC_PROXY_URL=http://localhost:8787` → exercises the real proxy/auth/meter/billing path against **local emulators** (`wrangler dev` + `supabase start` + Stripe test mode). Tests the whole gate with **zero real cloud/Supabase compute** (test-mode tokens only). **Rule: develop every §A–§C component against its emulator here first**, before any deploy.
    - **prod** — `CUBIC_ENV=prod` + prod `CUBIC_PROXY_URL` → real deployed infra. Emulators don't cover OAuth redirects, webhook timing, Worker cold-starts, signing/Gatekeeper, real install → the §G-3 clean-machine E2E (ideally a second person's laptop) stays **mandatory**.
- [ ] **§A-1** **Move the crown jewels server-side** — relocate `server/ai/src/prompt/rules.ts` (`STATIC_RULES` + `{{COMMAND_CATALOG}}`) **and** all tool descriptions/`input_schema` into the Worker. These must **never** ship in the binary. Client keeps only tool **names** + dispatch + ExtendScript (unavoidably local — they run in AE).
- [ ] **§A-2** **Worker = Anthropic-shaped passthrough** — accept a messages request (no system, no tools), inject system prompt + full tool catalog + `ANTHROPIC_API_KEY` (Worker secret), forward to `api.anthropic.com`, **stream the response body straight back** (`new Response(upstream.body)`). Hand-rolled `fetch`, no Node SDK.
- [ ] **§A-3** **Repoint the client** — replace the direct `new Anthropic({apiKey})` call (`server/ai/src/llm/anthropic.ts`) with a call to the proxy: `baseURL` = proxy URL, auth = Supabase access token (custom header), **no API key on device**. Client still sends `messages` + volatile `<live_ae_state>`; receives `tool_use`, dispatches locally as today.
- [ ] **§A-4** **Verify Supabase JWT** (stateless, no round-trip) on every request → reject unauthenticated callers before spending anything.
- [ ] **§A-5** **Entitlement check** — read the user's row from Supabase `subscriptions`, **cached ~30–60s**. **WHY fresh:** every allowed request spends *my* money, so a canceled/abusive user must lose access in seconds, not after a 1-hr token. (→ §C)
- [ ] **§A-6** **Usage metering** — after each response, read Anthropic's token counts → write usage to Supabase + **deduct from the user's monthly allowance**; reject when over cap. (Read=gate, write=meter, both here.)
- [ ] **§A-7** **Per-user rate-limit + abuse guard** — cap requests/min per user to bound runaway/abuse spend on the single key.
- [ ] **§A-8** **Flip the Phase-4 §B env-switch** — point the shipped app at the prod proxy URL (was `localhost`).
- [ ] **§A-9** _(bonus)_ **Prompt-cache win** — all users share one key + identical system-prompt/tool prefix → high Anthropic prompt-cache hit rate. Keep the `cache_control` breakpoint on the static prefix when injecting.

## §B. Auth & identity — Supabase Auth
> Prerequisite of both the paywall (authenticate before spending the key) and billing (no subscription without an account). Audience = non-technical video editors → OAuth only, no passwords.
- [ ] **§B-1** **Google + Apple OAuth** — system-browser flow → redirect back via custom deep link (`cubic://`). No manual email/password at launch (add magic-link later only if users ask — Supabase config toggle, not a rebuild). **WHY OAuth-only:** ~100% coverage for this audience, zero password/reset flows, no credential liability.
- [ ] **§B-2** **Apple Developer account ($99/yr)** — needed for Sign in with Apple **and** code-signing/notarization (§E). One account, both jobs.
- [ ] **§B-3** **Secure on-device session** — store tokens via Electron `safeStorage` (OS keychain, encrypted at rest), **not** a plain file. Auto-refresh the access token; "stay signed in" across launches.
- [ ] **§B-4** **Sign-in / sign-out UI** + signed-out state. Recover session on launch → straight into the app. **Also ships the account-menu *shell/ui (like chatgpt's in the bottom right corner)*** (name + avatar + Log out); plan tag + Upgrade fill in at §D-5 once billing exists.

## §C. Billing & entitlement — Supabase + Stripe
> **Model: flat price + monthly usage allowance** (resets monthly; hard cap protects margin). v1 runs **Sonnet for everything**, Haiku for trivial calls (conversation titles, etc.). **WHY flat+allowance:** simplest to build *and* explain to non-technical users, predictable bill, cap stops runaway spend. **Future:** evolve into a model-weighted credit pool (Copilot-style per-model multipliers draining the allowance).
- [ ] **§C-1** **`subscriptions` table in Supabase** — source of truth for entitlement (read by §A). Written **only** by Stripe webhooks.
- [ ] **§C-2** **Stripe Checkout + Customer Portal (hosted)** — open in browser → `cubic://` deep-link back (same pattern as OAuth). **WHY hosted:** zero payment UI to build; Stripe owns PCI/cards/3DS/tax/receipts; Portal gives cancel + update-card + invoices for free. Light brand (logo/colors) in the Stripe dashboard.
- [ ] **§C-3** **Webhooks → Supabase sync** — subscription created/updated/canceled/past-due all flow Stripe → webhook → `subscriptions` table. This is the *only* writer of paid-state.
- [ ] **§C-4** **Card-up-front 7-day trial** — card collected at signup (Stripe `trial_period_days`), auto-converts to paid. **WHY safe:** proxy is the server-side gate (client can't fake a trial); card-up-front kills multi-account farming; **the usage cap applies during the trial too**, so worst-case per trial = one small capped allowance = a known CAC.
- [ ] **§C-5** **Trial cap kept very small** — just enough to test slightly; this is pure customer-acquisition cost, so size it to a few dollars max.
- [ ] **§C-6** **Cap enforcement** — allowance + trial cap enforced at the proxy (§A metering). "Out of allowance" / "trial ended" → friendly paywall (§D).
- [ ] **§C-7** **Abuse defenses** — one-trial-per-card, Stripe Radar on, per-user rate-limit (§A). Bounds single-key cost exposure.
- [ ] **§C-8** ⚠️ **Decide price + allowance/cap sizing before launch** — model unit economics: charge vs. avg Anthropic cost/user (Sonnet) → target margin. Was flagged "payment plan not worked out." Lock the numbers here. **Ballpark reference (Cursor-like):** charge ~$15–20/mo · avg Anthropic cost ~$3–8/user/mo (Sonnet-heavy) · target margin ~60–85%.

## §D. Onboarding & paywall UX
> First-run flow for a non-technical user. **Paywall comes LAST** — let them feel the product before asking for a card.
- [ ] **§D-1** **First-run sequence** — sign in (§B) → connect to After Effects (Phase 4 auto-provision) → try it (trial cap) → **paywall last**.
- [ ] **§D-2** **Paywall + limit states** — "trial ended" / "out of allowance this month" screens with a clear upgrade/renew CTA → Stripe Checkout.
- [ ] **§D-3** **"Manage subscription"** entry point → opens Stripe Customer Portal.
- [ ] **§D-4** **Non-technical copy throughout** — consumer-app tone (iMessage/ChatGPT feel), never dev/terminal language.
- [ ] **§D-5** **Finish the Account/profile menu (ChatGPT-style)** — persistent sidebar widget aggregating identity + billing in one dropdown: name + avatar + Log out (from §B-4 shell), plan tag ("Free"/"Pro") + **Upgrade** CTA (→ §D-2 Checkout), Manage subscription (→ §D-3 Portal). Only surface Settings/Profile rows once they actually do something (else they read as broken to a non-technical user).

## §E. Packaging, signing & hardening
> The proxy already hides the crown jewels, so client-side protection only guards the leftovers (tool names, loop, ExtendScript). Goal: raise the bar cheaply ("deters 95%") + make install seamless. **Skip binary compilation** — marginal gain now that secrets are server-side.
- [ ] **§E-1** **Obfuscate** the bundled Electron JS **and** the ExtendScript (`.jsx`) with `javascript-obfuscator` before packaging.
- [ ] **§E-2** **Harden Electron** — asar + **asar-integrity** + Electron fuses (block `--inspect`/`node` CLI, enable cookie encryption).
- [ ] **§E-3** **Code-sign + notarize** (Apple Developer account from §B). **WHY mandatory:** un-notarized = macOS Gatekeeper "unidentified developer" block → non-technical user assumes virus and quits. Notarized = double-click → it just opens.
- [ ] **§E-4** **DMG/installer** — clean drag-to-Applications install; no Terminal, no settings-digging.

## §???. IMPORTANT!! Local transport hardening — dynamic port + authenticate the WebSocket
> **Standalone** The backend's WS on `127.0.0.1:17923` currently has **no auth** — any local process (or a malicious localhost-reaching webpage) can connect and drive the user's After Effects. Close this before shipping to strangers; cheap now, painful to retrofit once users exist. **Also folds in the dynamic-port robustness fix (§???-4)** — same `getBackendPort()` / `wsBridge.ts` code path, so the whole section is one transport work-unit.
- [ ] **§???-1** **Per-launch session token** — backend mints a random secret at startup; main passes it to the renderer alongside the port (extend the `getBackendPort()` IPC), and the AE panel receives it at install/connect time.
- [ ] **§???-2** **Reject unauthenticated sockets** — `wsBridge.ts` requires the token in the `hello`/first frame; drop any connection that doesn't present it. Applies to all three client types (UI, brain loopback, AE panel).
- [ ] **§???-3** **(optional) bind explicitly to `127.0.0.1`** (never `0.0.0.0`) so the port is never reachable off-machine. (Pairs with §???-4 → `bind 127.0.0.1:0`.)
- [ ] **§???-4** **Dynamic backend port (robustness — do first)** — replace the fixed `17923` with an OS-assigned free port (`bind 127.0.0.1:0`) so a port conflict can't make startup fatal on a stranger's machine. Backend writes the chosen port; panel + `ai/bridge/client.ts` + renderer all discover it via the same `getBackendPort()` channel as §???-1 (the token rides the discovered port). The real fix behind Phase-4 §B's "port-in-use" state. Detail → `TODO-phase4.md` §F.

## §F. Auto-update — electron-updater + Cloudflare R2
> Now that the UI is Electron, push updates via `electron-updater` pulling from an R2 feed. **WHY R2:** the commercial-standard "object storage + CDN" pattern (what S3 is used for), in Cloudflare's S3-compatible flavor — free egress, private (no public binary exposure), consolidated with the proxy.
- [ ] **§F-1** **Update feed on Cloudflare R2** — release script uploads signed artifacts + `latest.yml`; electron-updater generic/S3 provider points at it.
- [ ] **§F-2** **Signed updates** — updates use the §E signing identity so they install without re-triggering Gatekeeper.
- [ ] **§F-3** **Update UX** — download in background → "restart to update" prompt. Consumer-friendly, non-blocking.
- [ ] **§F-4** make sure that auto updates are seamless (users only interact w the electron ui, dont touch the ae panel or reload that panel at all ideally)
- [ ] **§F-5** _(optional)_ **Staged rollout / beta channel** — `electron-builder` percentage rollout + `latest`/`beta` channels. Nice-to-have, not a launch blocker.

## §H. Product analytics — PostHog (know what to iterate on)
> **Scope: deliberately slim — MVP, not a BI warehouse.** This is the §3.4 "event hooks, vendor TBD" line finally promoted to a deliverable. Billing metering (§A-6) answers "how much did they spend"; this answers "what did they do and did it work." **WHY PostHog:** one SDK gives funnels + retention + dashboards out of the box, free tier, self-hostable (fits the §E obfuscation/privacy posture). **MVP rule:** wire the few high-signal events below and stop — add more only when a real question comes up.
- [ ] **§H-1** **PostHog project + SDK** — wire `posthog-node` into the backend (events fire server-side from the agent loop, not the renderer → no key in the binary, survives §E obfuscation). Identify by Supabase user id (§B) so analytics joins to billing.
- [ ] **§H-2** **Dispatcher event hook (highest signal, ~1 call)** — emit `command_run { command, ok, retries }` from the single command-dispatch chokepoint (the 92-verb path). Gives verb-usage ranking + per-verb failure rate + self-heal retry rate for free. This one event is most of the value.
- [ ] **§H-3** **Activation funnel (4 events only)** — `app_opened`, `ae_connected`, `first_prompt_sent`, `first_edit_succeeded`. Drop-off here is the single most important launch metric: where new users die before the "aha."
- [ ] **§H-4** **Conversion funnel** — `trial_started`, `paywall_hit`, `subscribed`, `canceled` (fire from the §C/§D flows). Watch trial→paid without a second tool.
- [ ] **§H-5** **Privacy line** — prompt text + AE project contents are NEVER sent (events carry verb names + outcomes + counts only). Note this in the §G-2 Privacy Policy; opt-out toggle only if a user asks — not a launch blocker.

## §G. Launch gates (last checks before shipping to a paying stranger)
- [ ] **§G-0** **Taste/quality bar met (HARD gate — no ship below bar)** — motion output passes the taste eval: avg ≥1.5 across the 7 trials, AND T4 (restraint) + T7 (composition coherence) both ≥1. Protocol + rubric → `TODO-taste-eval.md`. The diagnostic runs **before** committing Phase-5 effort (classifies judgment vs capability gaps); the full prompt-tuning pass closes the judgment gaps and must clear this bar before the first paid ship. This is the taste moat — it is NOT optional polish.
- [ ] **§G-1** **Price + cap numbers locked** (§C unit-economics decision made, not TBD).
- [ ] **§G-2** **ToS + Privacy Policy** published — required to charge money + collect accounts/usage.
- [ ] **§G-3** **Full paid flow tested E2E** — fresh OS → install → sign in → trial → hit cap → pay → use → cancel via Portal → access revoked. The whole loop, on a clean machine.
- [ ] **§G-4** **Refund + support process** — a real inbox/channel + a refund SOP (ties to §C's money-back comfort).

---

## Cross-references
- **Phase 4 §B** — env-switchable backend: built pointing at `localhost`; **flip to the prod proxy URL here** (§A).
- **Phase 4 §B** — `mcp`→`bridge` naming pass should be done **before** this; the proxy/install paths assume final names.
- Single API key + abuse exposure (long-flagged risk) is addressed by: server-side gate (§A) + cap-during-trial (§C) + per-user rate-limit (§A) + one-trial-per-card/Radar (§C).
