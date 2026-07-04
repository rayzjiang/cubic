-- `record_usage` — the Wave-2 proxy's atomic meter increment (§A-6, WT-PROXY-GATING).
-- The proxy writes usage over PostgREST/HTTP, which can only express an upsert that
-- REPLACES the row — not one that ADDS to the running counter. So the atomic increment
-- documented as a comment in 20260624000003_billing_usage.sql lives here as a function
-- the proxy calls via `POST /rest/v1/rpc/record_usage`. SECURITY DEFINER + service_role-only,
-- mirroring apply_subscription (the other service-role-only writer).

create or replace function public.record_usage(
  p_user_id      uuid,
  p_period_start timestamptz,
  p_cents        numeric
)
returns numeric
language sql
security definer
set search_path = public
as $$
  -- One mutable counter row per (user, billing cycle); a new cycle's new period_start makes a fresh
  -- row (implicit reset — see the usage table comment). ADD to the existing spent_cents, never replace.
  insert into public.usage (user_id, period_start, spent_cents, updated_at)
  values (p_user_id, p_period_start, p_cents, now())
  on conflict (user_id, period_start)
  do update set spent_cents = public.usage.spent_cents + excluded.spent_cents,
                updated_at  = now()
  returning spent_cents;
$$;

-- Functions default to EXECUTE for PUBLIC, so REVOKE first, then grant explicitly (mirrors
-- 20260624000007_billing_grants.sql). Only the proxy (service_role) meters usage — never a user JWT.
revoke all on function public.record_usage(uuid, timestamptz, numeric) from public;
grant execute on function public.record_usage(uuid, timestamptz, numeric) to service_role;
