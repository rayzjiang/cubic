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

  # Periods are now()-RELATIVE (not a fixed calendar window): the #7 time backstop compares
  # current_period_end to now(), so the tests must place now() inside/outside each window on purpose.
  local UNKNOWN_PRICE="price_UNKNOWN_not_in_plans"

  say "Resetting local DB (migrations + seed)"
  supabase db reset

  say "Plans seeded (allowance SSOT)"
  psql_do "select plan || ' = ' || allowance_cents || ' cents' from public.plans order by plan;"
  assert "two plans seeded"        "select count(*) = 2 from public.plans;"
  assert "pro allowance = 50000"   "select allowance_cents = 50000 from public.plans where plan='pro';"

  # ── Spend-cap tests (window contains now; spend drives entitlement) ──
  say "ACTIVE Pro, current window contains now (event t=1000)"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','active','$PRICE_PRO','pro',
            now() - interval '5 days', now() + interval '25 days', false, to_timestamp(1000));"
  assert "active in-window -> entitled" "select entitled from public.get_entitlement('$UID_TEST');"

  say "Meter spend UNDER cap (49999)"
  psql_do "insert into public.usage (user_id, period_start, spent_cents)
           values ('$UID_TEST', now() - interval '1 day', 49999)
           on conflict (user_id,period_start) do update set spent_cents=excluded.spent_cents;"
  assert "under cap -> entitled"   "select entitled from public.get_entitlement('$UID_TEST');"

  say "Meter spend OVER cap (50001) -> hard cap blocks"
  psql_do "update public.usage set spent_cents=50001 where user_id='$UID_TEST';"
  assert "over cap -> blocked"     "select not entitled from public.get_entitlement('$UID_TEST');"

  say "C2 window-sum: spend in a PAST cycle must NOT count"
  psql_do "delete from public.usage where user_id='$UID_TEST';
           insert into public.usage (user_id, period_start, spent_cents)
             values ('$UID_TEST', now() - interval '400 days', 999999);"
  assert "out-of-window spend ignored" "select entitled from public.get_entitlement('$UID_TEST');"
  assert "window sum = 0"          "select spent_cents = 0 from public.get_entitlement('$UID_TEST');"

  # Clean slate so the #7 time/status tests below are isolated (spend = 0, cap never the blocker).
  psql_do "delete from public.usage where user_id='$UID_TEST';"

  # ── #7 time backstop + fail-fast (spend = 0) ──
  say "#7 active just past period_end but within 48h buffer -> ENTITLED (t=2000)"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','active','$PRICE_PRO','pro',
            now() - interval '10 days', now() - interval '1 hour', false, to_timestamp(2000));"
  assert "active within 48h buffer -> entitled" "select entitled from public.get_entitlement('$UID_TEST');"

  say "#7 active well past the 48h buffer -> BLOCKED (t=3000)"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','active','$PRICE_PRO','pro',
            now() - interval '40 days', now() - interval '3 days', false, to_timestamp(3000));"
  assert "active past buffer -> blocked" "select not entitled from public.get_entitlement('$UID_TEST');"

  say "#7 trialing within window -> ENTITLED (t=4000)"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','trialing','$PRICE_PRO','pro',
            now() - interval '1 day', now() + interval '1 day', false, to_timestamp(4000));"
  assert "trialing in-window -> entitled" "select entitled from public.get_entitlement('$UID_TEST');"

  say "#7 trialing past period_end -> BLOCKED, no buffer (t=5000)"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','trialing','$PRICE_PRO','pro',
            now() - interval '2 days', now() - interval '1 minute', false, to_timestamp(5000));"
  assert "trialing past end -> blocked" "select not entitled from public.get_entitlement('$UID_TEST');"

  say "#7 past_due -> BLOCKED, fail-fast 0 grace (t=6000) [replaces the old past_due->grace test]"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','past_due','$PRICE_PRO','pro',
            now() - interval '5 days', now() + interval '25 days', false, to_timestamp(6000));"
  assert "past_due -> blocked"     "select not entitled from public.get_entitlement('$UID_TEST');"
  assert "past_due real status returned (not null)" "select status='past_due' from public.get_entitlement('$UID_TEST');"

  # ── cancel + resurrection guard (#9) ──
  say "cancel (event t=7000) -> blocked; row + customer id kept (never-delete)"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','canceled','$PRICE_PRO','pro',
            now() - interval '5 days', now() + interval '25 days', false, to_timestamp(7000));"
  assert "canceled -> blocked"     "select not entitled from public.get_entitlement('$UID_TEST');"
  assert "row kept (canceled)"     "select status='canceled' from public.subscriptions where user_id='$UID_TEST';"
  assert "customer id retained"    "select stripe_customer_id='cus_test' from public.subscriptions where user_id='$UID_TEST';"

  say "#9 STRICTLY-OLDER stale active (t=6500 < 7000) must NOT un-cancel"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','active','$PRICE_PRO','pro',
            now() - interval '5 days', now() + interval '25 days', false, to_timestamp(6500));"
  assert "older stale event ignored" "select status='canceled' from public.subscriptions where user_id='$UID_TEST';"

  say "#9 SAME-SECOND stale active (t=7000 == cancel) must NOT un-cancel [the new terminal-tie guard]"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','active','$PRICE_PRO','pro',
            now() - interval '5 days', now() + interval '25 days', false, to_timestamp(7000));"
  assert "same-second stale event ignored" "select status='canceled' from public.subscriptions where user_id='$UID_TEST';"
  assert "still blocked after tie" "select not entitled from public.get_entitlement('$UID_TEST');"

  # ── #8 unknown price no longer FK-crashes (this apply would ERROR under the old FK) ──
  say "#8 unknown price applies with NO FK error -> allowance 0 -> blocked (t=8000)"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','active','$UNKNOWN_PRICE','unknown',
            now() - interval '5 days', now() + interval '25 days', false, to_timestamp(8000));"
  assert "unknown-price row applied" "select price_id='$UNKNOWN_PRICE' from public.subscriptions where user_id='$UID_TEST';"
  assert "unknown price -> allowance 0" "select allowance_cents = 0 from public.get_entitlement('$UID_TEST');"
  assert "unknown price -> blocked" "select not entitled from public.get_entitlement('$UID_TEST');"

  # ── plan VERSIONING (20260706000002): many rows per tier, one active; retired
  #    rows keep serving their allowance to subs not yet migrated off them ──
  say "VERSIONING: partial-unique rejects a SECOND active row for the same tier"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qtAX <<SQL
