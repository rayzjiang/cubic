# Cubic — Database Schema (Data Model Design)

> **Date:** 2026-06-26 (refreshed after the WT-BILLING fix pass)
> **Status:** Implementing **Wave 1 of Phase 5** (paid-backend infra). This documents the billing/auth data model that WT-BILLING creates and WT-PROXY-GATING (Wave 2) reads.
>
> **Source of truth:** the SQL migrations under `supabase/migrations/` are authoritative for the actual DDL (column types, constraints, indexes). This file is the human-readable design/diagram view — if it ever disagrees with the migrations, the migrations win.

---

## Stack

Supabase (Postgres + Auth). Stripe is the source of truth for *money*; Postgres holds a fast local mirror of paid-state. The proxy (Cloudflare Worker, Wave 2) reads entitlement from here on every request.

---

## Overview

Four tables total: **3 we create** (`plans`, `subscriptions`, `usage`) + **1 we get free** (`auth.users`, built into Supabase Auth). _(The migration **files** also define two functions — `apply_subscription()` the guarded webhook writer, and `get_entitlement()` the single read the proxy calls — plus RLS/grants; those are not tables.)_

Design principle: **one writer per table.** No two pieces of code write the same table, and no fact is stored twice.

| Table | Answers | Writer | Read by |
|---|---|---|---|
| `auth.users` *(built-in)* | "Who is this person?" | Supabase Auth (automatic) | everything |
| `plans` | "What does each price give you?" | migration seed (read-only reference) | checkout fn, entitlement RPC |
| `subscriptions` | "Is this user paying right now?" | **Stripe webhooks only** | entitlement RPC, checkout fn |
| `usage` | "How much have they spent this cycle?" | the proxy/Worker | entitlement RPC |

---

## Diagram

```
                      auth.users  (identity — Supabase Auth)
                          │ id (uuid)
          ┌───────────────┼───────────────┐
          │ user_id       │ user_id       │ user_id
          ▼               ▼               │
   subscriptions        usage             │
   (paid-state)         (metering)        │
      │ price_id                          │
      ▼                                   │
    plans  ◄──────────────────────────────┘
   (price_id → allowance_cents)
   read by checkout fn + entitlement RPC
```

