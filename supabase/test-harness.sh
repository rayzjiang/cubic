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
# assert a SQL boolean expression returns true; HARD-FAIL (exit 1) otherwise so a
# wrong value can never read as a pass (CI-safe).
assert() { # $1 = description, $2 = sql returning a single boolean
  local got
  got=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qtAX -c "$2" 2>&1 | tr -d '[:space:]')
  if [ "$got" = "t" ]; then printf '  \033[32mPASS\033[0m %s\n' "$1"
  else printf '  \033[31mFAIL\033[0m %s (got: %s)\n' "$1" "$got"; exit 1; fi
}

# ──────────────────────────────────────────────────────────────────────────────
offline() {
  have supabase || { echo "supabase CLI not installed — see supabase/README.md"; exit 1; }
  have psql     || { echo "psql not found — install: brew install libpq && brew link --force libpq"; exit 1; }

  # Fixed billing window so usage rows stay in/out of it deterministically across steps.
  local PSTART="2026-06-01T00:00:00Z" PEND="2026-07-01T00:00:00Z"

  say "Resetting local DB (migrations + seed)"
  supabase db reset

  say "Plans seeded (allowance SSOT)"
  psql_do "select plan || ' = ' || allowance_cents || ' cents' from public.plans order by plan;"
  assert "two plans seeded"        "select count(*) = 2 from public.plans;"
  assert "pro allowance = 50000"   "select allowance_cents = 50000 from public.plans where plan='pro';"

  say "apply_subscription RPC: ACTIVE Pro (Stripe event t=1000)"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','active','$PRICE_PRO','pro',
            '$PSTART','$PEND', false, to_timestamp(1000));"
  assert "active -> entitled"      "select entitled from public.get_entitlement('$UID_TEST');"

  say "Meter spend UNDER cap (49999)"
  psql_do "insert into public.usage (user_id, period_start, spent_cents) values ('$UID_TEST','$PSTART',49999)
           on conflict (user_id,period_start) do update set spent_cents=excluded.spent_cents;"
  assert "under cap -> entitled"   "select entitled from public.get_entitlement('$UID_TEST');"

  say "Meter spend OVER cap (50001) -> hard cap blocks"
  psql_do "update public.usage set spent_cents=50001 where user_id='$UID_TEST' and period_start='$PSTART';"
  assert "over cap -> blocked"     "select not entitled from public.get_entitlement('$UID_TEST');"

  say "C2 window-sum: spend in a PAST cycle must NOT count"
  psql_do "update public.usage set spent_cents=0 where user_id='$UID_TEST' and period_start='$PSTART';
           insert into public.usage (user_id, period_start, spent_cents)
             values ('$UID_TEST', timestamptz '$PSTART' - interval '90 days', 999999)
           on conflict (user_id,period_start) do update set spent_cents=excluded.spent_cents;"
  assert "out-of-window spend ignored" "select entitled from public.get_entitlement('$UID_TEST');"
  assert "window sum = 0"          "select spent_cents = 0 from public.get_entitlement('$UID_TEST');"

  say "past_due (under cap) -> grace (event t=2000)"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','past_due','$PRICE_PRO','pro',
            '$PSTART','$PEND', false, to_timestamp(2000));"
  assert "past_due -> entitled"    "select entitled from public.get_entitlement('$UID_TEST');"

  say "cancel (event t=3000) -> blocked; row + customer id kept (never-delete)"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','canceled','$PRICE_PRO','pro',
            '$PSTART','$PEND', false, to_timestamp(3000));"
  assert "canceled -> blocked"     "select not entitled from public.get_entitlement('$UID_TEST');"
  assert "row kept (canceled)"     "select status='canceled' from public.subscriptions where user_id='$UID_TEST';"
  assert "customer id retained"    "select stripe_customer_id='cus_test' from public.subscriptions where user_id='$UID_TEST';"

  say "F4 out-of-order: a STALE 'active' (older event t=1500) must NOT un-cancel"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','active','$PRICE_PRO','pro',
            '$PSTART','$PEND', false, to_timestamp(1500));"
  assert "stale event ignored"     "select status='canceled' from public.subscriptions where user_id='$UID_TEST';"
  assert "still blocked"           "select not entitled from public.get_entitlement('$UID_TEST');"

  say "F1 IDOR: a logged-in user CANNOT read another user's entitlement"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qtAX <<SQL
do \$\$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  begin
    perform public.get_entitlement('$UID_TEST');
    raise exception 'IDOR HOLE: cross-user read succeeded';
  exception when others then
    if position('forbidden' in sqlerrm) = 0 then raise; end if;  -- re-raise anything that is NOT our forbidden guard
  end;
end \$\$;
SQL
  printf '  \033[32mPASS\033[0m cross-user read denied\n'

  printf '\n\033[32mALL OFFLINE CHECKS PASSED.\033[0m\n'
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
