// billing-details — read-only billing data for the Settings → Billing tab: the customer's default card
// (brand + last4) and their recent invoices. Mirrors create-portal's auth + customer lookup, but returns
// JSON data instead of opening a browser flow. The renderer never touches Stripe — main calls this with
// the user's JWT and hands the shape to the Billing tab (payment row + invoice table). Nothing is written.
import Stripe from 'npm:stripe@17';
import { requireUser } from '../_shared/auth.ts';
import { admin } from '../_shared/supabaseAdmin.ts';
import { stripe } from '../_shared/stripe.ts';
import { corsHeaders, json } from '../_shared/cors.ts';

interface InvoiceOut {
  id: string;
  number: string | null;
  created: number; // unix seconds
  dueDate: number | null; // unix seconds
  total: number; // cents
  currency: string;
  status: string | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
}

/** Pull { brand, last4 } off an expanded payment-method object; null for anything non-card / unexpanded. */
function cardOf(pm: string | Stripe.PaymentMethod | null | undefined): { brand: string; last4: string } | null {
  if (!pm || typeof pm === 'string' || !pm.card) return null;
  return { brand: pm.card.brand, last4: pm.card.last4 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const caller = await requireUser(req);
    const { data: sub, error: subErr } = await admin
      .from('subscriptions').select('stripe_customer_id, stripe_subscription_id')
      .eq('user_id', caller.userId).maybeSingle();
    if (subErr) return json({ error: 'subscription lookup failed' }, 500);
    // No Stripe customer yet (never subscribed) → nothing to show; the tab renders its Subscribe state.
    if (!sub?.stripe_customer_id) return json({ paymentMethod: null, invoices: [] }, 200);

    // Default card: prefer the subscription's own default PM; fall back to the customer's invoice-settings
    // default. Both need expanding to read the card off the object.
    let paymentMethod: { brand: string; last4: string } | null = null;
    if (sub.stripe_subscription_id) {
      const liveSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id, {
        expand: ['default_payment_method'],
      });
      paymentMethod = cardOf(liveSub.default_payment_method);
    }
    if (!paymentMethod) {
      const customer = await stripe.customers.retrieve(sub.stripe_customer_id, {
        expand: ['invoice_settings.default_payment_method'],
      });
      if (!customer.deleted) paymentMethod = cardOf(customer.invoice_settings?.default_payment_method);
    }

    const list = await stripe.invoices.list({ customer: sub.stripe_customer_id, limit: 24 });
    const invoices: InvoiceOut[] = list.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      created: inv.created,
      dueDate: inv.due_date,
      total: inv.total,
      currency: inv.currency,
      status: inv.status,
      hostedUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: inv.invoice_pdf ?? null,
    }));

    return json({ paymentMethod, invoices }, 200);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('billing-details error', e);
    return json({ error: 'billing details failed' }, 500);
  }
});
