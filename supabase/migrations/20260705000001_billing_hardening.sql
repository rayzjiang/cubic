-- P5W2 billing-backend hardening (bugs #7, #8, #9). Forward migration — the DB is deployed, so the
-- fixes ship as a new migration (CREATE OR REPLACE the two functions + DROP the FK), not by editing
-- the already-applied 000002/000004 files. #10 (double-checkout) is table-free (Edge Function only) and
-- needs no schema change. See ~/.claude/plans/medium-real-should-partitioned-naur.md.

-- ── #8: drop the price_id -> plans FK ─────────────────────────────────────────────────────────────
-- The FK made an unknown Stripe price (rotated/retired price with live customers) FK-fail on EVERY
-- event for that sub — including cancellations — so the webhook 500-looped and Stripe eventually
-- disabled the endpoint, freezing ALL billing. Worse, it made get_entitlement's own "unknown price ->
-- allowance 0 -> blocked" fail-safe unreachable. Dropping it: an unknown price lands with plan='unknown',
-- get_entitlement's coalesce(0) blocks that one user (fail-safe now works), and cancellations/terminal
-- events ALWAYS succeed. Integrity is still guarded upstream (create-checkout only uses active plans)
-- and downstream (coalesce fail-closes + the webhook logs an unknown price loudly).
alter table public.subscriptions drop constraint if exists subscriptions_price_id_fkey;

-- ── #9: same-second out-of-order guard — protect terminal states at a tie ──────────────────────────
-- Stripe event.created is second-granularity, so two same-second events can share last_event_at and
-- arrive out of order. The old guard (excluded.last_event_at >= stored) let a STALE 'active' arriving
-- after a 'canceled' (same second) overwrite it -> a canceled customer regained free access. New guard:
-- apply a strictly-newer event as before, but at an EQUAL timestamp refuse to move OFF a terminal
-- status. A same-second cancel still lands on a non-terminal row (cancel wins ties); a real resubscribe
-- is always seconds later -> strictly newer -> still applies. A canceled sub can no longer be revived
-- by a non-strictly-newer event.
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
  where excluded.last_event_at > public.subscriptions.last_event_at
     or (excluded.last_event_at = public.subscriptions.last_event_at
         and public.subscriptions.status not in ('canceled', 'unpaid', 'incomplete_expired'));
$$;

comment on function public.apply_subscription is
  'Webhook-only guarded upsert of paid-state; applies strictly-newer Stripe events, and at an equal '
  'second-granularity timestamp refuses to overwrite a terminal status (canceled/unpaid/'
  'incomplete_expired) — a stale same-second event can never resurrect a canceled sub. service_role only.';

-- ── #7: entitlement TIME backstop + fail-fast past_due ─────────────────────────────────────────────
-- The old predicate was status in (active,trialing,past_due) AND spent < allowance — NO time check, so
-- a frozen row (webhooks stopped) stayed entitled forever, and past_due had unbounded grace. New model
-- (LOCKED 2026-07-05 — engineering-grace only, no billing grace):
--   * active   -> entitled while now() < current_period_end + 48h. The 48h is ENGINEERING grace: it only
--                 absorbs webhook-processing lag for an already-charged renewal (Stripe advances the
--                 period on a successful charge), not a payment giveaway. Bounds a total-webhook-outage
--                 exposure to ~2 days before a real payer is false-locked. Tunable constant below.
--   * trialing -> entitled only within current_period_end (unpaid trial: no buffer).
--   * past_due / incomplete / incomplete_expired / canceled / unpaid / paused -> NOT entitled. Fail-fast:
--                 a failed payment is cut immediately (Cubic is high per-call COGS). Flip past_due to a
--                 short grace later by adding a branch here — one line.
-- Also: return the REAL row status even when not entitled (was: all-nulls when the status wasn't in the
-- eligible set), so the proxy can route the right paywall message (past_due vs over-cap vs no-plan vs a
-- 0-allowance misconfig) instead of collapsing everything. Only a genuinely absent row is "no plan".
create or replace function public.get_entitlement(p_user_id uuid default auth.uid())
returns table (
  entitled        boolean,
  plan            text,
  price_id        text,
  allowance_cents numeric,
  spent_cents     numeric,
  period_start    timestamptz,
  period_end      timestamptz,
  status          public.subscription_status
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub     public.subscriptions%rowtype;
  v_allow   numeric;
  v_spent   numeric;
  v_entitled boolean;
begin
  if p_user_id is null then
    raise exception 'get_entitlement: user id required';
  end if;
  -- Only service_role (the Wave-2 proxy) may read ANOTHER user's entitlement; a real user JWT is
  -- confined to its own row, anon (null uid) is rejected. Closes the null-uid IDOR.
  if auth.role() <> 'service_role' and (auth.uid() is null or auth.uid() <> p_user_id) then
    raise exception 'get_entitlement: forbidden';
  end if;

  -- One user = one subscription row (PK user_id). Fetch it regardless of status so we can return the
  -- real status even when not entitled. A missing row (never subscribed) is the only true "no plan".
  select * into v_sub
  from public.subscriptions s
  where s.user_id = p_user_id;

  if not found then
    return query
      select false, null::text, null::text,
             0::numeric, 0::numeric,
             null::timestamptz, null::timestamptz, null::public.subscription_status;
    return;
  end if;

  -- Allowance from the plans table (the SSOT). A missing/unknown price -> 0 -> blocked. This fail-safe
  -- is now REACHABLE because the price_id FK was dropped above (previously the FK crashed first).
  select p.allowance_cents into v_allow
  from public.plans p
  where p.price_id = v_sub.price_id;
  v_allow := coalesce(v_allow, 0);

  -- Spend = SUM of usage within the CURRENT Stripe billing window (robust to a proxy timestamp slip;
  -- prior cycles fall outside [start, end) so they never count).
  select coalesce(sum(u.spent_cents), 0) into v_spent
  from public.usage u
  where u.user_id = p_user_id
    and u.period_start >= v_sub.current_period_start
    and u.period_start <  v_sub.current_period_end;

  -- Under the cap AND a live paid state within its time window (see header). '48 hours' = the tunable
  -- engineering-grace buffer for active renewals.
  v_entitled := (v_spent < v_allow) and (
    (v_sub.status = 'active'   and now() < v_sub.current_period_end + interval '48 hours')
    or
    (v_sub.status = 'trialing' and now() < v_sub.current_period_end)
  );

  return query
    select v_entitled,
           v_sub.plan,
           v_sub.price_id,
           v_allow,
           v_spent,
           v_sub.current_period_start,
           v_sub.current_period_end,
           v_sub.status;
end;
$$;

comment on function public.get_entitlement(uuid) is
  'Single entitlement gate read by the Wave-2 proxy. entitled = spent < allowance AND [ active within '
  'current_period_end + 48h (engineering grace) OR trialing within current_period_end ]; past_due and all '
  'other statuses are NOT entitled (fail-fast). Returns the real row status even when blocked so the proxy '
  'can route the paywall message. SECURITY DEFINER so the predicate cannot diverge.';
