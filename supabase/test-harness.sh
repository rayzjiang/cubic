#!/usr/bin/env bash
# WT-BILLING local test harness. Two parts:
#   A) OFFLINE (no Stripe, no network, zero cost) — validates the schema + the
#      get_entitlement() predicate by writing rows directly with psql, exactly the
#      shape the webhook/proxy would write. This is the fast correctness check.
#   B) STRIPE TEST MODE — drives the real Checkout -> webhook -> subscriptions sync
#      through the local Edge Functions. Needs the supabase + stripe CLIs.
#
# Run from the worktree root: ./supabase/test-harness.sh [offline|stripe]
set -euo pipefail

DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
UID_TEST="00000000-0000-0000-0000-0000000b1111"
PRICE_PRO="price_pro_PLACEHOLDER"
MODE="${1:-offline}"

have() { command -v "$1" >/dev/null 2>&1; }
psql_do() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qtA -c "$1"; }
say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

# ──────────────────────────────────────────────────────────────────────────────
offline() {
  have supabase || { echo "supabase CLI not installed — see supabase/README.md"; exit 1; }
  have psql     || { echo "psql not found — install: brew install libpq && brew link --force libpq"; exit 1; }

  say "Resetting local DB (migrations + seed)"
  supabase db reset

  say "Seed plan present (allowance SSOT)?"
  psql_do "select plan || ' = ' || allowance_cents || ' cents' from public.plans order by plan;"

  say "Simulate the webhook: insert an ACTIVE Pro subscription for the test user"
  psql_do "insert into public.subscriptions
    (user_id, stripe_subscription_id, stripe_customer_id, status, price_id, plan,
     current_period_start, current_period_end, cancel_at_period_end)
    values ('$UID_TEST','sub_test','cus_test','active','$PRICE_PRO','pro',
            now(), now() + interval '30 days', false)
    on conflict (user_id) do update set status=excluded.status;"

  say "get_entitlement -> expect entitled=t, spent=0"
  psql_do "select entitled, plan, allowance_cents, spent_cents from public.get_entitlement('$UID_TEST');"

  say "Simulate the proxy meter: spend just UNDER the cap (49999) -> still entitled"
  psql_do "insert into public.usage (user_id, period_start, spent_cents)
    select '$UID_TEST', current_period_start, 49999 from public.subscriptions where user_id='$UID_TEST'
    on conflict (user_id, period_start) do update set spent_cents=excluded.spent_cents;"
  psql_do "select entitled, spent_cents from public.get_entitlement('$UID_TEST');"

  say "Spend OVER the cap (50001) -> expect entitled=f (hard cap)"
  psql_do "update public.usage set spent_cents=50001 where user_id='$UID_TEST';"
  psql_do "select entitled, spent_cents, allowance_cents from public.get_entitlement('$UID_TEST');"

  say "past_due (under cap) -> expect entitled=t (24h grace)"
  psql_do "update public.usage set spent_cents=0 where user_id='$UID_TEST';
           update public.subscriptions set status='past_due' where user_id='$UID_TEST';"
  psql_do "select entitled, status from public.get_entitlement('$UID_TEST');"

  say "canceled -> expect entitled=f (row kept, customer id survives)"
  psql_do "update public.subscriptions set status='canceled' where user_id='$UID_TEST';"
  psql_do "select entitled, status from public.get_entitlement('$UID_TEST');"
  psql_do "select stripe_customer_id from public.subscriptions where user_id='$UID_TEST';"

  printf '\n\033[32mOFFLINE CHECKS DONE.\033[0m Verify above: active=t, under-cap=t, over-cap=f, past_due=t, canceled=f, customer id retained.\n'
}

# ──────────────────────────────────────────────────────────────────────────────
stripe_mode() {
  for c in supabase stripe jq curl; do have "$c" || { echo "$c not installed — see supabase/README.md"; exit 1; }; done
  : "${SUPABASE_URL:?set SUPABASE_URL (printed by supabase start)}"
  : "${ANON_KEY:?set ANON_KEY (printed by supabase start)}"

  say "Mint a real JWT for the seeded test user (password grant)"
  JWT=$(curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
    -d '{"email":"billing-test@cubic.dev","password":"test-password-123"}' | jq -r .access_token)
  [ "$JWT" != "null" ] && [ -n "$JWT" ] || { echo "failed to mint JWT — is 'supabase functions serve' + db up?"; exit 1; }
  echo "JWT acquired."

  say "Call create-checkout (open the returned URL, pay with test card 4242 4242 4242 4242)"
  curl -s -X POST "http://localhost:54321/functions/v1/create-checkout" \
    -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
    -d '{"plan":"pro"}' | jq .

  cat <<'EOF'

Next (separate terminals must already be running):
  A) supabase functions serve --env-file supabase/.env
  B) stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook
     -> paste the whsec_ into supabase/.env and restart A

After paying (or `stripe trigger customer.subscription.created`), assert the sync:
  psql "$SUPABASE_DB_URL" -c "select status, plan, price_id, current_period_start
                              from public.subscriptions where user_id='00000000-0000-0000-0000-0000000b1111';"
  psql "$SUPABASE_DB_URL" -c "select * from public.get_entitlement('00000000-0000-0000-0000-0000000b1111');"

Then test the portal:
  curl -s -X POST localhost:54321/functions/v1/create-portal -H "Authorization: Bearer $JWT" | jq .
EOF
}

case "$MODE" in
  offline) offline ;;
  stripe)  stripe_mode ;;
  *) echo "usage: $0 [offline|stripe]"; exit 1 ;;
esac