do \$\$
begin
  begin
    insert into public.plans (price_id, plan, allowance_cents, active)
      values ('price_pro_v2_test', 'pro', 80000, true);
    raise exception 'PARTIAL-UNIQUE HOLE: a second active pro row was allowed';
  exception when unique_violation then null;  -- expected: plans_one_active_per_plan
  end;
end \$\$;
SQL
  printf '  \033[32mPASS\033[0m second active pro row rejected\n'

  say "VERSIONING: set_active_plan_version swaps active + keeps the old row"
  psql_do "select public.set_active_plan_version('pro','price_pro_v2_test', 80000);"
  assert "new price is the sole active 'pro'"     "select price_id='price_pro_v2_test' from public.plans where plan='pro' and active;"
  assert "exactly one active 'pro'"               "select count(*)=1 from public.plans where plan='pro' and active;"
  assert "old pro row retained (inactive)"        "select not active from public.plans where price_id='price_pro_PLACEHOLDER';"
  assert "old pro allowance unchanged (50000)"    "select allowance_cents=50000 from public.plans where price_id='price_pro_PLACEHOLDER';"
  assert "new pro allowance = 80000"              "select allowance_cents=80000 from public.plans where price_id='price_pro_v2_test';"

  say "VERSIONING: a NOT-yet-migrated sub still resolves the OLD (retired) allowance"
  psql_do "delete from public.usage where user_id='$UID_TEST';
           select public.apply_subscription('$UID_TEST','sub_test','cus_test','active','price_pro_PLACEHOLDER','pro',
            now() - interval '5 days', now() + interval '25 days', false, to_timestamp(9000));"
  assert "old-price sub -> allowance 50000"       "select allowance_cents=50000 from public.get_entitlement('$UID_TEST');"
  assert "old-price sub still entitled"           "select entitled from public.get_entitlement('$UID_TEST');"

  say "VERSIONING: a MIGRATED sub (on the new price) resolves the NEW allowance"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','active','price_pro_v2_test','pro',
            now() - interval '5 days', now() + interval '25 days', false, to_timestamp(10000));"
  assert "new-price sub -> allowance 80000"       "select allowance_cents=80000 from public.get_entitlement('$UID_TEST');"

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

  # ── P2 (account deletion): cancel_at_period_end surfaced + delete cascade + webhook hardening ──
  # These run LAST because the final step deletes the seed auth user (db reset restores it next run).
  say "P2 get_entitlement now returns cancel_at_period_end (drives the delete gate)"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','active','price_pro_v2_test','pro',
            now() - interval '5 days', now() + interval '25 days', TRUE, to_timestamp(11000));"
  assert "cancel_at_period_end=true surfaced"  "select cancel_at_period_end from public.get_entitlement('$UID_TEST');"
  psql_do "select public.apply_subscription('$UID_TEST','sub_test','cus_test','active','price_pro_v2_test','pro',
            now() - interval '5 days', now() + interval '25 days', FALSE, to_timestamp(12000));"
  assert "cancel_at_period_end=false surfaced" "select not cancel_at_period_end from public.get_entitlement('$UID_TEST');"

  say "P2 delete-account CASCADE: deleting the auth user clears subscriptions + usage"
  psql_do "insert into public.usage (user_id, period_start, spent_cents)
           values ('$UID_TEST', now() - interval '1 day', 123)
           on conflict (user_id,period_start) do update set spent_cents=excluded.spent_cents;"
  assert "sub row exists pre-delete"    "select count(*)=1 from public.subscriptions where user_id='$UID_TEST';"
  assert "usage row exists pre-delete"  "select count(*)=1 from public.usage where user_id='$UID_TEST';"
  psql_do "delete from auth.users where id='$UID_TEST';"
  assert "subscriptions cascaded to 0"  "select count(*)=0 from public.subscriptions where user_id='$UID_TEST';"
  assert "usage cascaded to 0"          "select count(*)=0 from public.usage where user_id='$UID_TEST';"

  say "P2 webhook hardening: apply_subscription for a DELETED user raises FK 23503 (the case the webhook no-ops on)"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qtAX <<SQL
