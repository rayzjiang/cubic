-- `processed_webhook_events` — internal idempotency log (not a user fact). Stripe
-- can deliver the same event more than once; the webhook's FIRST action is to
-- insert event.id here. A unique-violation means we already processed it, so the
-- handler returns 200 without re-writing paid-state. Keeps webhook handling exactly-once.

create table public.processed_webhook_events (
  event_id    text primary key,
  received_at timestamptz not null default now()
);

comment on table public.processed_webhook_events is
  'Idempotency dedup for Stripe webhook delivery. Internal plumbing, service-role only.';
