-- Row Level Security. The security boundary: enable RLS everywhere, grant users
-- SELECT on their own rows only, and define NO write policy anywhere — so all
-- writes are impossible for anon/authenticated and happen exclusively through the
-- service-role key (which BYPASSES RLS) used by the Edge Functions + Wave-2 proxy.

alter table public.plans                    enable row level security;
alter table public.subscriptions            enable row level security;
alter table public.usage                    enable row level security;
alter table public.processed_webhook_events enable row level security;

-- plans: pricing is non-secret config; let anyone read the ACTIVE plans so the
-- paywall (Wave 3) can render tiers. No write policy -> service-role only writes.
create policy plans_select_active on public.plans
  for select using (active = true);

-- subscriptions / usage: a user may read only their own row (for the %-bar etc).
create policy subscriptions_select_own on public.subscriptions
  for select using (auth.uid() = user_id);

create policy usage_select_own on public.usage
  for select using (auth.uid() = user_id);

-- processed_webhook_events: no policy at all -> only the service role touches it.
