-- P5W2 audit (LOW) — defense-in-depth on the usage counter. Both guards are belt-and-suspenders:
-- only the proxy (service_role) writes usage, and it derives p_cents from real Anthropic token counts
-- (always >= 0). But a bug or a bad manual write should never be able to drive a negative balance.
--   1. A table CHECK so the stored counter can never go negative (catches ALL writers).
--   2. A p_cents >= 0 guard inside record_usage (rejects a negative delta before it's applied) — needs
--      plpgsql, so the function is re-expressed from `language sql` to `language plpgsql` with the same
--      atomic upsert-add semantics. CREATE OR REPLACE preserves the existing ACL; grants re-asserted for
--      clarity (mirrors 20260703000001).

-- 1. Non-negative stored balance (idempotent — drop-if-exists mirrors the 20260705000001 hardening style).
alter table public.usage drop constraint if exists usage_spent_cents_nonneg;
alter table public.usage add constraint usage_spent_cents_nonneg check (spent_cents >= 0);

-- 2. Reject a negative increment at the RPC boundary. Faithful re-expression of the 20260703000001
-- upsert-ADD (never replace), now in plpgsql so it can RAISE before applying.
create or replace function public.record_usage(
  p_user_id      uuid,
  p_period_start timestamptz,
  p_cents        numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spent numeric;
begin
  if p_cents < 0 then
    raise exception 'record_usage: p_cents must be >= 0 (got %)', p_cents;
  end if;
  -- One mutable counter row per (user, billing cycle); a new cycle's new period_start makes a fresh
  -- row (implicit reset). ADD to the existing spent_cents, never replace.
  insert into public.usage (user_id, period_start, spent_cents, updated_at)
  values (p_user_id, p_period_start, p_cents, now())
  on conflict (user_id, period_start)
  do update set spent_cents = public.usage.spent_cents + excluded.spent_cents,
                updated_at  = now()
  returning spent_cents into v_spent;
  return v_spent;
end;
$$;

-- Only the proxy (service_role) meters usage — never a user JWT (mirrors 20260703000001).
revoke all on function public.record_usage(uuid, timestamptz, numeric) from public;
grant execute on function public.record_usage(uuid, timestamptz, numeric) to service_role;
