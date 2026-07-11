import { describe, it, expect } from 'vitest'
import type { BillingState, Entitlement, SubscriptionStatus } from '@shared/ipc'
import {
  isBlocked,
  paywallReason,
  usagePercent,
  friendlyReset,
  planPillText,
  paywallCopy,
} from './entitlement'
import { higherPlan } from './plans'

// Build an Entitlement fixture; override only what a case cares about.
function ent(over: Partial<Entitlement> = {}): Entitlement {
  return {
    entitled: false,
    plan: null,
    priceId: null,
    allowanceCents: 1500,
    spentCents: 0,
    periodStart: null,
    periodEnd: null,
    status: null,
    ...over,
  }
}
const ready = (e: Entitlement | null): BillingState => ({ status: 'ready', entitlement: e, activating: false })

describe('paywallReason (mirrors the proxy)', () => {
  it('past_due → past_due', () => {
    expect(paywallReason(ent({ status: 'past_due' }))).toBe('past_due')
  })
  it('active/trialing but not entitled → over_cap', () => {
    expect(paywallReason(ent({ status: 'active', spentCents: 1600 }))).toBe('over_cap')
    expect(paywallReason(ent({ status: 'trialing' }))).toBe('over_cap')
  })
  it('canceled / null / other → no_plan', () => {
    expect(paywallReason(ent({ status: 'canceled' }))).toBe('no_plan')
    expect(paywallReason(ent({ status: null }))).toBe('no_plan')
    expect(paywallReason(ent({ status: 'unpaid' }))).toBe('no_plan')
  })
  it('entitled or null entitlement → null (not blocked)', () => {
    expect(paywallReason(ent({ entitled: true, status: 'active' }))).toBeNull()
    expect(paywallReason(null)).toBeNull()
  })
})

describe('isBlocked', () => {
  it('true only when ready + a real row that is not entitled', () => {
    expect(isBlocked(ready(ent({ status: 'canceled' })))).toBe(true)
    expect(isBlocked(ready(ent({ entitled: true, status: 'active' })))).toBe(false)
    expect(isBlocked(ready(null))).toBe(false)
    expect(isBlocked({ status: 'loading', entitlement: ent(), activating: false })).toBe(false)
    expect(isBlocked({ status: 'unavailable', entitlement: null, activating: false })).toBe(false)
  })
})

describe('usagePercent', () => {
  it('rounds and clamps to [0,100]', () => {
    expect(usagePercent(ent({ spentCents: 750, allowanceCents: 1500 }))).toBe(50)
    expect(usagePercent(ent({ spentCents: 1600, allowanceCents: 1500 }))).toBe(100) // over-cap clamps
    expect(usagePercent(ent({ spentCents: 100, allowanceCents: 0 }))).toBe(0) // no allowance → 0, no div-by-0
    expect(usagePercent(null)).toBe(0)
  })
})

describe('friendlyReset', () => {
  it('formats a valid ISO date, empty for null/garbage', () => {
    expect(friendlyReset('2026-08-09T12:00:00Z')).not.toBe('')
    expect(friendlyReset(null)).toBe('')
    expect(friendlyReset('not-a-date')).toBe('')
  })
})

describe('planPillText (decision #9)', () => {
  const cases: Array<[Partial<Entitlement>, string]> = [
    [{ entitled: true, status: 'active', plan: 'pro' }, 'Pro plan'],
    [{ entitled: true, status: 'active', plan: 'max' }, 'Max plan'],
    [{ status: 'active', plan: 'pro', spentCents: 1600 }, 'Pro — limit reached'],
    [{ status: 'past_due' }, 'Payment failed'],
    [{ status: 'unpaid' }, 'Payment failed'],
    [{ status: 'canceled' }, 'Canceled'],
    [{ status: 'paused' }, 'Paused'],
    [{ status: null }, 'No plan'],
  ]
  it.each(cases)('%o → %s', (over, expected) => {
    expect(planPillText(ready(ent(over)))).toBe(expected)
  })
  it('empty while loading/unavailable', () => {
    expect(planPillText({ status: 'loading', entitlement: null, activating: false })).toBe('')
    expect(planPillText({ status: 'unavailable', entitlement: null, activating: false })).toBe('')
  })
})

describe('paywallCopy (CTA routing, decision #7)', () => {
  it('no_plan → picker (Subscribe)', () => {
    const c = paywallCopy(ent({ status: null }))
    expect(c.cta?.action).toBe('picker')
  })
  it('canceled → picker (Resubscribe)', () => {
    const c = paywallCopy(ent({ status: 'canceled' }))
    expect(c.cta?.action).toBe('picker')
    expect(c.cta?.label).toBe('Resubscribe')
  })
  it('over_cap on Pro → portal upgrade to Max + reset date', () => {
    const c = paywallCopy(ent({ status: 'active', plan: 'pro', spentCents: 1600, periodEnd: '2026-08-09T12:00:00Z' }))
    expect(c.cta?.action).toBe('portal')
    expect(c.cta?.label).toContain('Max')
    expect(c.resetDate).not.toBe('')
  })
  it('over_cap on Max → no CTA (top tier), reset date only', () => {
    const c = paywallCopy(ent({ status: 'active', plan: 'max', spentCents: 5100 }))
    expect(c.cta).toBeNull()
  })
  it('past_due → portal (update card)', () => {
    const c = paywallCopy(ent({ status: 'past_due' }))
    expect(c.cta?.action).toBe('portal')
  })
})

describe('higherPlan', () => {
  it('pro → max, max → null', () => {
    expect(higherPlan('pro')).toBe('max')
    expect(higherPlan('max')).toBeNull()
    expect(higherPlan(null)).toBeNull()
  })
})

// Silences "unused" on the status-union import while documenting the full set the helpers handle.
const _allStatuses: SubscriptionStatus[] = ['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused']
void _allStatuses
