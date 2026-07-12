import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Entitlement } from '@shared/ipc'
import { useChatStore } from '../store'
import { EASE_OUT } from '../motion'
import { planPillText, usagePercent, friendlyReset, billingActionErrorCopy, canDeleteAccount } from '../billing/entitlement'
import { planDisplayName } from '../billing/plans'
import { DANGER_BTN, DANGER_BTN_DISABLED } from '../danger'

/**
 * §D Settings — a centered modal with a left tab sidebar (General / Account / Billing / Usage), same
 * Shell animation vocabulary as the other modals. Account = email + Delete account (P2); Billing = plan +
 * Manage subscription → Portal + Cancel plan (direct Stripe cancel) + a display-only renew/cancel date;
 * Usage = the %-bar. General is a placeholder. ("Learn more" moved to the account dropdown, Claude-style;
 * its links land with §G-2/§G-4.) The renderer never talks to Supabase — main owns openPortal.
 */

// Statuses whose Stripe customer can be managed in the Portal (live/recoverable sub). Everything else
// (canceled/incomplete/null) has no manageable sub → the "Subscribe"/"Resubscribe" picker path instead.
const PORTAL_MANAGEABLE = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused'])

type TabId = 'general' | 'account' | 'billing' | 'usage'
const TABS: Array<{ id: TabId; label: string; Icon: () => ReactNode }> = [
  { id: 'general', label: 'General', Icon: GearIcon },
  { id: 'account', label: 'Account', Icon: PersonIcon },
  { id: 'billing', label: 'Billing', Icon: CardIcon },
  { id: 'usage', label: 'Usage', Icon: ChartIcon },
]

function Shell({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12, ease: EASE_OUT }}
    >
      <motion.div
        className="w-[90vw] max-w-[1040px] overflow-hidden rounded-xl border border-white/10 bg-neutral-800 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.15, ease: EASE_OUT }}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

