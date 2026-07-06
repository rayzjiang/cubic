// change-plan — the operator's single control panel for plan pricing + usage limits.
//
// One command changes an EXISTING tier's Stripe price and/or internal allowance_cents,
// or adds a brand-new tier. New customers get the change immediately (create-checkout
// reads the active `plans` row); EXISTING customers converge at their OWN next billing
// cycle (staggered) via Stripe Subscription Schedules — no mid-cycle recharge, and price
// + allowance flip together when the phase advances and the webhook rewrites their row.
//
// Deno (mirrors the Edge Functions' runtime): reuses the SAME pinned Stripe client and
// service-role Supabase client, so nothing drifts. Needs STRIPE_SECRET_KEY + SUPABASE_URL
// + SUPABASE_SERVICE_ROLE_KEY in the environment. NOTE: supabase/.env only holds the STRIPE_*
// keys — the SUPABASE_* vars are normally auto-injected by `supabase functions serve`, so a
// standalone run must supply them (locally they come from `supabase status`).
//
// Run (LOCAL — Supabase url/key from `supabase status`, Stripe keys from --env-file):
//   SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o env | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '\"')" \
//   deno run -A --env-file=supabase/.env supabase/scripts/change-plan.ts \
//     --plan pro --price 30 --allowance 80000 --notice-days 30 --dry-run
//
// Run (PROD): set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to your prod project values
//   (Supabase dashboard -> Project Settings -> API) and STRIPE_SECRET_KEY to the live key.
//
//   # allowance-only (keep the dollar price): --price same
//   # price-only (keep the allowance):        --allowance same
//   # write the roster to a file:             --out roster.json
//   # add a brand-new tier:                   --add-plan --plan lite --price 12 --allowance 20000
//
// ALWAYS dry-run first: it prints exactly who would be migrated + when, and makes ZERO
// writes to Stripe or the DB.
//
// The shared clients are loaded LAZILY (in main(), after the env check) — importing
// _shared/stripe.ts eagerly would construct `new Stripe('')` at module load and stripe@17
// throws on an empty key, so `--help` / a missing key must be handled before that import.
import type Stripe from 'npm:stripe@17';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

let stripe: Stripe;
let admin: SupabaseClient;

// ── tiny arg parser: --key value pairs + boolean flags ──────────────────────────
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true; // boolean flag (--dry-run, --add-plan)
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function fail(msg: string): never {
  console.error(`\x1b[31mERROR\x1b[0m ${msg}`);
  Deno.exit(1);
}

const USAGE = `Usage:
  change existing tier: --plan <pro|max|...> --price <dollars|same> --allowance <cents|same> [--notice-days 30] [--product <prod_id>] [--dry-run] [--out roster.json]
  add a new tier:       --add-plan --plan <label> --price <dollars> --allowance <cents> [--product <prod_id>] [--product-name "Cubic Lite"] [--dry-run]`;

// unix-seconds helpers (this is a normal Deno script — Date is available)
const nowUnix = () => Math.floor(Date.now() / 1000);
const isoOf = (unix: number) => new Date(unix * 1000).toISOString();
const unixOfIso = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
function addOneMonthUnix(unix: number): number {
  const d = new Date(unix * 1000);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return Math.floor(d.getTime() / 1000);
}

// For a price INCREASE, push the effective date to the first renewal >= notice window
// (customers renewing sooner keep the old price one more cycle) — card-network advance-
// notice compliance. Non-increases (decreases, allowance-only) land at the next renewal.
function computeEffective(nextRenewalUnix: number, isPriceIncrease: boolean, noticeDays: number): number {
  if (!isPriceIncrease) return nextRenewalUnix;
  const cutoff = nowUnix() + noticeDays * 86400;
  let eff = nextRenewalUnix;
  while (eff < cutoff) eff = addOneMonthUnix(eff);
  return eff;
}

// ── shared: create the new Stripe Price on a product ────────────────────────────
async function createPrice(product: string, unitAmountCents: number, currency: string, interval: string) {
  return await stripe.prices.create({
    product,
    currency,
    unit_amount: unitAmountCents,
    recurring: { interval: interval as 'month' | 'year' },
  });
}

