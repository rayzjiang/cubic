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

  // #10 double-checkout backstop. If we already track a DIFFERENT, live subscription for this user, the
  // incoming one is a duplicate from a checkout race — never let its events touch our canonical row. On
  // the duplicate's 'created' event, cancel + refund it at Stripe so the user isn't double-charged. (A
  // legitimate resubscribe is safe: the stored row would be canceled/expired — not live — so this is
  // skipped. The duplicate's own later 'deleted' event also lands here and is skipped, so our kept row
  // is never clobbered.)
  const { data: current } = await admin
    .from('subscriptions').select('stripe_subscription_id, status').eq('user_id', userId).maybeSingle();
  if (current && current.stripe_subscription_id !== sub.id
      && ['active', 'trialing', 'past_due'].includes(current.status)) {
    if (eventType === 'customer.subscription.created') {
      console.error(`stripe-webhook: DUPLICATE subscription ${sub.id} for user ${userId} — already has ` +
        `live ${current.stripe_subscription_id}; canceling + refunding the duplicate (checkout race).`);
      await cancelAndRefundDuplicate(sub.id);
    }
    return; // ignore every event for a non-canonical (duplicate/foreign) subscription
  }

  // Map price_id -> plan via the plans SSOT. A FAILED query must NOT silently become 'unknown' (that
  // would block a paying user) -> throw and let Stripe retry. A clean zero-row result is a genuinely
  // unrecognized price: apply it anyway (plan='unknown' -> allowance 0 -> that one user blocked; the
  // price_id FK was dropped in 20260705000001 so this no longer 500-loops + freezes ALL billing) but LOG
  // loudly so the mispricing is visible and fixable (seed the price in `plans` to restore that cohort).
  const { data: planRow, error: planErr } = await admin
    .from('plans').select('plan').eq('price_id', priceId).maybeSingle();
  if (planErr) throw new Error(`plans lookup failed: ${planErr.message}`);
  if (!planRow) {
    console.error(`stripe-webhook: UNKNOWN price ${priceId} on subscription ${sub.id} (user ${userId}) — ` +
      `not in the plans table; applying with plan='unknown' (allowance 0 -> user blocked). Seed the price ` +
      `in plans to restore access.`);
  }

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

// #10 backstop helper: cancel a duplicate subscription at Stripe and best-effort refund its initial
// charge, so a checkout race never leaves a user double-billed. The cancel is reliable (stops all future
// charges); the refund is best-effort (the Stripe invoice→payment shape varies by API version) and logs
// the ids on failure for a one-click manual refund. NEVER throws — a backstop failure must not 500 the
// webhook (which would make Stripe retry the whole event).
async function cancelAndRefundDuplicate(subscriptionId: string): Promise<void> {
  try {
    const canceled = await stripe.subscriptions.cancel(subscriptionId);
    const invoiceId = typeof canceled.latest_invoice === 'string'
      ? canceled.latest_invoice
      : canceled.latest_invoice?.id;
    if (!invoiceId) return;
    const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ['payment_intent'] });
    const pi = (invoice as unknown as { payment_intent?: string | { id?: string } }).payment_intent;
    const paymentIntentId = typeof pi === 'string' ? pi : pi?.id;
    if (paymentIntentId) {
      await stripe.refunds.create({ payment_intent: paymentIntentId });
    } else {
      console.error(`stripe-webhook: canceled duplicate ${subscriptionId} but found no payment_intent on ` +
        `invoice ${invoiceId} to refund — refund it manually if it was charged.`);
    }
  } catch (e) {
    console.error(`stripe-webhook: failed to cancel/refund duplicate subscription ${subscriptionId} — do ` +
      `it manually from the Stripe dashboard.`, e);
  }
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
