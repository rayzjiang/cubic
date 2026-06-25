// stripe-webhook — THE ONLY WRITER of paid-state. Verifies the Stripe signature,
// dedupes by event id (exactly-once), and upserts the subscriptions row from the
// authoritative customer.subscription.* events.
//
// Single-writer discipline: only the customer.subscription.created|updated|deleted
// events map fields into `subscriptions`. invoice.* and checkout.session.completed
// are acknowledged but no-op — every status/period transition they imply is also
// delivered as a customer.subscription.updated, so routing all writes through that
// one path avoids double-write races.
import Stripe from 'npm:stripe@17';
import { stripe } from '../_shared/stripe.ts';
import { admin } from '../_shared/supabaseAdmin.ts';

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  if (!sig) return new Response('missing signature', { status: 400 });

  const body = await req.text(); // raw body required for signature verification
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (e) {
    return new Response(`signature error: ${e}`, { status: 400 });
  }

  // Idempotency: first writer wins. A duplicate delivery hits the PK and is skipped.
  const { error: dupErr } = await admin
    .from('processed_webhook_events').insert({ event_id: event.id });
  if (dupErr) return new Response('ok (duplicate)', { status: 200 });

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsertSubscription(event.data.object as Stripe.Subscription, event.type);
        break;
      }
      // Acknowledged, intentionally no-op (the paired subscription.updated is the
      // authoritative writer). Kept in the switch for observability / future ledger.
      case 'checkout.session.completed':
      case 'invoice.paid':
      case 'invoice.payment_failed':
        break;
    }
  } catch (e) {
    // Roll back the idempotency marker so Stripe's retry can reprocess this event.
    await admin.from('processed_webhook_events').delete().eq('event_id', event.id);
    return new Response(`handler error: ${e}`, { status: 500 });
  }

  return new Response('ok', { status: 200 });
});

async function upsertSubscription(sub: Stripe.Subscription, eventType: string): Promise<void> {
  const userId = await resolveUserId(sub);
  const item = sub.items.data[0];
  const priceId = item.price.id;

  // Map price_id -> plan via the plans SSOT (unknown price -> 'unknown', still stored).
  const { data: planRow } = await admin
    .from('plans').select('plan').eq('price_id', priceId).maybeSingle();

  const period = periodOf(sub, item);

  // subscription.deleted is terminal -> force canceled regardless of the object status.
  const status = eventType === 'customer.subscription.deleted' ? 'canceled' : sub.status;

  // Upsert on user_id (one user = one subscription). NEVER delete — a cancel keeps
  // the row (status=canceled) so stripe_customer_id survives for re-subscribe.
  const { error } = await admin.from('subscriptions').upsert({
    user_id: userId,
    stripe_subscription_id: sub.id,
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    status,
    price_id: priceId,
    plan: planRow?.plan ?? 'unknown',
    current_period_start: period.start,
    current_period_end: period.end,
    cancel_at_period_end: sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw new Error(`subscriptions upsert: ${error.message}`);
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
