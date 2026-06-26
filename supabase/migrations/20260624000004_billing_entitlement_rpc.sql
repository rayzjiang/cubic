-- get_entitlement() — THE single source of truth for "can this user make an LLM
-- call." The Wave-2 proxy calls this once per request and reads `entitled`. It is
-- a SECURITY DEFINER function (not a view) deliberately: the proxy cannot
-- re-implement a divergent predicate, and the status-set + cap check live in ONE
-- place that joins plans (allowance) and usage (spend) atomically.
--
-- Predicate (LOCKED): status in (active, trialing, past_due)  AND  spent < allowance.
--   - incomplete / incomplete_expired / canceled / unpaid / paused -> not entitled
--   - past_due is entitled because Stripe dunning is configured fail-fast (~24h)
--     then flips to canceled/unpaid (which blocks). The allowance cap bounds the
--     grace exposure regardless.
--   - unknown/missing price -> allowance 0 -> 0 < 0 is false -> blocked (fail-safe).

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
  v_sub   public.subscriptions%rowtype;
  v_allow numeric;
  v_spent numeric;
begin
  if p_user_id is null then
    raise exception 'get_entitlement: user id required';
  end if;
  -- Only service_role (the Wave-2 proxy) may read ANOTHER user's entitlement. Every
  -- real user JWT carries a sub, so auth.uid() is non-null and they are confined to
  -- their own row; anon (null uid, role 'anon') is rejected. This closes the IDOR
  -- where a null auth.uid() was wrongly treated as trusted.
  if auth.role() <> 'service_role' and (auth.uid() is null or auth.uid() <> p_user_id) then
    raise exception 'get_entitlement: forbidden';
  end if;

  -- One user = one subscription row (PK user_id). Only consider entitled-eligible
  -- statuses; a canceled/incomplete row yields the not-entitled fall-through.
  select * into v_sub
  from public.subscriptions s
  where s.user_id = p_user_id
    and s.status in ('active', 'trialing', 'past_due');

  if not found then
    return query
      select false, null::text, null::text,
             0::numeric, 0::numeric,
             null::timestamptz, null::timestamptz, null::public.subscription_status;
    return;
  end if;

  -- Allowance from the plans table (the SSOT). Missing plan -> 0 -> blocked.
  select p.allowance_cents into v_allow
  from public.plans p
  where p.price_id = v_sub.price_id;
  v_allow := coalesce(v_allow, 0);

  -- Spend = SUM of all usage within the CURRENT Stripe billing window. Summing the
  -- window (not an exact period_start match) is robust to a proxy timestamp slip and
  -- is ledger-ready (one counter row today, or many ledger rows later); prior cycles
  -- fall outside [start, end) so they never count.
  select coalesce(sum(u.spent_cents), 0) into v_spent
  from public.usage u
  where u.user_id = p_user_id
    and u.period_start >= v_sub.current_period_start
    and u.period_start <  v_sub.current_period_end;

  return query
    select (v_spent < v_allow),          -- hard cap: over allowance => not entitled
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
  'Single entitlement gate read by the Wave-2 proxy: status in (active,trialing,past_due) '
  'AND spent_cents < plans.allowance_cents. SECURITY DEFINER so the predicate cannot diverge.';
