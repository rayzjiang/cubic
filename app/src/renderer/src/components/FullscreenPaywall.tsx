import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import type { Entitlement, PlanId } from '@shared/ipc'
import { useChatStore } from '../store'
import { EASE_OUT } from '../motion'
import { PLANS, higherPlan } from '../billing/plans'
import {
  isBlocked,
  paywallReason,
  paywallCopy,
  planCardCta,
  billingActionErrorCopy,
  type PaywallCopy,
} from '../billing/entitlement'

/**
 * §D-3 — the fullscreen conversion paywall. ONE surface, two entry paths:
 *   - <FullscreenPaywall/> : the cold-start takeover (App.tsx renders it as the whole body when the user
 *     is blocked with zero chats). No back button — a "Log out" escape instead.
 *   - <PaywallOverlay/>    : the same content as a store-driven (`pickerOpen`) full-screen overlay opened
 *     from the account menu / Settings / a paywall banner CTA. Has a Back button + blurred scrim.
 *
 * Reason-driven (mirrors `paywallCopy`): a blocked-no_plan or over-cap user (or any subscribed user opening
 * "Change plan") sees BOTH plan cards with contextual per-card routing — Checkout for a first sub, a
 * one-click Portal "switch" for an up/down-grade, and a disabled "Current plan"; a past_due user gets a
 * focused "update card" Portal CTA; a capped top-tier user gets a "resets <date>" wait state. Copy is
 * placeholder — P3c's §D-4 finalizes it.
 */

/** The reason-driven body, shared by the takeover + the overlay. `onClose` (overlay only) closes it after
 *  the user picks a plan / opens a Portal flow. */