do \$\$
begin
  begin
    perform public.apply_subscription('$UID_TEST','sub_test','cus_test','canceled','price_pro_v2_test','pro',
      now() - interval '5 days', now() + interval '25 days', false, to_timestamp(13000));
    raise exception 'HARDENING HOLE: apply_subscription for a deleted user did NOT raise';
  exception when foreign_key_violation then null;  -- expected 23503 -> stripe-webhook catches this and no-ops (200)
  end;
end \$\$;
SQL
  printf '  \033[32mPASS\033[0m deleted-user apply raises 23503 (webhook no-ops on this)\n'

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

  say "#10 double create-checkout (same idempotency key) -> ONE session, or a 409"
  CO_URL="http://localhost:54321/functions/v1/create-checkout"
  CO_HDR=(-H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"plan":"pro"}')
  R1=$(curl -s -X POST "$CO_URL" "${CO_HDR[@]}")
  R2=$(curl -s -X POST "$CO_URL" "${CO_HDR[@]}")
  echo "  #1: $R1"; echo "  #2: $R2"
  S1=$(echo "$R1" | jq -r '.url // empty' | sed -E 's#.*/(pay|c/pay)/([^?]+).*#\2#')
  S2=$(echo "$R2" | jq -r '.url // empty' | sed -E 's#.*/(pay|c/pay)/([^?]+).*#\2#')
  if [ -n "$S1" ] && [ "$S1" = "$S2" ]; then
    printf '  \033[32mPASS\033[0m identical session returned (idempotency dedup) — one subscription, no double charge\n'
  elif echo "$R2" | jq -e '.error == "checkout_in_progress"' >/dev/null 2>&1; then
    printf '  \033[32mPASS\033[0m 2nd concurrent call 409 checkout_in_progress\n'
  else
    printf '  \033[31mFAIL\033[0m two DIFFERENT sessions — idempotency key not deduping\n'; exit 1
  fi

  cat <<'EOF'

