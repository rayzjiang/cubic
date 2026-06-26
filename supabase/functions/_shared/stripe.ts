// Single Stripe client for all functions. Hand-pinned API version so webhook
// payload shapes are stable. Deno fetch HTTP client (no Node http).
import Stripe from 'npm:stripe@17';

// apiVersion pinned to the stripe@17 SDK's built-in version. On this version the
// billing period is on the subscription object; on later ("basil") versions it
// moves to the subscription item — periodOf() in the webhook reads both, so a
// future SDK bump won't break the period mapping.
export const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2025-02-24.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});