type RosterRow = {
  user_id: string;
  email: string | null;
  tier: string;
  old_price: string;
  new_price: string;
  effective_date: string;
  change_type: string;
  status: 'scheduled' | 'skipped' | 'planned';
  note?: string;
};

async function emailOf(userId: string): Promise<string | null> {
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

function printRoster(rows: RosterRow[]): void {
  console.log(`\n\x1b[1mRoster — ${rows.length} existing customer(s) affected\x1b[0m`);
  if (rows.length === 0) {
    console.log('  (none — no active/trialing subscribers on the old price)');
    return;
  }
  for (const r of rows) {
    console.log(
      `  ${r.status.toUpperCase().padEnd(9)} ${r.email ?? r.user_id}  ${r.old_price} -> ${r.new_price}  ` +
        `@ ${r.effective_date}  [${r.change_type}]${r.note ? `  (${r.note})` : ''}`,
    );
  }
}

async function writeRoster(rows: RosterRow[], out: string | undefined): Promise<void> {
  if (!out) return;
  await Deno.writeTextFile(out, JSON.stringify(rows, null, 2));
  console.log(`\nRoster written to ${out}`);
}

// ── mode: add a brand-new tier ──────────────────────────────────────────────────
async function addPlan(args: Record<string, string | boolean>): Promise<void> {
  const plan = String(args.plan ?? '');
  const price = String(args.price ?? '');
  const allowance = String(args.allowance ?? '');
  const dryRun = Boolean(args['dry-run']);
  if (!plan || !price || price === 'same' || !allowance || allowance === 'same') {
    fail(`add-plan needs --plan, a concrete --price (dollars), and --allowance (cents).\n${USAGE}`);
  }
  const unitAmountCents = Math.round(parseFloat(price) * 100);
  const allowanceCents = parseFloat(allowance);
  if (!Number.isFinite(unitAmountCents) || unitAmountCents < 0) fail(`bad --price: ${price}`);
  if (!Number.isFinite(allowanceCents) || allowanceCents < 0) fail(`bad --allowance: ${allowance}`);

  // Guard: a tier that already has an active row is a CHANGE, not an add.
  const { data: existing } = await admin
    .from('plans').select('price_id').eq('plan', plan).eq('active', true).maybeSingle();
  if (existing) fail(`tier '${plan}' already has an active price (${existing.price_id}) — use change mode (drop --add-plan).`);

  const currency = String(args.currency ?? 'usd');
  const interval = String(args.interval ?? 'month');
  const productName = String(args['product-name'] ?? `Cubic ${plan}`);

  console.log(`\x1b[1madd-plan '${plan}'\x1b[0m: $${(unitAmountCents / 100).toFixed(2)}/${interval}, allowance ${allowanceCents} cents${dryRun ? '  (DRY RUN)' : ''}`);

  if (dryRun) {
    console.log(`  would create Stripe product "${productName}" + a $${(unitAmountCents / 100).toFixed(2)} price`);
    console.log(`  would insert plans row (${plan}, active) via set_active_plan_version`);
  } else {
    const product = args.product ? String(args.product) : (await stripe.products.create({ name: productName })).id;
    const newPrice = await createPrice(product, unitAmountCents, currency, interval);
    console.log(`  created Stripe product ${product} + price ${newPrice.id}`);
    const { error } = await admin.rpc('set_active_plan_version', {
      p_plan: plan, p_price_id: newPrice.id, p_allowance_cents: allowanceCents,
    });
    if (error) fail(`set_active_plan_version failed: ${error.message}`);
    console.log(`  inserted active plans row for '${plan}' -> ${newPrice.id}`);
  }

  console.log(`\n\x1b[33mReminders — a NEW tier label also needs (outside this CLI):\x1b[0m`);
  console.log(`  1. Add '${plan}' to the PlanId union in supabase/functions/_shared/config.ts and allow it in create-checkout's plan validation.`);
  console.log(`  2. Showing the tier in the app paywall is the client UI (Wave-3 §D) — deferred.`);
}

// ── mode: change an existing tier's price and/or allowance ──────────────────────
async function changePlan(args: Record<string, string | boolean>): Promise<void> {
  const plan = String(args.plan ?? '');
  const priceArg = String(args.price ?? '');
  const allowanceArg = String(args.allowance ?? '');
  const noticeDays = Number(args['notice-days'] ?? 30);
  const dryRun = Boolean(args['dry-run']);
  const out = args.out ? String(args.out) : undefined;
  const currency = String(args.currency ?? 'usd');
  const interval = String(args.interval ?? 'month');
  if (!plan || !priceArg || !allowanceArg) fail(`change needs --plan, --price (dollars|same), --allowance (cents|same).\n${USAGE}`);
  if (!Number.isFinite(noticeDays) || noticeDays < 0) fail(`bad --notice-days: ${args['notice-days']}`);

  // 1) Current active price row for the tier (the one we migrate FROM).
  const { data: cur, error: curErr } = await admin
    .from('plans').select('price_id, allowance_cents').eq('plan', plan).eq('active', true).maybeSingle();
  if (curErr) fail(`plans lookup failed: ${curErr.message}`);
  if (!cur) fail(`no active price for tier '${plan}'. To create it, use --add-plan.`);
  const oldPriceId: string = cur.price_id;
  const oldAllowance = Number(cur.allowance_cents);

  // 2) Old Stripe price amount (for `--price same`, change-type + notice guard). A
  //    placeholder/nonexistent price can't be retrieved -> oldAmount stays null.
  let oldAmount: number | null = null;
  let product: string | null = null;
  try {
    const p = await stripe.prices.retrieve(oldPriceId);
    oldAmount = p.unit_amount;
    product = typeof p.product === 'string' ? p.product : p.product.id;
  } catch {
    console.log(`\x1b[33mnote\x1b[0m current price ${oldPriceId} is not a retrievable Stripe price (placeholder?) — no existing subs to migrate off it are expected.`);
  }

  // 3) Resolve the new amount + allowance.
  let newAmountCents: number;
  if (priceArg === 'same') {
    if (oldAmount == null) fail(`--price same needs a real current Stripe price; ${oldPriceId} isn't one. Pass an explicit --price.`);
    newAmountCents = oldAmount;
  } else {
    newAmountCents = Math.round(parseFloat(priceArg) * 100);
    if (!Number.isFinite(newAmountCents) || newAmountCents < 0) fail(`bad --price: ${priceArg}`);
  }
  const newAllowance = allowanceArg === 'same' ? oldAllowance : parseFloat(allowanceArg);
  if (!Number.isFinite(newAllowance) || newAllowance < 0) fail(`bad --allowance: ${allowanceArg}`);

  // 4) Resolve the Stripe product to hang the new price on (same product = versioned price).
  if (args.product) product = String(args.product);

  // 5) Classify the change (drives the notice guard + roster label).
  const isPriceIncrease = oldAmount != null && newAmountCents > oldAmount;
  const priceMoved = oldAmount == null || newAmountCents !== oldAmount;
  const allowMoved = newAllowance !== oldAllowance;
  const changeType = [
    priceMoved ? (oldAmount != null && newAmountCents < oldAmount ? 'price_decrease' : 'price_increase') : null,
    allowMoved ? (newAllowance < oldAllowance ? 'allowance_decrease' : 'allowance_increase') : null,
  ].filter(Boolean).join('+') || 'no_change';
  if (changeType === 'no_change') fail(`nothing to change — new price + allowance match the current active row.`);

  // 6) Existing subscribers to migrate (pinned to the OLD price, still live).
  const { data: subs, error: subsErr } = await admin
    .from('subscriptions')
    .select('user_id, stripe_subscription_id, status, current_period_end')
    .eq('price_id', oldPriceId)
    .in('status', ['active', 'trialing']);
  if (subsErr) fail(`subscriptions lookup failed: ${subsErr.message}`);
  const affected = subs ?? [];

  console.log(
    `\n\x1b[1mchange '${plan}'\x1b[0m [${changeType}]${dryRun ? '  (DRY RUN — no writes)' : ''}\n` +
      `  price:     ${oldAmount != null ? `$${(oldAmount / 100).toFixed(2)}` : '(placeholder)'} -> $${(newAmountCents / 100).toFixed(2)}\n` +
      `  allowance: ${oldAllowance} -> ${newAllowance} cents\n` +
      `  ${affected.length} existing subscriber(s) migrate at their next cycle` +
      `${isPriceIncrease ? ` (increase: first renewal >= ${noticeDays} days out)` : ''}`,
  );

  const roster: RosterRow[] = [];

  if (dryRun) {
    for (const s of affected) {
      const effective = computeEffective(unixOfIso(s.current_period_end), isPriceIncrease, noticeDays);
      roster.push({
        user_id: s.user_id, email: await emailOf(s.user_id), tier: plan,
        old_price: oldPriceId, new_price: '(new price — not created in dry run)',
        effective_date: isoOf(effective), change_type: changeType, status: 'planned',
      });
    }
    printRoster(roster);
    await writeRoster(roster, out);
    console.log('\nDry run complete — nothing was created or changed.');
    return;
  }

  // ── REAL RUN ──
  if (product == null) {
    // No product derivable (first real price for a placeholder tier) — create one.
    product = (await stripe.products.create({ name: String(args['product-name'] ?? `Cubic ${plan}`) })).id;
    console.log(`  created Stripe product ${product} (none was derivable from the placeholder price)`);
  }
  const newPrice = await createPrice(product, newAmountCents, currency, interval);
  console.log(`  created Stripe price ${newPrice.id} on product ${product}`);

  for (const s of affected) {
    try {
      const schedule = await stripe.subscriptionSchedules.create({ from_subscription: s.stripe_subscription_id });
      const phase0 = schedule.phases[0];
      const currentPriceId = typeof phase0.items[0].price === 'string' ? phase0.items[0].price : phase0.items[0].price.id;
      const effective = computeEffective(phase0.end_date, isPriceIncrease, noticeDays);
      await stripe.subscriptionSchedules.update(schedule.id, {
        end_behavior: 'release',
        phases: [
          { items: [{ price: currentPriceId, quantity: 1 }], start_date: phase0.start_date, end_date: effective },
          { items: [{ price: newPrice.id, quantity: 1 }], start_date: effective },
        ],
      });
      roster.push({
        user_id: s.user_id, email: await emailOf(s.user_id), tier: plan,
        old_price: oldPriceId, new_price: newPrice.id,
        effective_date: isoOf(effective), change_type: changeType, status: 'scheduled',
      });
    } catch (e) {
      const note = e instanceof Error ? e.message : String(e);
      console.error(`\x1b[31mskip\x1b[0m sub ${s.stripe_subscription_id} (user ${s.user_id}): ${note}`);
      roster.push({
        user_id: s.user_id, email: await emailOf(s.user_id), tier: plan,
        old_price: oldPriceId, new_price: newPrice.id,
        effective_date: '', change_type: changeType, status: 'skipped', note,
      });
    }
  }

  // Cut new signups over to the new price (atomic active-row swap; old row kept live
  // so not-yet-migrated subscribers keep their allowance until their schedule flips).
  const { error: swapErr } = await admin.rpc('set_active_plan_version', {
    p_plan: plan, p_price_id: newPrice.id, p_allowance_cents: newAllowance,
  });
  if (swapErr) fail(`set_active_plan_version failed AFTER creating price ${newPrice.id} + schedules — re-run to converge: ${swapErr.message}`);
  console.log(`  set '${plan}' active price -> ${newPrice.id}; old ${oldPriceId} retired (kept live for its subscribers)`);

  printRoster(roster);
  await writeRoster(roster, out);
  const skipped = roster.filter((r) => r.status === 'skipped').length;
  if (skipped) console.log(`\n\x1b[33m${skipped} subscriber(s) skipped\x1b[0m — re-run to retry them (schedule creation is per-sub).`);
}

// ── entry ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  if (args.help || Deno.args.length === 0) { console.log(USAGE); Deno.exit(0); }
  for (const k of ['STRIPE_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!Deno.env.get(k)) fail(`${k} is not set. Pass --env-file=supabase/.env (or export it).`);
  }
  // Lazy-load the shared singletons only now that we know the env is present.
  stripe = (await import('../functions/_shared/stripe.ts')).stripe;
  admin = (await import('../functions/_shared/supabaseAdmin.ts')).admin;
  return args['add-plan'] ? addPlan(args) : changePlan(args);
}

await main();
