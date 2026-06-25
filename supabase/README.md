# Cubic billing backend (WT-BILLING)

Stripe + Supabase entitlement backend. **Backend only** — no renderer UI (Wave 3)
and no `cubic://` deep-link handler (WT-AUTH owns it; we only set return URLs).

## What's here

```
supabase/
├── config.toml                 # local emulator config (this worktree owns supabase/)
├── seed.sql                    # one namespaced billing test user (test-only)
├── .env.example                # Stripe + Supabase secrets template -> copy to .env
├── migrations/                 # plans -> subscriptions -> usage -> RPC -> idempotency -> RLS
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
3. `cp supabase/.env.example supabase/.env` and fill the local keys printed by
   `supabase start` (URL, anon, service_role) + your `sk_test_…`.
4. `supabase functions serve --env-file supabase/.env` (terminal A).
5. `stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook` (terminal B);
   paste the printed `whsec_…` into `.env`, restart step 4.
6. Mint a JWT for the seeded user (password grant) and drive Checkout / triggers.
7. Assert rows + `get_entitlement` (see the script's assertions).

## What this does NOT include (downstream waves)

- Paywall / account UI, `%`-bar, Upgrade/Manage buttons — Wave-3 WT-PAYWALL-UX.
- JWT *enforcement* + usage *metering writes* + rate-limit — Wave-2 WT-PROXY-GATING
  (consumes `get_entitlement` + the `usage` atomic increment).
- Per-charge append-only ledger — added when real money flows.
- Locking real price/allowance/trial numbers — launch gate §G-1.
