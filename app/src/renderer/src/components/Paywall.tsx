import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useChatStore } from '../store'
import { EASE_OUT } from '../motion'
import { PLANS } from '../billing/plans'
import { paywallCopy, billingActionErrorCopy, type PaywallCopy } from '../billing/entitlement'

/**
 * §D-2/§D-3 paywall — ONE reusable surface in three forms, all reason→copy driven (paywallCopy):
 *   - PaywallTakeover : full-screen, shown by App.tsx when blocked AND the user has zero chats (cold
 *                       start). Renders the plan picker (no_plan) or a single Portal CTA.
 *   - PaywallBanner   : a slim in-context bar under the TopBar, shown when blocked but the user HAS chats
 *                       (canceled / past_due / over_cap) — they keep browsing; the composer is blocked.
 *   - PlanPickerModal : the two-tier picker as a modal, opened from the account menu / Settings / a
 *                       banner "picker" CTA.
 * The takeover-vs-banner CHOICE is the chat-count rule in App.tsx; here reason only drives copy/CTA.
 * Styling is functional-minimal by intent (get it popping up correctly first — polish/AB-test later).
 */

async function runPortal(addToast: (t: string) => void): Promise<void> {
  const r = await window.cubic.openPortal()
  if (!r.ok) addToast(billingActionErrorCopy(r.error))
}

/** Run a paywall CTA: 'picker' opens the plan-picker modal; 'portal' opens the Stripe Portal. */
function runCta(cta: NonNullable<PaywallCopy['cta']>, setPickerOpen: (o: boolean) => void, addToast: (t: string) => void): void {
  if (cta.action === 'picker') setPickerOpen(true)
  else void runPortal(addToast)
}

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
}

/** The two-tier plan cards → Stripe Checkout for the chosen plan. `onPick` fires after the browser opens
 *  (e.g. to close the containing modal). */
function PlanPicker({ onPick }: { onPick?: () => void }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {PLANS.map((p) => (
        <button
          key={p.id}
          onClick={() => {
            void window.cubic.openCheckout(p.id)
            onPick?.()
          }}
          className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition-colors hover:border-white/25 hover:bg-white/[0.06]"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[15px] font-semibold text-white/90">{p.name}</span>
            <span className="text-[13px] text-white/60">{p.priceLabel}</span>
          </div>
          <p className="mt-1 text-[12px] text-white/45">{p.tagline}</p>
          <span className="mt-3 block rounded-lg bg-white py-1.5 text-center text-[13px] font-medium text-neutral-900">
            Choose {p.name}
          </span>
        </button>
      ))}
    </div>
  )
}

/** Full-screen paywall (cold start). No TopBar — it's the whole `body` in the App.tsx routing ladder. */
export function PaywallTakeover() {
  const billing = useChatStore((s) => s.billing)
  const addToast = useChatStore((s) => s.addToast)
  const setPickerOpen = useChatStore((s) => s.setPickerOpen)
  const ent = billing.entitlement
  if (!ent) return null
  const copy = paywallCopy(ent)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-8 [-webkit-app-region:drag]">
      <div className="w-full max-w-md text-center [-webkit-app-region:no-drag]">
        {billing.activating ? (
          <div className="flex items-center justify-center gap-2.5 text-[14px] text-white/70">
            <Spinner /> Activating your subscription…
          </div>
        ) : (
          <>
            <h1 className="text-[22px] font-semibold text-white/90">{copy.title}</h1>
            <p className="mx-auto mt-2 max-w-sm text-[13px] text-white/55">{copy.body}</p>
            <div className="mt-6">
              {copy.cta?.action === 'picker' ? (
                <PlanPicker />
              ) : copy.cta ? (
                <button
                  onClick={() => runCta(copy.cta!, setPickerOpen, addToast)}
                  className="rounded-lg bg-white px-4 py-2 text-[13px] font-medium text-neutral-900 hover:bg-white/90"
                >
                  {copy.cta.label}
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
      {/* Don't trap a signed-in cold-start user behind the wall. */}
      <button
        onClick={() => void window.cubic.authSignOut()}
        className="[-webkit-app-region:no-drag] text-[12px] text-white/35 hover:text-white/60"
      >
        Log out
      </button>
    </div>
  )
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

/** The plan picker as a modal (account-menu "Upgrade" / Settings "Subscribe" / a banner "picker" CTA). */
export function PlanPickerModal() {
  const open = useChatStore((s) => s.pickerOpen)
  const setOpen = useChatStore((s) => s.setPickerOpen)
  const entitled = useChatStore((s) => s.billing.entitlement?.entitled)

  // Auto-close once the user becomes entitled (e.g. the post-checkout return resolved) so a stale picker
  // never lingers over an unlocked app.
  useEffect(() => {
    if (open && entitled) setOpen(false)
  }, [open, entitled, setOpen])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="plan-picker"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={() => setOpen(false)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12, ease: EASE_OUT }}
        >
          <motion.div
            className="w-[520px] max-w-[92vw] rounded-xl border border-white/10 bg-neutral-800 p-5 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.15, ease: EASE_OUT }}
          >
            <h2 className="text-[15px] font-semibold text-white/90">Choose your plan</h2>
            <p className="mt-1 mb-4 text-[13px] text-white/55">Pick a plan to start creating with Cubic. You can change or cancel anytime.</p>
            <PlanPicker onPick={() => setOpen(false)} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
