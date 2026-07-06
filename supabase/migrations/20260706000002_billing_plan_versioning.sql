-- Plan price/allowance VERSIONING — lets a tier hold multiple Stripe price rows
-- (old + new) at once so EXISTING customers migrate to a new price/allowance at
-- their OWN next billing cycle (staggered), while NEW customers check out at the
-- current one. Driven by scripts/change-plan.ts (Stripe Subscription Schedules).
--
-- Before: plans.plan had a UNIQUE constraint -> at most one row per tier, so a price
-- change had to overwrite in place. During the ~1-month staggered rollout, every
-- not-yet-renewed customer's subscriptions.price_id still points at the OLD id — with
-- one row per tier that old id would vanish from plans -> get_entitlement coalesces a
-- missing allowance to 0 -> the whole not-yet-migrated cohort is BLOCKED. Versioning
-- is required to keep both prices live during the drain, independent of grandfathering.
--
-- After: many rows per tier allowed; a PARTIAL unique index keeps exactly ONE active
-- row per tier (the price new checkouts get — create-checkout filters active=true).
-- get_entitlement resolves allowance by price_id and IGNORES `active`, so a retired
-- (active=false) row keeps feeding its own allowance to the customers still on it until
-- they migrate. The subscriptions.price_id -> plans FK was already dropped in
-- 20260705000001, so a mid-migration price never FK-breaks the webhook either.

alter table public.plans drop constraint plans_plan_key;
create unique index plans_one_active_per_plan on public.plans (plan) where active;

comment on index public.plans_one_active_per_plan is
  'Exactly one active price per tier feeds new checkouts; retired rows (active=false) '
  'stay live to serve their own allowance to customers not yet migrated off them.';

-- set_active_plan_version — the atomic price-version swap used by scripts/change-plan.
-- In ONE transaction: deactivate the tier's current active row, then upsert the new
-- price row as the sole active one. Ordered deactivate-then-activate so the partial
-- unique index above is never tripped and observers never see zero/two active rows
-- (the whole function is one transaction, so the intermediate state never commits).
-- Idempotent: re-running with the same new price id just re-asserts it active and
-- refreshes its allowance. Also serves add-plan (a brand-new tier has no prior active
-- row -> the UPDATE matches nothing -> the INSERT lands as the sole active row).
-- SECURITY DEFINER + service_role-only, matching apply_subscription / record_usage.
create or replace function public.set_active_plan_version(
  p_plan            text,
  p_price_id        text,
  p_allowance_cents numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_allowance_cents < 0 then
    raise exception 'allowance_cents must be >= 0 (got %)', p_allowance_cents;
  end if;

  update public.plans set active = false where plan = p_plan and active;

  insert into public.plans (price_id, plan, allowance_cents, active)
  values (p_price_id, p_plan, p_allowance_cents, true)
  on conflict (price_id) do update
    set allowance_cents = excluded.allowance_cents,
        plan            = excluded.plan,
        active          = true;
end;
$$;

comment on function public.set_active_plan_version is
  'Atomic plan-version swap (deactivate current active row, upsert the new one active). '
  'Used by scripts/change-plan.ts. EXECUTE granted to service_role only.';

revoke all on function public.set_active_plan_version(text, text, numeric) from public;
grant execute on function public.set_active_plan_version(text, text, numeric) to service_role;
