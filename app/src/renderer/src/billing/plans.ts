import type { PlanId } from '@shared/ipc'

/**
 * Client-side plan DISPLAY config — the single source for tier name, price label, tagline, and ordering.
 *
 * WHY this lives client-side: the `plans` table stores only `plan` + `price_id` + `allowance_cents` — NO
 * display price, currency, or tier rank. So the renderer owns the human-facing numbers, and Stripe's
 * hosted Checkout page shows the authoritative price as the backstop. The `priceLabel`s mirror the Stripe
 * prices — this constant is the one place the client shows a dollar amount.
 */
export interface PlanDisplay {
  id: PlanId
  /** Human tier name shown in the pill / picker / paywall. */
  name: string
  /** §G-1 placeholder — the price shown on the picker card (Stripe Checkout shows the real charge). */
  priceLabel: string
  /** One-line value prop for the picker card. */
  tagline: string
  /** 2–4 value bullets for the fullscreen-paywall card. */
  highlights: string[]
}

/** Ordered low → high (index = tier rank), so `higherPlan`/`lowerPlan`/`planRank` work off the position. */
export const PLANS: readonly PlanDisplay[] = [
  {
    id: 'pro',
    name: 'Pro',
    priceLabel: '$29/mo',
    tagline: 'For regular editing work.',
    highlights: ['Enough usage for steady, regular editing', 'Every Cubic tool in After Effects', 'Cancel anytime'],
  },
  {
    id: 'max',
    name: 'Max',
    priceLabel: '$89/mo',
    tagline: 'For heavy, all-day use.',
    highlights: ['Over 3x the monthly usage of Pro', 'Best for heavy, all-day motion work', 'Cancel anytime'],
  },
] as const

/** The display record for a plan id, or undefined for an unknown/unmapped plan. */
export function planDisplay(id: string | null): PlanDisplay | undefined {
  return PLANS.find((p) => p.id === id)
}

/** Human tier name ('Pro'/'Max'); falls back to 'Cubic' for an unknown/absent plan. */
export function planDisplayName(id: string | null): string {
  return planDisplay(id)?.name ?? 'Cubic'
}

/** Tier rank (index in PLANS, low → high); -1 for an unknown/absent plan. Compare two ranks to tell an
 *  upgrade from a downgrade. */
export function planRank(plan: string | null): number {
  return PLANS.findIndex((p) => p.id === plan)
}

/** The next tier up from `plan` (for the over-cap "Upgrade to …" path), or null if already top / unknown.
 *  Two tiers today: pro → max, max → null. */
export function higherPlan(plan: string | null): PlanId | null {
  const idx = planRank(plan)
  if (idx < 0) return null
  return PLANS[idx + 1]?.id ?? null
}

/** The next tier down from `plan` (for the "Downgrade to …" path), or null if already lowest / unknown. */
export function lowerPlan(plan: string | null): PlanId | null {
  const idx = planRank(plan)
  if (idx <= 0) return null
  return PLANS[idx - 1]?.id ?? null
}
