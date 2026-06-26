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
  last_event_at          timestamptz not null default to_timestamp(0), -- newest Stripe event applied (out-of-order guard)
  updated_at             timestamptz not null default now()
);

-- Looking up a subscription by its Stripe ids during webhook handling.
create unique index subscriptions_stripe_sub_idx on public.subscriptions (stripe_subscription_id);
create index subscriptions_customer_idx on public.subscriptions (stripe_customer_id);

comment on table public.subscriptions is
  'Paid-state, webhook-only-writer. PK=user_id, upsert-in-place, NEVER deleted '
  '(cancel => status=canceled, row kept so stripe_customer_id persists).';

-- apply_subscription — the webhook's ONLY write path. A guarded atomic upsert that
-- ignores out-of-order Stripe events: if the incoming event's Stripe timestamp
-- (p_event_at) is OLDER than the last applied event, the ON CONFLICT ... WHERE is
-- false so the row is left untouched (no update, no error) — a stale 'active' can't
-- resurrect a 'canceled' row. First insert (no conflict) always lands. SECURITY
-- DEFINER so the service-role webhook writes through it (RLS has no write policy).
create or replace function public.apply_subscription(
  p_user_id                uuid,
  p_stripe_subscription_id text,
  p_stripe_customer_id     text,
  p_status                 public.subscription_status,
  p_price_id               text,
  p_plan                   text,
  p_current_period_start   timestamptz,
  p_current_period_end     timestamptz,
  p_cancel_at_period_end   boolean,
  p_event_at               timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.subscriptions (
    user_id, stripe_subscription_id, stripe_customer_id, status, price_id, plan,
    current_period_start, current_period_end, cancel_at_period_end, last_event_at, updated_at
  )
  values (
    p_user_id, p_stripe_subscription_id, p_stripe_customer_id, p_status, p_price_id, p_plan,
    p_current_period_start, p_current_period_end, p_cancel_at_period_end, p_event_at, now()
  )
  on conflict (user_id) do update set
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_customer_id     = excluded.stripe_customer_id,
    status                 = excluded.status,
    price_id               = excluded.price_id,
    plan                   = excluded.plan,
    current_period_start   = excluded.current_period_start,
    current_period_end     = excluded.current_period_end,
    cancel_at_period_end   = excluded.cancel_at_period_end,
    last_event_at          = excluded.last_event_at,
    updated_at             = now()
  where excluded.last_event_at >= public.subscriptions.last_event_at;
$$;

comment on function public.apply_subscription is
  'Webhook-only guarded upsert of paid-state; ignores Stripe events older than the '
  'last applied (out-of-order protection). EXECUTE granted to service_role only.';
