-- Seed the real sandbox (Stripe TEST-mode) price ids + allowances, replacing the
-- 20260624000001 placeholders. This reconciles `plans` to actual Stripe objects so the
-- webhook, create-checkout, and get_entitlement all resolve a real price (the placeholder
-- ids never existed in Stripe -> resource_missing / plan='unknown'). Uses the versioning
-- RPC (set_active_plan_version, from 20260706000002) so it rides in via `supabase db push`
-- and applies identically to local + cloud. Idempotent: the RPC upserts by price_id and the
-- delete is a no-op once the placeholders are gone.
--
-- Economics (user-locked; still PLACEHOLDER-until-§G-1 for the LIVE cutover):
--   pro -> $29/mo  price, allowance 1500 cost-cents ($15 usage cap)
--   max -> $89/mo  price, allowance 5000 cost-cents ($50 usage cap)
-- allowance_cents is the internal AI-cost budget (estimateCost() x 100), not the price.

select public.set_active_plan_version('pro', 'price_1TsOlvLVfKmA9khS877OB9r8', 1500);
select public.set_active_plan_version('max', 'price_1TsOm6LVfKmA9khS3IJ2I9io', 5000);

-- Drop the now-inactive placeholder rows so `plans` holds exactly the two real rows. The
-- subscriptions.price_id -> plans FK was dropped in 20260705000001, so no row references
-- these and the delete cannot FK-break.
delete from public.plans where price_id in ('price_pro_PLACEHOLDER', 'price_max_PLACEHOLDER');
