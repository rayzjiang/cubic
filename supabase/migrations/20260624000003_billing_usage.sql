-- `usage` — running cost-cents spent this cycle. PROXY-written (Wave-2 metering).
-- Separate from `subscriptions` because that table is webhook-only-writer; usage
-- is written by the proxy on every LLM call. One mutable counter row per
-- (user, period); reset is implicit — a new billing cycle has a new period_start,
-- hence a fresh row, and old rows are free history.

create table public.usage (
  user_id      uuid not null references auth.users(id) on delete cascade,
  period_start timestamptz not null,             -- == subscriptions.current_period_start
  spent_cents  numeric(14,4) not null default 0, -- micro-cent precision (sub-cent calls don't floor to 0)
  updated_at   timestamptz not null default now(),
  primary key (user_id, period_start)
);

comment on table public.usage is
  'Atomic cost-cents counter per (user_id, period_start). Proxy upserts: '
  'on conflict do update spent_cents = usage.spent_cents + excluded.spent_cents. '
  'A per-charge append-only ledger is a FUTURE add (when real money flows).';

-- The Wave-2 proxy's atomic meter increment runs as service role, e.g.:
--   insert into public.usage (user_id, period_start, spent_cents, updated_at)
--   values ($1, $2, $3, now())
--   on conflict (user_id, period_start)
--   do update set spent_cents = public.usage.spent_cents + excluded.spent_cents,
--                 updated_at  = now()
--   returning spent_cents;