function PaywallBody({ onClose }: { onClose?: () => void }) {
  const billing = useChatStore((s) => s.billing)
  const addToast = useChatStore((s) => s.addToast)
  const ent = billing.entitlement
  if (!ent) return null

  const blocked = isBlocked(billing)
  const reason = paywallReason(ent) // null when not blocked (a subscribed "change plan" open)
  const capped = reason === 'over_cap' && !higherPlan(ent.plan) // top tier, over cap → nothing to buy
  const showCards = !capped && reason !== 'past_due'

  // Header: reason-driven copy when blocked; a neutral "change plan" header for a subscribed user.
  const header: { title: string; body: string; cta: PaywallCopy['cta'] } = blocked
    ? paywallCopy(ent)
    : { title: 'Change your plan', body: 'Upgrade or downgrade anytime — Stripe prorates the difference.', cta: null }
  const cta = header.cta

  const runPortalCta = async (c: NonNullable<PaywallCopy['cta']>): Promise<void> => {
    const r = await window.cubic.openPortal(c.portalFlow, c.portalPlan)
    if (!r.ok) addToast(billingActionErrorCopy(r.error))
    else onClose?.()
  }

  if (billing.activating) {
    return (
      <div className="flex items-center justify-center gap-2.5 text-[14px] text-white/70">
        <Spinner /> Activating your subscription…
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-2xl flex-col items-center text-center">
      <h1 className="text-[26px] font-semibold tracking-tight text-white/90">{header.title}</h1>
      <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-white/55">{header.body}</p>
      <div className="mt-8 w-full">
        {showCards ? (
          <PlanCards ent={ent} onAfterPick={onClose} />
        ) : cta ? (
          <button
            onClick={() => void runPortalCta(cta)}
            className="rounded-lg bg-white px-5 py-2.5 text-[13px] font-medium text-neutral-900 hover:bg-white/90"
          >
            {cta.label}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** The two plan cards, each with a contextual CTA (Checkout / switch / disabled current-plan). */
function PlanCards({ ent, onAfterPick }: { ent: Entitlement; onAfterPick?: () => void }) {
  const addToast = useChatStore((s) => s.addToast)
  const run = async (plan: PlanId, action: 'checkout' | 'switch'): Promise<void> => {
    const r = action === 'checkout' ? await window.cubic.openCheckout(plan) : await window.cubic.openPortal('switch', plan)
    if (!r.ok) addToast(billingActionErrorCopy(r.error))
    else onAfterPick?.()
  }
  return (
    <div className="mx-auto flex w-full flex-col gap-4 text-left sm:flex-row">
      {PLANS.map((p) => {
        const cta = planCardCta(ent, p.id)
        const current = cta.action === 'current'
        return (
          <div
            key={p.id}
            className={`flex flex-1 flex-col rounded-2xl border p-5 ${
              current ? 'border-white/20 bg-white/[0.06]' : 'border-white/10 bg-white/[0.03]'
            }`}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-[16px] font-semibold text-white/90">{p.name}</span>
              <span className="text-[13px] text-white/55">{p.priceLabel}</span>
            </div>
            <p className="mt-1 text-[12px] text-white/45">{p.tagline}</p>
            <ul className="mt-4 flex flex-1 flex-col gap-2">
              {p.highlights.map((h) => (
                <li key={h} className="flex items-start gap-2 text-[12.5px] text-white/70">
                  <CheckIcon />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
            <button
              disabled={current}
              onClick={() => {
                if (cta.action !== 'current') void run(p.id, cta.action)
              }}
              className={`mt-5 rounded-lg py-2 text-center text-[13px] font-medium ${
                current ? 'cursor-default bg-white/10 text-white/40' : 'bg-white text-neutral-900 hover:bg-white/90'
              }`}
            >
              {cta.label}
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** Cold-start takeover — the whole `body` in App.tsx when blocked with zero chats. No back; Log out escape.
 *  Paints its own near-black background (the app root is transparent → macOS vibrancy, which reads gray)
 *  with a soft radial glow so it feels premium/dark rather than flat gray. No home is rendered behind — a
 *  first-timer has nothing to browse — so this is a solid backdrop, not a blurred one. */
export function FullscreenPaywall() {
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-8 overflow-hidden bg-neutral-950 px-8 [-webkit-app-region:drag]">
      {/* Soft premium glow behind the center content (no occluding shape — just a light bloom). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 55% 45% at 50% 40%, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0) 70%)' }}
      />
      <div className="relative w-full [-webkit-app-region:no-drag]">
        <div className="flex justify-center">
          <PaywallBody />
        </div>
      </div>
      {/* Don't trap a signed-in cold-start user behind the wall. */}
      <button
        onClick={() => void window.cubic.authSignOut()}
        className="relative [-webkit-app-region:no-drag] text-[12px] text-white/35 hover:text-white/60"
      >
        Log out
      </button>
    </div>
  )
}

/** Store-driven full-screen overlay (`pickerOpen`), opened from the account menu / Settings / a banner. */
export function PaywallOverlay() {
  const open = useChatStore((s) => s.pickerOpen)
  const setOpen = useChatStore((s) => s.setPickerOpen)
  const entitled = useChatStore((s) => s.billing.entitlement?.entitled ?? false)
  const prevEntitled = useRef(entitled)

  // Close automatically once a BLOCKED user becomes entitled (post-checkout return resolved) so a stale
  // paywall doesn't linger over the unlocked app. NOT on mount for an already-entitled "change plan" open
  // (entitled never flips false→true there).
  useEffect(() => {
    if (open && entitled && prevEntitled.current === false) setOpen(false)
    prevEntitled.current = entitled
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
          key="paywall-overlay"
          // Heavier blur + darker scrim than a plain modal: the in-context PaywallBanner ("Subscribe to
          // start using Cubic" / "Choose a plan") sits right behind this, so a light blur left it legible.
          // blur-2xl + black/75 makes it illegible while keeping a faint sense of depth (not fully opaque).
          className="fixed inset-0 z-[55] flex flex-col bg-black/75 backdrop-blur-2xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: EASE_OUT }}
        >
          <button
            onClick={() => setOpen(false)}
            aria-label="Back"
            // Solid, opaque chip (not a translucent hover-only button) so it reads clearly over the blur.
            className="absolute left-3 top-11 z-10 flex items-center gap-1.5 rounded-lg border border-white/10 bg-neutral-800 px-3 py-1.5 text-[13px] font-medium text-white/90 shadow-sm hover:bg-neutral-700"
          >
            <BackIcon />
            Back
          </button>
          <motion.div
            className="flex flex-1 items-center justify-center overflow-y-auto p-8"
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
          >
            <PaywallBody onClose={() => setOpen(false)} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0 text-white/45">
      <path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M10 3.5 L5.5 8 L10 12.5" />
    </svg>
  )
}
