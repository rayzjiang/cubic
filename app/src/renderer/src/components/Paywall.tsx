import type { PlanId } from '@shared/ipc'
import { useChatStore } from '../store'
import { paywallCopy, billingActionErrorCopy, type PaywallCopy } from '../billing/entitlement'

/**
 * §D-2 in-context limit banner — a slim bar under the TopBar for a blocked user who still has chats to
 * browse (canceled / past_due / over_cap). They keep browsing; the composer is separately gated. The
 * full-screen surfaces (cold-start takeover + the triggered overlay) live in FullscreenPaywall.tsx; the
 * takeover-vs-banner CHOICE is the chat-count rule in App.tsx. Here `reason` only drives copy/CTA.
 */

async function runPortal(
  flow: 'update_card' | 'switch' | undefined,
  plan: PlanId | undefined,
  addToast: (t: string) => void,
): Promise<void> {
  const r = await window.cubic.openPortal(flow, plan)
  if (!r.ok) addToast(billingActionErrorCopy(r.error))
}

/** Run a banner CTA: 'picker' opens the fullscreen paywall overlay; 'portal' deep-links the Stripe Portal
 *  to the CTA's exact flow (update_card / switch). */
function runCta(cta: NonNullable<PaywallCopy['cta']>, setPickerOpen: (o: boolean) => void, addToast: (t: string) => void): void {
  if (cta.action === 'picker') setPickerOpen(true)
  else void runPortal(cta.portalFlow, cta.portalPlan, addToast)
}

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
}

/** In-context bar under the TopBar for a blocked user who still has chats to browse. */
export function PaywallBanner() {
  const billing = useChatStore((s) => s.billing)
  const addToast = useChatStore((s) => s.addToast)
  const setPickerOpen = useChatStore((s) => s.setPickerOpen)
  const ent = billing.entitlement
  if (!ent) return null
  const copy = paywallCopy(ent)

  return (
    <div className="flex items-center gap-3 border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-[12px] text-amber-50/90">
      {billing.activating ? (
        <span className="flex items-center gap-2">
          <Spinner /> Activating your subscription…
        </span>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">
            {copy.title}
            {copy.resetDate ? ` · resets ${copy.resetDate}` : ''}
          </span>
          {copy.cta && (
            <button
              onClick={() => runCta(copy.cta!, setPickerOpen, addToast)}
              className="shrink-0 rounded-md bg-amber-400/90 px-2.5 py-1 text-[12px] font-medium text-neutral-900 hover:bg-amber-400"
            >
              {copy.cta.label}
            </button>
          )}
        </>
      )}
    </div>
  )
}
