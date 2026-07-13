-- P5W3 P2 (account deletion) — expose cancel_at_period_end from get_entitlement.
--
-- The account-delete gate (Settings→Account) must distinguish "active + will-renew" (block delete,
-- make the user cancel first) from "active + cancelling" (cancel_at_period_end=true → unlock delete
-- the same day, before the period lapses). get_entitlement returned status but NOT this flag, so the
-- client couldn't tell the two apart. Add it as an output column.
--
-- CREATE OR REPLACE cannot change a function's OUT columns / return type → DROP then CREATE. Body is
-- otherwise IDENTICAL to 20260705000001 (the #7 hardening version); the ONLY change is the added
-- cancel_at_period_end output (sourced from the row). Re-grant after recreate (grants drop with the fn).

drop function if exists public.get_entitlement(uuid);

create function public.get_entitlement(p_user_id uuid default auth.uid())
returns table (
  entitled             boolean,
  plan                 text,
  price_id             text,
  allowance_cents      numeric,
  spent_cents          numeric,
  period_start         timestamptz,
  period_end           timestamptz,
  status               public.subscription_status,
  cancel_at_period_end boolean
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
             null::timestamptz, null::timestamptz, null::public.subscription_status,
             false;
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
           v_sub.status,
           v_sub.cancel_at_period_end;
end;
$$;

comment on function public.get_entitlement(uuid) is
  'Single entitlement gate read by the Wave-2 proxy. entitled = spent < allowance AND [ active within '
  'current_period_end + 48h (engineering grace) OR trialing within current_period_end ]; past_due and all '
  'other statuses are NOT entitled (fail-fast). Returns the real row status + cancel_at_period_end even when '
  'blocked so the proxy can route the paywall and the client can gate account-deletion. SECURITY DEFINER.';

-- Functions default to EXECUTE for PUBLIC, so REVOKE first, then grant explicitly (grants dropped with
-- the function above). Mirrors 20260624000007: a user reads their OWN row; the proxy (service_role) any.
revoke all on function public.get_entitlement(uuid) from public;
grant execute on function public.get_entitlement(uuid) to authenticated, service_role;
