// create-portal — open the Stripe Customer Portal for the signed-in user. The Portal (configured with Pro
// + Max as switchable products) handles upgrade/downgrade with proration, cancel, update-card, and
// invoices — no custom code.
//
// Optional `flow` deep-links straight to the exact action via Stripe flow_data, so the user is never
// dumped on the Portal home to hunt for a button:
//   'cancel'      → the cancel confirmation (used by the P2 delete gate + the Cancel-plan button).
//   'update_card' → the payment-method update (the past_due "update your card" CTA).
//   'switch'      → confirm switching to `plan` (Pro⇄Max) — needs the sub's item id + the target price.
// The 'switch' flow requires the Portal's "Customers can switch plans" config to be enabled (a manual
// Stripe Dashboard step); 'cancel' + 'update_card' work without it.
import Stripe from 'npm:stripe@17';
import { requireUser } from '../_shared/auth.ts';
import { admin } from '../_shared/supabaseAdmin.ts';
import { stripe } from '../_shared/stripe.ts';
import { RETURN_URLS, type PlanId } from '../_shared/config.ts';
import { corsHeaders, json } from '../_shared/cors.ts';

type PortalFlow = 'cancel' | 'update_card' | 'switch';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const caller = await requireUser(req);
    const { flow, plan } = (await req.json().catch(() => ({}))) as { flow?: PortalFlow; plan?: PlanId };
    const { data: sub, error: subErr } = await admin
      .from('subscriptions').select('stripe_customer_id, stripe_subscription_id')
      .eq('user_id', caller.userId).maybeSingle();
    if (subErr) return json({ error: 'subscription lookup failed' }, 500);
    if (!sub?.stripe_customer_id) return json({ error: 'no subscription' }, 404);

    const returnUrl = RETURN_URLS.portalReturn;
    const redirect = { after_completion: { type: 'redirect', redirect: { return_url: returnUrl } } } as const;
    const params: Stripe.BillingPortal.SessionCreateParams = { customer: sub.stripe_customer_id, return_url: returnUrl };

    if (flow === 'cancel') {
      // Deep-link directly to the cancellation flow (hides the rest of the Portal). Requires the sub id.
      if (!sub.stripe_subscription_id) console.warn('create-portal: cancel flow requested but no stripe_subscription_id');
      else params.flow_data = { type: 'subscription_cancel', subscription_cancel: { subscription: sub.stripe_subscription_id }, ...redirect };
    } else if (flow === 'update_card') {
      // Deep-link straight to the payment-method update (past-due card fix). No sub id / config needed.
      params.flow_data = { type: 'payment_method_update', ...redirect };
    } else if (flow === 'switch') {
      // Deep-link straight to a confirm-this-switch screen for the target plan. Needs the sub's item id +
      // the target price (from the plans table — the price SSOT, mirrors create-checkout).
      if (plan !== 'pro' && plan !== 'max') return json({ error: 'unknown plan' }, 400);
      if (!sub.stripe_subscription_id) {
        console.warn('create-portal: switch flow requested but no stripe_subscription_id');
      } else {
        const { data: planRow, error: planErr } = await admin
          .from('plans').select('price_id').eq('plan', plan).eq('active', true).maybeSingle();
        if (planErr) return json({ error: 'plans lookup failed' }, 500);
        if (!planRow) return json({ error: 'plan unavailable' }, 400);
        const live = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
        const itemId = live.items.data[0]?.id;
        if (!itemId) return json({ error: 'no subscription item' }, 500);
        params.flow_data = {
          type: 'subscription_update_confirm',
          subscription_update_confirm: {
            subscription: sub.stripe_subscription_id,
            items: [{ id: itemId, price: planRow.price_id, quantity: 1 }],
          },
          ...redirect,
        };
      }
    }

    const session = await stripe.billingPortal.sessions.create(params);
    return json({ url: session.url }, 200);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('create-portal error', e);
    return json({ error: 'portal failed' }, 500);
  }
});