Next (separate terminals must already be running):
  A) supabase functions serve --env-file supabase/.env
  B) stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook
     -> paste the whsec_ into supabase/.env and restart A

After paying (or `stripe trigger customer.subscription.created`), assert the sync:
  psql "$SUPABASE_DB_URL" -c "select status, plan, price_id, current_period_start
                              from public.subscriptions where user_id='00000000-0000-0000-0000-0000000b1111';"
  psql "$SUPABASE_DB_URL" -c "select * from public.get_entitlement('00000000-0000-0000-0000-0000000b1111');"

#8 unknown price does NOT 500-loop the webhook (would freeze ALL billing under the old FK):
  # `stripe trigger customer.subscription.created` uses a fixture price NOT in your plans table.
  stripe trigger customer.subscription.created
  # -> the stripe listen (B) terminal must show a 200 (not 500), and the functions-serve (A) log must
  #    show the loud "UNKNOWN price ... applying with plan='unknown'" line. The user then reads as blocked:
  psql "$SUPABASE_DB_URL" -c "select entitled, allowance_cents, status from public.get_entitlement('00000000-0000-0000-0000-0000000b1111');"
  # expect: entitled=f, allowance_cents=0, status=active (a mispriced cohort blocked + logged, NOT a freeze).

#10 duplicate-subscription backstop (cancel + refund a 2nd sub from a checkout race):
  # With one active sub already synced, fire a SECOND created event with a different sub id:
  stripe trigger customer.subscription.created --override subscription:id=sub_DUPLICATE_test
  # -> functions-serve (A) log shows "DUPLICATE subscription sub_DUPLICATE_test ... canceling + refunding";
  #    the stored row still points at the ORIGINAL sub id (the dup never clobbers it):
  psql "$SUPABASE_DB_URL" -c "select stripe_subscription_id, status from public.subscriptions where user_id='00000000-0000-0000-0000-0000000b1111';"
  # and in the Stripe dashboard (test mode) the duplicate subscription is canceled and its charge refunded.

Then test the portal:
  curl -s -X POST localhost:54321/functions/v1/create-portal -H "Authorization: Bearer $JWT" | jq .

P2 direct "Cancel plan" deep link (flow_data) — the URL should open the cancel flow, not the Portal home:
  curl -s -X POST localhost:54321/functions/v1/create-portal -H "Authorization: Bearer $JWT" \
       -H "Content-Type: application/json" -d '{"flow":"cancel"}' | jq .

P2 account deletion (with a real sub synced, rows present):
  curl -s -X POST localhost:54321/functions/v1/delete-account -H "Authorization: Bearer $JWT" | jq .
  # expect {"ok":true}. Then the billing rows are gone (cascade) and the user can't be fetched:
  psql "$SUPABASE_DB_URL" -c "select count(*) from public.subscriptions where user_id='00000000-0000-0000-0000-0000000b1111';"  # 0
  psql "$SUPABASE_DB_URL" -c "select count(*) from public.usage         where user_id='00000000-0000-0000-0000-0000000b1111';"  # 0
  # Deleting cancels the Stripe sub, which fires a real customer.subscription.deleted webhook AFTER the
  # user is gone: the stripe listen (B) terminal must show 200 (NOT 500), and functions-serve (A) logs
  #   "subscription event for deleted user ... acknowledging without applying".
EOF
}

case "$MODE" in
  offline) offline ;;
  stripe)  stripe_mode ;;
  *) echo "usage: $0 [offline|stripe]"; exit 1 ;;
esac
