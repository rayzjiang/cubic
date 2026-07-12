// create-portal — open the Stripe Customer Portal for the signed-in user. The
// Portal (configured with Pro + Max as switchable products) handles upgrade/
// downgrade with proration, cancel, update-card, and invoices — no custom code.
//
// Optional { flow: 'cancel' } deep-links straight to the cancel confirmation via Stripe flow_data,
// so the user isn't dumped on the Portal home to hunt for cancel (used by the P2 delete gate).
import Stripe from 'npm:stripe@17';
import { requireUser } from '../_shared/auth.ts';
import { admin } from '../_shared/supabaseAdmin.ts';
import { stripe } from '../_shared/stripe.ts';
import { RETURN_URLS } from '../_shared/config.ts';
import { corsHeaders, json } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const caller = await requireUser(req);
    const { flow } = (await req.json().catch(() => ({}))) as { flow?: 'cancel' };
    const { data: sub, error: subErr } = await admin
      .from('subscriptions').select('stripe_customer_id, stripe_subscription_id')
      .eq('user_id', caller.userId).maybeSingle();
    if (subErr) return json({ error: 'subscription lookup failed' }, 500);
    if (!sub?.stripe_customer_id) return json({ error: 'no subscription' }, 404);

    const params: Stripe.BillingPortal.SessionCreateParams = {
      customer: sub.stripe_customer_id,
      return_url: RETURN_URLS.portalReturn,
    };
    // Deep-link directly to the cancellation flow (hides the rest of the Portal). Requires the sub id.
    if (flow === 'cancel' && sub.stripe_subscription_id) {
      params.flow_data = {
        type: 'subscription_cancel',
        subscription_cancel: { subscription: sub.stripe_subscription_id },
        after_completion: { type: 'redirect', redirect: { return_url: RETURN_URLS.portalReturn } },
      };
    }

    const session = await stripe.billingPortal.sessions.create(params);

    return json({ url: session.url }, 200);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('create-portal error', e);
    return json({ error: 'portal failed' }, 500);
  }
});
