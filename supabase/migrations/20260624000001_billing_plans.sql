-- `plans` — the allowance SINGLE SOURCE OF TRUTH (price_id -> plan -> allowance).
-- ~2 rows, seeded below. Read by get_entitlement() and create-checkout. Editing
-- the allowance/price numbers happens HERE (and the Stripe dashboard) — there is
-- no second copy in TS, so nothing can drift.
--
-- allowance_cents is an internal cost-cents budget per billing cycle, denominated
-- the same way as server/ai/src/llm/anthropic.ts estimateCost() x 100. Users never
-- see this number raw — the paywall renders spent/allowance as a % bar.

create table public.plans (
  price_id        text primary key,              -- Stripe Price id (test now, live at §G-1)
  plan            text not null unique,           -- 'pro' | 'max' (stable internal label)
  allowance_cents numeric(14,4) not null,         -- cost-cents budget per cycle
  active          boolean not null default true,  -- false = hidden from new checkouts
  created_at      timestamptz not null default now()
);

comment on table public.plans is
  'Allowance source of truth: price_id -> plan -> allowance_cents. PLACEHOLDERS until §G-1.';

-- Seed the two launch tiers. Replace the price ids with real Stripe TEST price ids
-- once the products exist (see test harness), and the live ids + final allowances
-- at §G-1.
insert into public.plans (price_id, plan, allowance_cents, active) values
  ('price_pro_PLACEHOLDER', 'pro',  50000.0000, true),
  ('price_max_PLACEHOLDER', 'max', 150000.0000, true);
