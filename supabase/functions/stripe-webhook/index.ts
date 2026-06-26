// stripe-webhook — THE ONLY WRITER of paid-state. Verifies the Stripe signature and
// applies authoritative customer.subscription.* events via the apply_subscription RPC.
//
// Idempotency + ordering: apply_subscription is a guarded upsert keyed on user_id that
// IGNORES events older than the last applied (by Stripe event time), so duplicate or
// out-of-order deliveries are harmless — no separate dedup table needed.
//
// Single-writer discipline: only customer.subscription.created|updated|deleted map
// into `subscriptions`. invoice.* and checkout.session.completed are acknowledged but
// no-op — every status/period transition they imply also arrives as a subscription.updated.
import Stripe from 'npm:stripe@17';
import { stripe } from '../_shared/stripe.ts';
import { admin } from '../_shared/supabaseAdmin.ts';

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

Deno.serve(async (req) => {
  // Fail closed: an empty secret would make constructEvent HMAC with an empty key,
  // turning a misconfigured deploy into a forgeable endpoint.
  if (!webhookSecret) {
    console.error('stripe-webhook: STRIPE_WEBHOOK_SECRET is not set');
    return new Response('server misconfigured', { status: 500 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) return new Response('missing signature', { status: 400 });

  const body = await req.text(); // raw body required for signature verification
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (e) {
    console.error('stripe-webhook: signature verification failed', e);
    return new Response('invalid signature', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await applySubscription(event.data.object as Stripe.Subscription, event.type, event.created);
        break;
      // Acknowledged, intentionally no-op (the paired subscription.updated is the
      // authoritative writer). Kept for observability / future ledger.
      case 'checkout.session.completed':
      case 'invoice.paid':
      case 'invoice.payment_failed':
        break;
    }
  } catch (e) {
    // Return 500 so Stripe retries; the RPC is idempotent + order-guarded, so a retry
    // is safe. Detail stays server-side; the caller gets a generic message.
    console.error(`stripe-webhook: handler error on ${event.type}`, e);
    return new Response('handler error', { status: 500 });
  }

  return new Response('ok', { status: 200 });
});

async function applySubscription(
  sub: Stripe.Subscription,
  eventType: string,
  eventCreated: number,
): Promise<void> {
  const userId = await resolveUserId(sub);
  const item = sub.items.data[0];
  const priceId = item.price.id;

  // Map price_id -> plan via the plans SSOT. A FAILED query must NOT silently become
  // 'unknown' (that would block a paying user) -> throw and let Stripe retry. Only a
  // clean zero-row result means a genuinely unrecognized price.
  const { data: planRow, error: planErr } = await admin
    .from('plans').select('plan').eq('price_id', priceId).maybeSingle();
  if (planErr) throw new Error(`plans lookup failed: ${planErr.message}`);

  const period = periodOf(sub, item);

  // subscription.deleted is terminal -> force canceled regardless of the object status.
  const status = eventType === 'customer.subscription.deleted' ? 'canceled' : sub.status;

  // Guarded atomic upsert: ignores out-of-order events older than the stored
  // last_event_at, so a stale 'active' can't resurrect a 'canceled' row.
  const { error } = await admin.rpc('apply_subscription', {
    p_user_id: userId,
    p_stripe_subscription_id: sub.id,
    p_stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    p_status: status,
    p_price_id: priceId,
    p_plan: planRow?.plan ?? 'unknown',
    p_current_period_start: period.start,
    p_current_period_end: period.end,
    p_cancel_at_period_end: sub.cancel_at_period_end,
    p_event_at: new Date(eventCreated * 1000).toISOString(),
  });
  if (error) throw new Error(`apply_subscription failed: ${error.message}`);
}

// Resolve the Supabase user. We set subscription metadata at checkout, so it's
// present for our flow; fall back to the existing row by customer id.
async function resolveUserId(sub: Stripe.Subscription): Promise<string> {
  const fromMeta = sub.metadata?.supabase_user_id;
  if (fromMeta) return fromMeta;

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const { data } = await admin
    .from('subscriptions').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
  if (data?.user_id) return data.user_id;

  throw new Error(`cannot resolve supabase user for subscription ${sub.id}`);
}

// Billing period. In the 2025-03-31 (basil) API the period moved to the
// subscription ITEM; older payloads carry it on the subscription. Read item first,
// fall back to the subscription, so this is robust across versions.
function periodOf(
  sub: Stripe.Subscription,
  item: Stripe.SubscriptionItem,
): { start: string; end: string } {
  const start = (item as { current_period_start?: number }).current_period_start
    ?? (sub as unknown as { current_period_start?: number }).current_period_start;
  const end = (item as { current_period_end?: number }).current_period_end
    ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  if (start == null || end == null) {
    throw new Error(`subscription ${sub.id} missing billing period`);
  }
  return { start: new Date(start * 1000).toISOString(), end: new Date(end * 1000).toISOString() };
}
