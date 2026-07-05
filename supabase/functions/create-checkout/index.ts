// create-checkout — mint a Stripe Checkout session for a plan and return its URL.
// The renderer opens the URL in the system browser; Stripe redirects back via the
// cubic:// deep link (WT-AUTH's handler). Identity rides through on
// client_reference_id + subscription metadata so the webhook resolves the user.
import { requireUser } from '../_shared/auth.ts';
import { admin } from '../_shared/supabaseAdmin.ts';
import { stripe } from '../_shared/stripe.ts';
import { RETURN_URLS, TRIAL, type PlanId } from '../_shared/config.ts';
import { corsHeaders, json } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const caller = await requireUser(req);
    const { plan } = (await req.json().catch(() => ({}))) as { plan?: PlanId };
    if (plan !== 'pro' && plan !== 'max') return json({ error: 'unknown plan' }, 400);

    // Resolve the Stripe price from the plans table (the allowance/price SSOT).
    const { data: planRow, error: planErr } = await admin
      .from('plans').select('price_id').eq('plan', plan).eq('active', true).maybeSingle();
    if (planErr) return json({ error: `plans lookup failed: ${planErr.message}` }, 500);
    if (!planRow) return json({ error: 'plan unavailable' }, 400);

    // Look up any existing subscription row. Block a SECOND checkout if they're
    // genuinely subscribed (active/trialing/past_due) — they should manage/repair via
    // the Portal, not create a duplicate Stripe subscription. Canceled / incomplete /
    // none may (re)subscribe (and reuse their stable stripe_customer_id below).
    // A failed lookup must 500 — never risk minting a duplicate customer.
    const { data: existing, error: existingErr } = await admin
      .from('subscriptions')
      .select('stripe_customer_id, status, stripe_subscription_id')
      .eq('user_id', caller.userId)
      .maybeSingle();
    if (existingErr) return json({ error: 'subscription lookup failed' }, 500);
    if (existing && ['active', 'trialing', 'past_due'].includes(existing.status)) {
      return json({ error: 'already_subscribed' }, 409);
    }

    // Deterministic idempotency key so two rapid clicks / two tabs collapse to ONE Checkout session:
    // a truly-concurrent second create with the same key gets Stripe's idempotency_key_in_use 409 (→ we
    // return 'checkout_in_progress'); a slightly-later repeat gets the SAME session back. One session ⇒
    // one customer ⇒ no double charge. Derived from the state we already read above — on a first-ever
    // subscribe both concurrent requests observe no row → identical key. It changes once a row exists
    // (different sub id/status), so a later legitimate resubscribe still mints a fresh session. (#10)
    const idempotencyKey =
      `checkout:${caller.userId}:${plan}:${existing?.stripe_subscription_id ?? 'none'}:${existing?.status ?? 'none'}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: planRow.price_id, quantity: 1 }],
      client_reference_id: caller.userId,
      // Reuse the stable customer if present; else Stripe auto-creates one in
      // subscription mode. customer_email prefills it and helps Stripe dedupe
      // repeat pre-subscription attempts (no customer_creation — invalid here).
      ...(existing?.stripe_customer_id
        ? { customer: existing.stripe_customer_id }
        : { customer_email: caller.email ?? undefined }),
      subscription_data: {
        metadata: { supabase_user_id: caller.userId },
        ...(TRIAL.enabled ? { trial_period_days: TRIAL.days } : {}),
      },
      success_url: RETURN_URLS.checkoutSuccess,
      cancel_url: RETURN_URLS.checkoutCancel,
    }, { idempotencyKey });

    return json({ url: session.url }, 200);
  } catch (e) {
    if (e instanceof Response) return e;
    // Two truly-concurrent checkouts sharing the idempotency key: Stripe 409s the loser while the first
    // is in flight. That's the double-click guard doing its job — tell the client it's already going.
    if (e && typeof e === 'object' && (e as { statusCode?: number }).statusCode === 409) {
      return json({ error: 'checkout_in_progress' }, 409);
    }
    console.error('create-checkout error', e);
    return json({ error: 'checkout failed' }, 500);
  }
});
