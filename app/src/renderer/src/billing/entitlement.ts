import type { BillingState, Entitlement, PlanId, SubscriptionStatus } from '@shared/ipc'
import { higherPlan, planDisplayName, planRank } from './plans'

/**
 * Entitlement DISPLAY derivations — the single home for turning a `BillingState` into what the UI shows
 * (plan pill, usage bar, paywall). The `paywallReason` mapping intentionally mirrors the proxy's own
 * reason derivation (proxy/src/index.ts) so the proactive display path and the reactive 402 agree.
 *
 * The blocking PRESENTATION (full-takeover vs in-context) is NOT decided here — that's the chat-count
 * rule in App.tsx. `reason` only drives copy/CTA.
 */

export type PaywallReason = 'no_plan' | 'over_cap' | 'past_due'

/** Is this user currently blocked from sending? Only true once billing is `ready` with a real row that
 *  isn't entitled. `loading`/`unavailable` (local dev) and signed-out (null entitlement) are never blocked. */
export function isBlocked(billing: BillingState): boolean {
  return billing.status === 'ready' && !!billing.entitlement && !billing.entitlement.entitled
}

/** Why a blocked user is blocked — mirrors the proxy: past_due → 'past_due'; active/trialing (so, over
 *  cap) → 'over_cap'; anything else (canceled/unpaid/incomplete/paused/no row) → 'no_plan'. Null when not
 *  blocked. */
export function paywallReason(ent: Entitlement | null): PaywallReason | null {
  if (!ent || ent.entitled) return null
  if (ent.status === 'past_due') return 'past_due'
  if (ent.status === 'active' || ent.status === 'trialing') return 'over_cap'
  return 'no_plan'
}

/** Live subscription statuses that must be cancelled before the account can be deleted (P2 gate). A sub
 *  that is already scheduled to cancel (`cancel_at_period_end`) is NOT blocking — Cubic unlocks delete
 *  the same day (see `canDeleteAccount`). */
const DELETE_BLOCKING_STATUSES: ReadonlySet<SubscriptionStatus> = new Set<SubscriptionStatus>([
  'active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete',
])

/** P2 account-delete gate (Claude-style "cancel before delete"): may the signed-in user delete their
 *  account right now? FALSE while a live sub is still running and NOT yet scheduled to cancel — they must
 *  cancel it first. TRUE once cancellation is scheduled (`cancelAtPeriodEnd`), the sub is terminal
 *  (canceled / incomplete_expired), there was never a sub, or billing is unavailable on this build.
 *  (Loading → false: don't offer delete until we actually know the sub state.) */
export function canDeleteAccount(billing: BillingState): boolean {
  if (billing.status === 'unavailable') return true // no billing on this build → nothing to cancel
  if (billing.status !== 'ready') return false // still loading → hold until we know
  const ent = billing.entitlement
  if (!ent || !ent.status) return true // never subscribed (no row / all-null)
  if (ent.cancelAtPeriodEnd) return true // cancellation already scheduled → unlock same-day
  return !DELETE_BLOCKING_STATUSES.has(ent.status)
}

/** Statuses whose Stripe customer has a live/recoverable subscription manageable in the Portal (switch /
 *  cancel / update card). Everything else (canceled / incomplete / null) has no manageable sub → the
 *  Checkout path instead. Shared by the paywall cards + Settings (single source). */
export const PORTAL_MANAGEABLE: ReadonlySet<SubscriptionStatus> = new Set<SubscriptionStatus>([
  'active', 'trialing', 'past_due', 'unpaid', 'paused',
])

/** Does the user have a live/recoverable Stripe subscription (i.e. Portal-manageable)? */
export function hasManageableSub(ent: Entitlement | null): boolean {
  return !!ent?.status && PORTAL_MANAGEABLE.has(ent.status)
}

/** The CTA for a given plan card on the fullscreen paywall, contextual to the user's current sub:
 *  - 'current' — this IS their current plan (button disabled).
 *  - 'switch'  — they have a manageable sub on a DIFFERENT tier → openPortal('switch', plan) (one-click
 *    Stripe confirm); label reads Upgrade/Downgrade by rank.
 *  - 'checkout'— no manageable sub (never subscribed / canceled) → openCheckout(plan) (first sub). */
export interface PlanCardCta {
  label: string
  action: 'current' | 'switch' | 'checkout'
}
export function planCardCta(ent: Entitlement | null, plan: PlanId): PlanCardCta {
  if (hasManageableSub(ent)) {
    if (ent!.plan === plan) return { label: 'Current plan', action: 'current' }
    const isUpgrade = planRank(plan) > planRank(ent!.plan)
    return { label: `${isUpgrade ? 'Upgrade' : 'Downgrade'} to ${planDisplayName(plan)}`, action: 'switch' }
  }
  return { label: `Choose ${planDisplayName(plan)}`, action: 'checkout' }
}

