import type { PlanId } from '@shared/ipc'

/**
 * Client-side plan DISPLAY config — the single source for tier name, price label, tagline, and ordering.
 *
 * WHY this lives client-side: the `plans` table stores only `plan` + `price_id` + `allowance_cents` — NO
 * display price, currency, or tier rank. So the renderer owns the human-facing numbers, and Stripe's
 * hosted Checkout page shows the authoritative price as the backstop.
 *
 * ⚠️ §G-1 FINALIZE POINT: the `priceLabel`s below are SANDBOX placeholders (they mirror the seeded test
 * prices, Pro $29 / Max $89). When the real launch numbers are locked (§C-8/§G-1), update them HERE and
 * in Stripe — this constant is the one place the client shows a dollar amount.
 */
export interface PlanDisplay {
  id: PlanId
  /** Human tier name shown in the pill / picker / paywall. */
  name: string
  /** §G-1 placeholder — the price shown on the picker card (Stripe Checkout shows the real charge). */
  priceLabel: string
  /** One-line value prop for the picker card. */
  tagline: string
}

/** Ordered low → high (index = tier rank), so `higherPlan` can offer the next tier up. */
export const PLANS: readonly PlanDisplay[] = [
  { id: 'pro', name: 'Pro', priceLabel: '$29/mo', tagline: 'For regular editing work.' },
  { id: 'max', name: 'Max', priceLabel: '$89/mo', tagline: 'For heavy, all-day use.' },
] as const

/** The display record for a plan id, or undefined for an unknown/unmapped plan. */
export function planDisplay(id: string | null): PlanDisplay | undefined {
  return PLANS.find((p) => p.id === id)
}

/** Human tier name ('Pro'/'Max'); falls back to 'Cubic' for an unknown/absent plan. */
export function planDisplayName(id: string | null): string {
  return planDisplay(id)?.name ?? 'Cubic'
}

/** The next tier up from `plan` (for the over-cap "Upgrade to …" path), or null if already top / unknown.
 *  Two tiers today: pro → max, max → null. */
export function higherPlan(plan: string | null): PlanId | null {
  const idx = PLANS.findIndex((p) => p.id === plan)
  if (idx < 0) return null
  return PLANS[idx + 1]?.id ?? null
}
