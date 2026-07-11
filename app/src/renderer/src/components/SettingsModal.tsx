import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Entitlement } from '@shared/ipc'
import { useChatStore } from '../store'
import { EASE_OUT } from '../motion'
import { planPillText, usagePercent, friendlyReset, billingActionErrorCopy } from '../billing/entitlement'

/**
 * §D Settings — a centered modal (same Shell vocabulary as ConfirmModal), root-mounted and driven by the
 * `settingsOpen` store flag. P1 scope: Account (email, current plan, Manage subscription → Portal / or
 * Subscribe → picker) + the usage %-bar. Delete-account (P2) and legal/support links (§G-2/§G-4) land
 * later. The renderer never talks to Supabase — main owns openPortal/openCheckout over IPC.
 */

// Statuses whose Stripe customer can be managed in the Portal (live/recoverable sub). Everything else
// (canceled/incomplete/null) has no manageable sub → the "Subscribe"/"Resubscribe" picker path instead.
const PORTAL_MANAGEABLE = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused'])

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
        className="w-[440px] max-w-[92vw] rounded-xl border border-white/10 bg-neutral-800 p-5 shadow-2xl"
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
  const user = useChatStore((s) => s.auth.user)
  const billing = useChatStore((s) => s.billing)
  const addToast = useChatStore((s) => s.addToast)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  const close = (): void => setOpen(false)
  const ent = billing.entitlement
  const pill = planPillText(billing)
  const manageable = !!ent?.status && PORTAL_MANAGEABLE.has(ent.status)
  const hasUsage = billing.status === 'ready' && !!ent && ent.allowanceCents > 0

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

  return (
    <AnimatePresence>
      {open && (
        <Shell key="settings" onClose={close}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-white/90">Settings</h2>
            <button onClick={close} aria-label="Close" className="rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white/80">
              <CloseIcon />
            </button>
          </div>

          {/* Account */}
          <Section title="Account">
            <Row label="Email" value={user?.email ?? '—'} />
            {billing.status !== 'unavailable' && (
              <Row
                label="Plan"
                value={pill || '—'}
                action={{ label: manageable ? 'Manage subscription' : 'Subscribe', onClick: () => void onManagePlan() }}
              />
            )}
          </Section>

          {/* Usage */}
          {hasUsage && ent && (
            <Section title="Usage">
              <UsageBar ent={ent} />
            </Section>
          )}
        </Shell>
      )}
    </AnimatePresence>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/35">{title}</h3>
      <div className="rounded-lg border border-white/10 bg-white/[0.03]">{children}</div>
    </div>
  )
}

function Row({ label, value, action }: { label: string; value: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-white/10">
      <span className="text-[13px] text-white/45">{label}</span>
      <span className="ml-auto truncate text-[13px] text-white/85">{value}</span>
      {action && (
        <button
          onClick={action.onClick}
          className="shrink-0 rounded-md bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white/85 hover:bg-white/15"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

/** The billing model's headline meter: percent of the monthly allowance used + the reset date. Never
 *  shows raw cost — only a %-bar (Cursor model). Amber ≥80%, red at the cap. */
function UsageBar({ ent }: { ent: Entitlement }) {
  const pct = usagePercent(ent)
  const reset = friendlyReset(ent.periodEnd)
  const color = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-white/70'
  return (
    <div className="px-3 py-3">
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

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4 L12 12 M12 4 L4 12" />
    </svg>
  )
}
