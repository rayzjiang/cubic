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
grant insert, update, delete on public.processed_webhook_events to service_role;
grant select on public.processed_webhook_events to service_role;

-- The entitlement gate is callable by the user (own row) and the proxy.
grant execute on function public.get_entitlement(uuid) to anon, authenticated, service_role;