Relationships:
- `subscriptions.user_id` → `auth.users.id` (one row per user)
- `usage.user_id` → `auth.users.id` (one row per user per billing cycle)
- `subscriptions.price_id` → `plans.price_id` (which tier they're on → how much allowance)

---

## Tables

### `auth.users` *(built-in — do not create or write)*

Supabase Auth manages this automatically when a user signs in via Google/Apple OAuth (WT-AUTH). We only ever **read** it.

| Field | Meaning |
|---|---|
| `id` (uuid) | The user's permanent ID. This is the foreign key every other table points at. |
| `email` | From the OAuth provider. |
| `raw_user_meta_data` | JSON holding `name`, `avatar_url`, etc. from the provider. |

Everything else (entitlement, payment, usage) hangs off `auth.users.id`.

---

### `plans` — price → allowance reference

Read-only reference data. Maps each Stripe `price_id` to the plan name and the monthly usage allowance. **Single source of truth** for the allowance numbers so they are never mirrored in both TypeScript and SQL.

Two rows at launch (Pro, Max). Seeded by migration; never written at runtime.

| Column | Type | Represents |
|---|---|---|
| `price_id` | text (PK) | The Stripe Price ID (e.g. `price_123...`). Primary key. |
| `plan` | text | Human label: `'pro'` \| `'max'`. |
| `allowance_cents` | numeric(14,4) | Monthly usage allowance in cost-cents (the cycle's spend cap; sub-cent precision so tiny calls don't floor to 0). |
| `active` | boolean | Whether this price is currently offered (lets us retire/replace a price without deleting history). |

> Numbers are placeholders until locked at launch gate **§G-1**. Changing them = a one-line seed migration, no app code change.

---

### `subscriptions` — entitlement source of truth

The single answer to "is this user allowed to use the app right now?" **Written only by Stripe webhooks**, and only through the `apply_subscription()` function (never a raw write) — so it can never drift from Stripe's reality. Read by the proxy's entitlement check (cached ~30–60s, Wave 2 §A-5).

One row per user. The row is **upserted, never deleted** — on cancel we set `status = 'canceled'` but keep the row so the `stripe_customer_id` is never lost (prevents duplicate Stripe customers on resubscribe). `status` is a Postgres enum (`subscription_status`).

| Column | Type | Represents |
|---|---|---|
| `user_id` | uuid (PK, FK → auth.users, ON DELETE CASCADE) | Which user this subscription belongs to. One row per user. |
| `stripe_subscription_id` | text | The current Stripe subscription object ID. |
| `stripe_customer_id` | text | The user's stable Stripe customer ID. Created once at first checkout, reused forever (incl. resubscribe). |
| `status` | enum `subscription_status` | Stripe's status: `active`, `trialing`, `past_due`, `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`. **Drives the entitlement decision.** |
| `price_id` | text (FK → plans) | Which tier → joins `plans` for the allowance. |
| `plan` | text | Denormalized label (`'pro'`/`'max'`) copied from `plans`. |
| `current_period_start` | timestamptz | Start of the current billing cycle (the `usage` reset anchor). |
| `current_period_end` | timestamptz | End of the current billing cycle. |
| `cancel_at_period_end` | boolean | Whether the sub is scheduled to end at period end. |
| `last_event_at` | timestamptz | Stripe `event.created` of the last applied event — older events are ignored (out-of-order protection). |
| `updated_at` | timestamptz | Last write. |

> **The trial** lives in Stripe (`trial_period_days`) and surfaces here as `status = 'trialing'` — we don't store a separate `trial_end`. It is **built but OFF by default**; flip `TRIAL.enabled` in `functions/_shared/config.ts` to enable (§C-4).
> **Out-of-order safety:** `apply_subscription()` is the sole webhook write path — a guarded upsert that applies an event only if its `event.created` ≥ the stored `last_event_at`, so a stale "active" can't resurrect a "canceled" row.

**Entitlement rule (the product decision):** a user is entitled when
`status IN ('active', 'trialing', 'past_due')`.
`past_due` is included as a **grace window** — a failed renewal charge is usually a transient card issue (expired/reissued card, bank hold), and Stripe retries for a few days before flipping to `canceled`. The allowance cap still bounds spend during grace, so margin exposure is small and bounded. Everything else (`canceled`, `unpaid`, …) = blocked.

---

### `usage` — running spend meter

Tracks how much the user has spent in the current billing cycle, so the proxy can enforce the allowance cap. **Written by the proxy** (not webhooks) after each request — which is exactly why it must be its own table, separate from the webhook-only `subscriptions`.

One row per user per billing cycle. Reset = a new row each cycle (old rows are free history). Increment is atomic to avoid races under concurrent requests.

| Column | Type | Represents |
|---|---|---|
| `user_id` | uuid (FK → auth.users) | Which user. |
| `period_start` | timestamptz | Start of the billing cycle this counter covers. **Aligned to the Stripe billing anchor**, not the calendar month, so resets match what Stripe actually bills. Part of the key. |
| `spent_cents` | numeric(14,4) | Running total spent this cycle (cost-cents, sub-cent precision). Proxy does an atomic `spent_cents = spent_cents + cost` upsert per request. |
| `updated_at` | timestamptz | Last metering write. |

Key: `(user_id, period_start)`.

> **Future (not now):** an append-only per-request *ledger* (tokens/cost/model/timestamp) for billing forensics/disputes. Deferred until real money disputes are possible — the counter above is the hot-path source of truth; PostHog (§H) covers product analytics but is **not** a billing-grade financial record.

---

## The read path: `get_entitlement` RPC

The Wave-2 proxy makes **one** call per request and gets back everything it needs. In plain terms, the RPC:

1. **Access check** — only `service_role` (the proxy) may read another user's row; a logged-in user may read only their own (`auth.uid()`); signed-out/anon is rejected.
2. Looks up the user's `subscriptions` row → reads `status` and `price_id`.
3. Checks `status IN ('active', 'trialing', 'past_due')` → if not, returns **blocked**.
4. Joins `plans` on `price_id` → reads `allowance_cents`.
5. **Sums** the user's `usage` across the current billing window `[current_period_start, current_period_end)` → `spent_cents`.
6. Returns `{ entitled, plan, price_id, allowance_cents, spent_cents, period_start, period_end, status }` — where `entitled` = status-ok **AND** `spent_cents < allowance_cents` (over-cap blocks even with a good status).

Because the allowance comes back inside the RPC result, the proxy never needs its own copy of the price→allowance map — the `plans` table is the only place that number lives. It is a `SECURITY DEFINER` function so the predicate can't be re-implemented (and diverge) elsewhere.

---

## Writer ownership (the invariant that keeps this clean)

| Table | Only writer |
|---|---|
| `auth.users` | Supabase Auth |
| `plans` | migration seed (reference data) |
| `subscriptions` | Stripe webhooks (only via `apply_subscription()`) |
| `usage` | the proxy/Worker |

Keeping these disjoint is what guarantees the local DB never disagrees with Stripe and that no two services race on the same row.
