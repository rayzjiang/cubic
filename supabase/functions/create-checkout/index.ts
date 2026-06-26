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

    // Reuse the user's existing Stripe customer if they've subscribed before
    // (the never-deleted subscriptions row keeps stripe_customer_id across cancel).
    const { data: existing } = await admin
      .from('subscriptions').select('stripe_customer_id').eq('user_id', caller.userId).maybeSingle();

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
    });

    return json({ url: session.url }, 200);
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: String(e) }, 500);
  }
});
