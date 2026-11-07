// ════════════════════════════════════════════════════════════════════════════
// Billing config that is NOT the allowance/price map. The price_id -> allowance
// single source of truth lives in the `plans` TABLE (read by get_entitlement and
// create-checkout) — deliberately NOT mirrored here, so nothing drifts.
//
// This file holds only: the trial toggle, the dunning expectation (documenting
// the Stripe-dashboard setting), and the cubic:// return URLs.
//   ⚠️ LOCK trial/number decisions at launch gate §G-1.
// ════════════════════════════════════════════════════════════════════════════

// Trial: trial-agnostic, DEFAULT OFF (no free tier — everyone paid day 1). Flip
// `enabled` to true to turn on a card-up-front trial; `capCents` is the smaller
// trial allowance the Wave-2 meter would apply while status='trialing'.
export const TRIAL = {
  enabled: false, // SHIP OFF
  days: 7,
  capCents: 5_000, // trial cost budget in cost-cents (unused while OFF)
} as const;

// Dunning expectation — the actual schedule is configured in the Stripe dashboard
// (Billing -> automatic collection). We document it here: fail fast, retry within
// ~24h, then cancel. While past_due the user keeps access (grace); once Stripe
// gives up and flips to canceled/unpaid, get_entitlement() blocks them.
export const DUNNING = { failFast: true, retryWindowHours: 24 } as const;

// Checkout / Portal return targets. WT-AUTH owns the cubic:// deep-link handler;
// we only name the return URLs here.
export const RETURN_URLS = {
  checkoutSuccess: 'cubic://billing/success',
  checkoutCancel: 'cubic://billing/cancel',
  portalReturn: 'cubic://billing/portal-return',
} as const;

export type PlanId = 'pro' | 'max';
