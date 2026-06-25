-- `subscriptions` — paid-state, the WEBHOOK IS THE ONLY WRITER.
--
-- Identity model (LOCKED): customers merged in. One user = one subscription, so
-- the PK is user_id and stripe_customer_id lives inline. The row is UPSERTED in
-- place and NEVER DELETED — on cancel we set status='canceled' but keep the row,
-- so stripe_customer_id survives and a returning customer reuses their existing
-- Stripe customer. That never-delete invariant is what replaces a separate
-- `customers` table.

create type public.subscription_status as enum (
  'incomplete',          -- first payment not yet succeeded -> NOT entitled
  'incomplete_expired',  -- first payment abandoned        -> NOT entitled
  'trialing',            -- in trial (only if TRIAL enabled) -> entitled
  'active',              -- paid + current                 -> entitled
  'past_due',            -- renewal failed, dunning (~24h)  -> entitled (grace)
  'canceled',            -- ended                          -> NOT entitled
  'unpaid',              -- dunning exhausted              -> NOT entitled
  'paused'               -- paused                         -> NOT entitled
);

create table public.subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  stripe_subscription_id text not null,
  stripe_customer_id     text not null,                 -- inline; survives cancel (never-delete)
  status                 public.subscription_status not null,
  price_id               text not null references public.plans(price_id),
  plan                   text not null,                 -- denormalized label from plans
  current_period_start   timestamptz not null,          -- usage-reset anchor (Stripe clock)
  current_period_end     timestamptz not null,
  cancel_at_period_end   boolean not null default false,
  updated_at             timestamptz not null default now()
);

-- Looking up a subscription by its Stripe ids during webhook handling.
create unique index subscriptions_stripe_sub_idx on public.subscriptions (stripe_subscription_id);
create index subscriptions_customer_idx on public.subscriptions (stripe_customer_id);

comment on table public.subscriptions is
  'Paid-state, webhook-only-writer. PK=user_id, upsert-in-place, NEVER deleted '
  '(cancel => status=canceled, row kept so stripe_customer_id persists).';
