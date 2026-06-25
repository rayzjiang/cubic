// create-portal — open the Stripe Customer Portal for the signed-in user. The
// Portal (configured with Pro + Max as switchable products) handles upgrade/
// downgrade with proration, cancel, update-card, and invoices — no custom code.
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
    const { data: sub } = await admin
      .from('subscriptions').select('stripe_customer_id').eq('user_id', caller.userId).maybeSingle();
    if (!sub?.stripe_customer_id) return json({ error: 'no subscription' }, 404);

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: RETURN_URLS.portalReturn,
    });

    return json({ url: session.url }, 200);
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: String(e) }, 500);
  }
});