export function SettingsModal() {
  const open = useChatStore((s) => s.settingsOpen)
  const setOpen = useChatStore((s) => s.setSettingsOpen)
  const setPickerOpen = useChatStore((s) => s.setPickerOpen)
  const setDeleteAccountOpen = useChatStore((s) => s.setDeleteAccountOpen)
  const deleteAccountOpen = useChatStore((s) => s.deleteAccountOpen)
  const user = useChatStore((s) => s.auth.user)
  const billing = useChatStore((s) => s.billing)
  const addToast = useChatStore((s) => s.addToast)
  const [tab, setTab] = useState<TabId>('general')
  const [cancelConfirm, setCancelConfirm] = useState(false)

  // Land on General + clear the cancel confirm each time Settings opens.
  useEffect(() => {
    if (open) {
      setTab('general')
      setCancelConfirm(false)
    }
  }, [open])

  // Escape closes the TOP-most overlay: the cancel confirm if it's up; if the Delete modal is up, let it
  // handle its own Escape (don't also close Settings underneath); otherwise close Settings.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (cancelConfirm) return void setCancelConfirm(false)
      if (deleteAccountOpen) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen, cancelConfirm, deleteAccountOpen])

  const close = (): void => setOpen(false)
  const ent = billing.entitlement
  const pill = planPillText(billing)
  const manageable = !!ent?.status && PORTAL_MANAGEABLE.has(ent.status)
  const hasUsage = billing.status === 'ready' && !!ent && ent.allowanceCents > 0
  // Renewal-date only (display, no backend): the next-renewal date for a live/active sub.
  const renews = ent && ent.status === 'active' ? friendlyReset(ent.periodEnd) : ''
  // A sub already scheduled to cancel at period-end shows "Cancels <date>" instead of "Renews", and its
  // Cancel-plan button is hidden (nothing left to cancel). A live, non-cancelling sub gets the button.
  const cancelScheduled = !!ent && ent.cancelAtPeriodEnd && (ent.status === 'active' || ent.status === 'trialing')
  const showCancelBtn = manageable && !!ent && !ent.cancelAtPeriodEnd
  const canDelete = canDeleteAccount(billing)
  const cancelDate = friendlyReset(ent?.periodEnd ?? null)
  const planName = planDisplayName(ent?.plan ?? null)

  // Manageable sub → Portal (manage / switch / cancel / update card). Otherwise → the plan picker
  // (Checkout) for a first/again subscribe.
  const onManagePlan = async (): Promise<void> => {
    if (manageable) {
      const r = await window.cubic.openPortal()
      if (!r.ok) addToast(billingActionErrorCopy(r.error))
      return
    }
    close()
    setPickerOpen(true)
  }

  // Deep-link straight to Stripe's cancel confirmation (no Portal-home hunting). Shared by the Billing
  // tab's Cancel-plan button and the Account tab's delete-blocked CTA.
  const onCancelPlan = async (): Promise<void> => {
    const r = await window.cubic.openPortal('cancel')
    if (!r.ok) addToast(billingActionErrorCopy(r.error))
  }

  // Open the destructive type-to-confirm modal — it renders OVER the Settings modal (z-60), Settings
  // stays behind (it closes itself only on a successful delete → AuthScreen).
  const onDeleteAccount = (): void => {
    setDeleteAccountOpen(true)
  }

  const active = TABS.find((t) => t.id === tab) ?? TABS[0]

  return (
    <>
    <AnimatePresence>
      {open && (
        <Shell key="settings" onClose={close}>
          <div className="flex h-[86vh] max-h-[720px]">
            {/* Tab rail */}
            <nav className="w-52 shrink-0 space-y-0.5 border-r border-white/10 p-3">
              <h2 className="px-2 pb-2 text-[13px] font-semibold text-white/90">Settings</h2>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] ${
                    t.id === tab ? 'bg-white/10 text-white/90' : 'text-white/55 hover:bg-white/5 hover:text-white/80'
                  }`}
                >
                  <t.Icon />
                  {t.label}
                </button>
              ))}
            </nav>

            {/* Content pane */}
            <div className="relative flex-1 overflow-y-auto p-8">
              <button
                onClick={close}
                aria-label="Close"
                className="absolute right-4 top-4 rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white/80"
              >
                <CloseIcon />
              </button>
              {/* Cap the content column so rows don't stretch across the wide modal (Claude-style). */}
              <div className="max-w-xl">
              <h3 className="mb-4 text-[15px] font-semibold text-white/90">{active.label}</h3>

              {tab === 'general' && <Placeholder>General settings will live here.</Placeholder>}

              {tab === 'account' && (
                <div>
                  <Field label="Email" value={user?.email ?? '—'} />
                  {/* Delete account (P2). The button is ALWAYS visible; grayed + unclickable until any live
                      subscription is cancelled first (flow: read this → Billing tab → Cancel plan → return
                      here → it unlocks). */}
                  <div className="mt-6 border-t border-white/10 pt-4">
                    <p className="text-[13px] font-medium text-white/85">Delete account</p>
                    <p className="mt-1 text-[12px] text-white/45">
                      {canDelete
                        ? 'Permanently deletes your account and everything in it. This can’t be undone.'
                        : 'Please cancel your subscription first — you can cancel it in the Billing tab.'}
                    </p>
                    {canDelete ? (
                      <button onClick={onDeleteAccount} className={`mt-3 ${DANGER_BTN}`}>
                        Delete account
                      </button>
                    ) : (
                      <button disabled aria-disabled className={`mt-3 ${DANGER_BTN_DISABLED}`}>
                        Delete account
                      </button>
                    )}
                  </div>
                </div>
              )}

              {tab === 'billing' &&
                (billing.status === 'unavailable' ? (
                  <Placeholder>Billing isn’t available on this build.</Placeholder>
                ) : (
                  <div>
                    <Field label="Plan" value={pill || '—'} />
                    {cancelScheduled
                      ? friendlyReset(ent?.periodEnd ?? null) && (
                          <Field label="Cancels" value={friendlyReset(ent?.periodEnd ?? null)} />
                        )
                      : renews && <Field label="Renews" value={renews} />}
                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => void onManagePlan()}
                        className="rounded-md bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/15"
                      >
                        {manageable ? 'Manage subscription' : 'Subscribe'}
                      </button>
                      {showCancelBtn && (
                        <button onClick={() => setCancelConfirm(true)} className={DANGER_BTN}>
                          Cancel plan
                        </button>
                      )}
                    </div>
                  </div>
                ))}

              {tab === 'usage' &&
                (hasUsage && ent ? <UsageBar ent={ent} /> : <Placeholder>Usage appears here once you’re on a plan.</Placeholder>)}
              </div>
            </div>
          </div>
        </Shell>
      )}
    </AnimatePresence>

    {/* Light in-app confirm before Cancel plan opens Stripe (Stripe re-confirms on its own page). Sits
        ABOVE the Settings modal (z-60); NOT a type-to-confirm — cancel is reversible. */}
    <AnimatePresence>
      {open && cancelConfirm && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onMouseDown={() => setCancelConfirm(false)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12, ease: EASE_OUT }}
        >
          <motion.div
            className="w-96 max-w-[95vw] rounded-xl border border-white/10 bg-neutral-800 p-5 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.15, ease: EASE_OUT }}
          >
            <h2 className="text-[15px] font-semibold text-white/90">Cancel your plan?</h2>
            <p className="mt-2 text-[13px] text-white/55">
              You’ll keep access until {cancelDate || 'the end of your billing period'}, then your plan
              ends. You’ll finish the cancellation on Stripe.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setCancelConfirm(false)}
                className="rounded-md px-3 py-1.5 text-[13px] text-white/70 hover:bg-white/10"
              >
                Keep your {planName} plan
              </button>
              <button
                onClick={() => {
                  setCancelConfirm(false)
                  void onCancelPlan()
                }}
                className={DANGER_BTN}
              >
                Cancel plan
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-white/10 py-2.5 last:border-0">
      <span className="text-[13px] text-white/45">{label}</span>
      <span className="ml-auto truncate text-[13px] text-white/85">{value}</span>
    </div>
  )
}

function Placeholder({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-white/40">{children}</p>
}

/** The billing model's headline meter: percent of the monthly allowance used + the reset date. Never
 *  shows raw cost — only a %-bar (Cursor model). Amber ≥80%, red at the cap. */
function UsageBar({ ent }: { ent: Entitlement }) {
  const pct = usagePercent(ent)
  const reset = friendlyReset(ent.periodEnd)
  const color = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-white/70'
  return (
    <div>
      <div className="flex items-center justify-between text-[12px] text-white/55">
        <span>Usage this month</span>
        <span className="tabular-nums text-white/80">{pct}%</span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {reset && <p className="mt-1.5 text-[11px] text-white/40">Resets {reset}</p>}
    </div>
  )
}

// ── Tab icons (stroke style, ~15px) ──

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.281Z" />
      <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  )
}

function PersonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3.5 13 C3.5 10.5 5.5 9.5 8 9.5 C10.5 9.5 12.5 10.5 12.5 13" />
    </svg>
  )
}

function CardIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <line x1="2" y1="6.5" x2="14" y2="6.5" />
      <line x1="4.5" y1="10" x2="7.5" y2="10" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <line x1="3.5" y1="13" x2="3.5" y2="9.5" />
      <line x1="8" y1="13" x2="8" y2="5" />
      <line x1="12.5" y1="13" x2="12.5" y2="7.5" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4 L12 12 M12 4 L4 12" />
    </svg>
  )
}
