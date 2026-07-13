// delete-account — permanently delete the signed-in user's account. DESTRUCTIVE + irreversible.
//
// Ordering is safety-critical: CANCEL the Stripe subscription BEFORE deleting the Supabase user.
// Deleting the user alone does NOT stop billing — the subscriptions row cascades away (FK ON DELETE
// CASCADE) but the real Stripe subscription keeps charging a ghost. So we stop billing authoritatively
// first and FAIL CLOSED (abort before deleting) on any uncertainty, then delete the auth user, which
// cascade-clears `subscriptions` + `usage`.
//
// The client only reaches here after its own Claude-style gate (user must cancel first); this function
// is the backend authority + a defensive immediate cancel of whatever remains.
import { requireUser } from '../_shared/auth.ts';
import { admin } from '../_shared/supabaseAdmin.ts';
import { stripe } from '../_shared/stripe.ts';
import { corsHeaders, json } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const caller = await requireUser(req);

    // The user's subscription row (PK user_id). Null = never subscribed → nothing to cancel.
    const { data: sub, error: subErr } = await admin
      .from('subscriptions')
      .select('stripe_subscription_id, status')
      .eq('user_id', caller.userId)
      .maybeSingle();
    if (subErr) return json({ error: 'subscription lookup failed' }, 500);

    // 1) Stop billing FIRST. Retrieve the live Stripe state (authoritative — our row can be stale), and
    //    cancel immediately unless it's already terminal. Mirrors stripe-webhook's cancel call.
    if (sub?.stripe_subscription_id) {
      try {
        const live = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
        if (live.status !== 'canceled' && live.status !== 'incomplete_expired') {
          await stripe.subscriptions.cancel(sub.stripe_subscription_id);
        }
      } catch (e) {
        // A subscription that no longer exists at Stripe (resource_missing) means there is nothing left
        // to bill → safe to proceed. Any OTHER error means we could NOT guarantee billing is stopped →
        // ABORT before deleting the user (deleting first would orphan a live sub billing a ghost).
        if ((e as { code?: string })?.code !== 'resource_missing') {
          console.error('delete-account: could not stop Stripe subscription for', caller.userId, e);
          return json({ error: 'cancel_failed' }, 502);
        }
      }
    }

    // 2) Delete the auth user. ON DELETE CASCADE clears `subscriptions` + `usage`. A late
    //    customer.subscription.* webhook after this is absorbed by the webhook's deleted-user no-op.
    const { error: delErr } = await admin.auth.admin.deleteUser(caller.userId);
    if (delErr) {
      // Billing is already stopped (step 1). The user still exists → they can retry; no ghost billing.
      console.error('delete-account: deleteUser failed for', caller.userId, delErr);
      return json({ error: 'delete_failed' }, 500);
    }

    return json({ ok: true }, 200);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('delete-account error', e);
    return json({ error: 'delete_failed' }, 500);
  }
});
