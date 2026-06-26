-- Table privileges for the API roles. RLS policies gate *rows*, but PostgREST
-- still needs table-level GRANTs to touch a table at all (even service_role, which
-- bypasses row policies, needs the GRANT). We don't rely on default privileges so
-- this is deterministic across environments.

-- Reads: plans is public config (anon may read for the paywall); a user's own
-- subscription/usage rows are further gated to "own row" by the RLS policies.
grant select on public.plans to anon, authenticated, service_role;
grant select on public.subscriptions to authenticated, service_role;
grant select on public.usage to authenticated, service_role;

-- Writes happen ONLY via service_role (Edge Functions + Wave-2 proxy) — the
-- security boundary. No write grants for anon/authenticated.
grant insert, update, delete on public.subscriptions to service_role;
grant insert, update, delete on public.usage to service_role;
grant insert, update, delete on public.plans to service_role;

-- Functions default to EXECUTE for PUBLIC, so REVOKE first, then grant explicitly —
-- otherwise "dropping anon" is meaningless (PUBLIC already covers anon).
-- get_entitlement: a user reads their OWN row; the proxy (service_role) reads any.
-- anon is intentionally NOT granted (a signed-out user has no entitlement) -> closes the IDOR.
revoke all on function public.get_entitlement(uuid) from public;
grant execute on function public.get_entitlement(uuid) to authenticated, service_role;

-- apply_subscription: the paid-state writer -> service_role ONLY.
revoke all on function public.apply_subscription(
  uuid, text, text, public.subscription_status, text, text,
  timestamptz, timestamptz, boolean, timestamptz
) from public;
grant execute on function public.apply_subscription(
  uuid, text, text, public.subscription_status, text, text,
  timestamptz, timestamptz, boolean, timestamptz
) to service_role;
