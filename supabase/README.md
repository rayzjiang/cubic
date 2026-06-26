# Cubic billing backend (WT-BILLING)

Stripe + Supabase entitlement backend. **Backend only** — no renderer UI (Wave 3)
and no `cubic://` deep-link handler (WT-AUTH owns it; we only set return URLs).

## What's here

```
supabase/
├── config.toml                 # local emulator config (this worktree owns supabase/)
├── seed.sql                    # one namespaced billing test user (test-only)
├── .env.example                # Stripe + Supabase secrets template -> copy to .env
├── migrations/                 # plans -> subscriptions(+apply_subscription) -> usage -> get_entitlement -> RLS -> grants
└── functions/
    ├── _shared/                # auth (JWT->user), admin client, stripe, config, cors
    ├── create-checkout/        # plan -> Stripe Checkout URL
    ├── create-portal/          # -> Stripe Customer Portal URL
    └── stripe-webhook/         # ONLY writer of paid-state
```

## Model (locked)

- **Entitlement gate = "can make an LLM call,"** not app access. The Wave-2 proxy
  calls `get_entitlement(user_id)` and serves the LLM only when `entitled`.
- **Allowance = internal cost-cents** per Stripe billing cycle; the `plans` table is
  the single source of truth for `price_id -> plan -> allowance_cents`.
- **Two tiers Pro + Max**; upgrade/downgrade via the Stripe Customer Portal.
- **Trial built but OFF** (no free tier). Flip `TRIAL.enabled` in `functions/_shared/config.ts`.
- **`past_due` = ~24h grace** (Stripe dunning), then blocked.
- Numbers in `plans` + price ids are **PLACEHOLDERS — lock at §G-1**.

## Prerequisites (not installed in this repo)

```bash
brew install supabase/tap/supabase stripe/stripe-cli/stripe   # or see their docs
deno --version   # already present
```

A Stripe **test-mode** account; log in once: `stripe login`.

## Local test loop (Stripe TEST MODE — zero real charges, zero Anthropic spend)

Run the guided harness:

```bash
./supabase/test-harness.sh
```

Or step through it manually — see the script; the key steps are:

1. `supabase start && supabase db reset` — applies migrations + seed (plans + test user).
2. Create test products/prices in Stripe, then update the two `price_id`s in
   `migrations/20260624000001_billing_plans.sql` (or `update public.plans …`) and re-reset.
3. `cp supabase/.env.example supabase/.env` and fill ONLY the Stripe keys
   (`sk_test_…`, plus the `whsec_…` from step 5). Do NOT set `SUPABASE_URL`/keys for
   local — `supabase functions serve` auto-injects them (see `.env.example`).
4. `supabase functions serve --env-file supabase/.env` (terminal A).
5. `stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook` (terminal B);
   paste the printed `whsec_…` into `.env`, restart step 4.
6. Mint a JWT for the seeded user (password grant) and drive Checkout / triggers.
7. Assert rows + `get_entitlement` (see the script's assertions).

## Stripe dashboard config (not code)

- **Customer Portal** must be enabled + configured with Pro + Max as switchable
  products (Settings → Billing → Customer portal), or `create-portal` fails.
- **Dunning emails** + the failed-renewal retry schedule (pairs with the `past_due`
  grace) → tracked in `TODOS/POSTMVP.md`. No code.

## What this does NOT include (downstream waves)

- Paywall / account UI, `%`-bar, Upgrade/Manage buttons — Wave-3 WT-PAYWALL-UX.
- JWT *enforcement* + usage *metering writes* + rate-limit — Wave-2 WT-PROXY-GATING
  (consumes `get_entitlement` + the `usage` atomic increment).
- Per-charge append-only ledger — added when real money flows.
- Locking real price/allowance/trial numbers — launch gate §G-1.

## Verified vs. not (in this worktree)

Locally verified: Checkout creation, real test-mode payment, webhook signature
verify + subscription sync, and `get_entitlement` across all states (active /
over-cap / past_due / canceled). NOT yet exercised end-to-end — **covered by
launch gate §G-3** (`pay → use → cancel via Portal → access revoked` on a clean
machine): the Customer Portal flow, cancel/past_due via real Stripe webhooks, and
the prod deploy (cloud Supabase + real webhook endpoint + in-app deep link).