/** Usage as a whole-number percent of the monthly allowance, rounded UP so any non-zero spend shows ≥1%
 *  (never a misleading 0% when you've actually used something), clamped to [0,100] (over-cap reads 100). */
export function usagePercent(ent: Entitlement | null): number {
  if (!ent || ent.allowanceCents <= 0) return 0
  return Math.min(100, Math.max(0, Math.ceil((ent.spentCents / ent.allowanceCents) * 100)))
}

/** The billing-cycle reset as a friendly date ("Aug 9") from `period_end` (the real Stripe anchor, NOT a
 *  fake midnight). Empty string when unknown/unparseable. */
export function friendlyReset(periodEnd: string | null): string {
  if (!periodEnd) return ''
  const d = new Date(periodEnd)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Friendly toast copy for an openCheckout/openPortal failure code (shared by Settings + the paywall). */
export function billingActionErrorCopy(error: string | undefined): string {
  if (error === 'no_subscription') return "You don't have a subscription to manage yet."
  if (error === 'already_subscribed') return "You're already subscribed."
  if (error === 'unavailable') return 'Billing isn’t available on this build.'
  return "Couldn't open that just now — try again in a moment."
}

/** The account-menu plan pill text (§D-5). '' while loading/unavailable so the widget can hide the line. */
export function planPillText(billing: BillingState): string {
  const ent = billing.entitlement
  if (billing.status !== 'ready' || !ent) return ''
  const name = planDisplayName(ent.plan)
  const s = ent.status
  if (s === 'active' || s === 'trialing') return ent.entitled ? `${name} plan` : `${name} — limit reached`
  if (s === 'past_due' || s === 'unpaid') return 'Payment failed'
  if (s === 'canceled') return 'Canceled'
  if (s === 'paused') return 'Paused'
  return 'No plan' // incomplete / incomplete_expired / null (never subscribed)
}

/** The primary CTA a paywall offers. 'picker' = open the two-tier plan chooser → Checkout (no active
 *  sub); 'portal' = open the Stripe Customer Portal (active sub: over-cap upgrade / past-due card fix).
 *  null = no action (a capped top-tier user just waits for the reset). */
export interface PaywallCopy {
  title: string
  body: string
  /** 'picker' opens the fullscreen plan chooser; 'portal' opens the Stripe Portal deep-linked to
   *  `portalFlow` ('update_card' for past_due, 'switch' to `portalPlan` for an over-cap upgrade). */
  cta: { label: string; action: 'picker' | 'portal'; portalFlow?: 'update_card' | 'switch'; portalPlan?: PlanId } | null
  /** Friendly reset date when relevant (over-cap), for the caller to render inline. */
  resetDate?: string
}

/** Reason → copy + CTA (§D-2/§D-3, decision #7). Functional-minimal wording — P3's copy pass finalizes. */
export function paywallCopy(ent: Entitlement): PaywallCopy {
  const reason = paywallReason(ent)
  const reset = friendlyReset(ent.periodEnd)

  if (reason === 'past_due') {
    return {
      title: 'Payment failed',
      body: "Your last payment didn't go through. Update your card to keep using Cubic.",
      cta: { label: 'Update payment', action: 'portal', portalFlow: 'update_card' },
    }
  }

  if (reason === 'over_cap') {
    const up = higherPlan(ent.plan)
    if (up) {
      return {
        title: "You've hit this month's limit",
        body: `You're out of usage${reset ? ` until ${reset}` : ' for this cycle'}. Upgrade to ${planDisplayName(up)} for more.`,
        cta: { label: `Upgrade to ${planDisplayName(up)}`, action: 'portal', portalFlow: 'switch', portalPlan: up },
        resetDate: reset,
      }
    }
    return {
      title: "You've hit this month's limit",
      body: `You're on the top plan — your usage resets${reset ? ` ${reset}` : ' next cycle'}.`,
      cta: null,
      resetDate: reset,
    }
  }

  // no_plan — never subscribed, or a terminal status (canceled/unpaid/incomplete/paused). A canceled user
  // still has a Stripe customer, but a fresh Checkout is the cleaner resubscribe path (not blocked by the
  // create-checkout "already_subscribed" guard, which only trips on active/trialing/past_due).
  const canceled = ent.status === 'canceled'
  return {
    title: canceled ? 'Your subscription was canceled' : 'Subscribe to start using Cubic',
    body: canceled ? 'Resubscribe to keep creating with Cubic.' : 'Choose a plan to start creating with Cubic.',
    cta: { label: canceled ? 'Resubscribe' : 'Choose a plan', action: 'picker' },
  }
}
