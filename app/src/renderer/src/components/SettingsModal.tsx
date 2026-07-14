import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { BillingDetails, Entitlement, Invoice } from '@shared/ipc'
import { useChatStore } from '../store'
import { useIsNarrow } from '../useMediaQuery'
import { EASE_OUT } from '../motion'
import {
  planPillText,
  usagePercent,
  friendlyReset,
  billingActionErrorCopy,
  canDeleteAccount,
  hasManageableSub,
} from '../billing/entitlement'
import { planDisplay, planDisplayName } from '../billing/plans'
import { DANGER_BTN, DANGER_BTN_DISABLED } from '../danger'
import cubicLogoUrl from '../assets/cubic-logo.svg'

/**
 * §D Settings — a centered modal with a left tab sidebar (General / Account / Billing / Usage), same Shell
 * animation vocabulary as the other modals. General = About Cubic (logo + version). Account = profile +
 * Log out + Delete account (P2). Billing = a Claude-style tab: plan block (→ Adjust plan opens the
 * fullscreen paywall) + Payment (live card + Update → Portal update-card) + an Invoices table (View →
 * the Stripe-hosted invoice page) + a Cancellation section. Usage = plan name + the %-bar. The renderer
 * never talks to Supabase/Stripe — main owns openPortal/openCheckout/getBillingDetails/openInvoice.
 *
 * Responsive: below 768px (`useIsNarrow`, the app's one breakpoint) the left rail collapses to a top
 * `Settings` + ✕ header bar with a horizontal, scrollable, text-only tab strip; the per-tab content is
 * shared between the two frames. Deliberately NO backdrop-blur on the scrim (per design); the tab rail is
 * a darker two-tone vs the pane.
 */

// Shared reusable button styles (the only tokenised buttons are the danger ones in danger.ts).
const BTN_NEUTRAL = 'rounded-md bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/15'

type TabId = 'general' | 'account' | 'billing' | 'usage'
const TABS: Array<{ id: TabId; label: string; Icon: () => ReactNode }> = [
  { id: 'general', label: 'General', Icon: GearIcon },
  { id: 'account', label: 'Account', Icon: PersonIcon },
  { id: 'billing', label: 'Billing', Icon: CardIcon },
  { id: 'usage', label: 'Usage', Icon: ChartIcon },
]

/** On-demand billing detail load: null = not fetched yet, 'loading' in flight, 'error' failed, else data. */
type DetailsState = BillingDetails | 'loading' | 'error' | null

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
  const pickerOpen = useChatStore((s) => s.pickerOpen)
  const user = useChatStore((s) => s.auth.user)
  const billing = useChatStore((s) => s.billing)
  const addToast = useChatStore((s) => s.addToast)
  const isNarrow = useIsNarrow()
  const [tab, setTab] = useState<TabId>('general')
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [version, setVersion] = useState('')
  const [details, setDetails] = useState<DetailsState>(null)

  // Land on General + clear transient state each time Settings opens; fetch the app version once.
  useEffect(() => {
    if (open) {
      setTab('general')
      setCancelConfirm(false)
      setDetails(null)
      void window.cubic.getAppVersion().then(setVersion).catch(() => {})
    }
  }, [open])

  const ent = billing.entitlement
  const pill = planPillText(billing)
  const manageable = hasManageableSub(ent)

  // Fetch the Billing tab's card + invoices on demand the first time it's viewed (mirrors getAppVersion).
  // `details !== null` short-circuits so the effect never loops after loading/erroring.
  useEffect(() => {
    if (!open || tab !== 'billing' || !manageable || details !== null) return
    setDetails('loading')
    void window.cubic.getBillingDetails().then((d) => setDetails(d ?? 'error'))
  }, [open, tab, manageable, details])

  // Escape closes the TOP-most overlay: the cancel confirm if it's up; if the Delete modal is up, let it
  // handle its own Escape (don't also close Settings underneath); otherwise close Settings.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (cancelConfirm) return void setCancelConfirm(false)
      // Delete modal / paywall overlay render ON TOP — let each handle its own Escape (don't also close
      // Settings underneath).
      if (deleteAccountOpen || pickerOpen) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen, cancelConfirm, deleteAccountOpen, pickerOpen])

  const close = (): void => setOpen(false)
  const hasUsage = billing.status === 'ready' && !!ent && ent.allowanceCents > 0
  // Renewal-date only (display, no backend): the next-renewal date for a live/active sub.
  const renews = ent && ent.status === 'active' ? friendlyReset(ent.periodEnd) : ''
  // A sub already scheduled to cancel at period-end shows "ends on <date>" instead of auto-renew, and its
  // Cancel button is hidden (nothing left to cancel). A live, non-cancelling sub gets the button.
  const cancelScheduled = !!ent && ent.cancelAtPeriodEnd && (ent.status === 'active' || ent.status === 'trialing')
  const showCancelBtn = manageable && !!ent && !ent.cancelAtPeriodEnd
  const canDelete = canDeleteAccount(billing)
  const cancelDate = friendlyReset(ent?.periodEnd ?? null)
  const planName = planDisplayName(ent?.plan ?? null)
  const planTagline = planDisplay(ent?.plan ?? null)?.tagline ?? ''
  const detailsData = details && typeof details === 'object' ? details : null

  // Change plan / Subscribe → open the fullscreen paywall overlay OVER Settings (don't close it), so its
  // Back button returns here. Checkout for a first sub, Portal "switch" for an up/down-grade.
  const onOpenPaywall = (): void => {
    setPickerOpen(true)
  }

  // Update the card → deep-link straight to Stripe's payment-method page (never the Portal home).
  const onUpdateCard = async (): Promise<void> => {
    const r = await window.cubic.openPortal('update_card')
    if (!r.ok) addToast(billingActionErrorCopy(r.error))
  }

  // Log out — close Settings first (in prod, sign-out drops the user to the AuthScreen).
  const onLogOut = (): void => {
    close()
    void window.cubic.authSignOut()
  }

  // Open the destructive type-to-confirm modal — it renders OVER the Settings modal (z-60), Settings
  // stays behind (it closes itself only on a successful delete → AuthScreen).
  const onDeleteAccount = (): void => {
    setDeleteAccountOpen(true)
  }

  const active = TABS.find((t) => t.id === tab) ?? TABS[0]

  // Shared per-tab content — rendered inside either the wide (left-rail) or narrow (top-strip) frame.
  const tabContent = (
    <>
      <h3 className="mb-5 text-[15px] font-semibold text-white/90">{active.label}</h3>

      {tab === 'general' && (
        <div>
          <div className="flex items-center gap-3">
            <img src={cubicLogoUrl} alt="Cubic" className="h-11 w-11" />
            <div>
              <div className="text-[15px] font-semibold text-white/90">Cubic</div>
              <div className="text-[12px] text-white/45">{version ? `Version ${version}` : 'Version —'}</div>
            </div>
          </div>
          <p className="mt-4 max-w-sm text-[12.5px] leading-relaxed text-white/45">
            AI-driven motion for After Effects — describe the animation you want and Cubic builds it
            right in your timeline.
          </p>
        </div>
      )}

      {tab === 'account' && (
        <div>
          {/* Profile — avatar + name/email + Log out. */}
          <div className="flex items-center gap-3">
            {user && <Avatar user={user} />}
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium text-white/90">
                {user?.name || user?.email || '—'}
              </div>
              {user?.name && <div className="truncate text-[12px] text-white/45">{user.email}</div>}
            </div>
            <button onClick={onLogOut} className={`ml-auto shrink-0 ${BTN_NEUTRAL}`}>
              Log out
            </button>
          </div>
          <p className="mt-3 text-[12px] text-white/40">Signed in with Google</p>

          {/* Delete account (P2). The button is ALWAYS visible; grayed + unclickable until any live
              subscription is cancelled first (flow: read this → Billing tab → Cancel → return here → it
              unlocks). */}
          <div className="mt-7 border-t border-white/10 pt-5">
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
        ) : !manageable ? (
          // Never subscribed / canceled → a simple Subscribe CTA (no plan/payment/invoices to show).
          <div>
            <Field label="Plan" value={pill || '—'} />
            <button onClick={onOpenPaywall} className={`mt-5 ${BTN_NEUTRAL}`}>
              Subscribe
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Plan block — name + tagline + renewal line, Adjust plan on the right. */}
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-white/90">{planName} plan</div>
                {planTagline && <div className="mt-0.5 text-[13px] text-white/55">{planTagline}</div>}
                <div className="mt-1 text-[12.5px] text-white/45">
                  {cancelScheduled
                    ? `Your plan ends on ${cancelDate || 'your billing date'}.`
                    : renews
                      ? `Your subscription will auto renew on ${renews}.`
                      : ''}
                </div>
              </div>
              <button onClick={onOpenPaywall} className={`shrink-0 ${BTN_NEUTRAL}`}>
                Adjust plan
              </button>
            </div>

            {/* Payment — the live default card + Update (→ Stripe payment-method page). */}
            <div>
              <SectionHeader>Payment</SectionHeader>
              <div className="flex items-center gap-3">
                <span className="text-[13px] text-white/85">
                  {detailsData?.paymentMethod
                    ? `${cardBrand(detailsData.paymentMethod.brand)} •••• ${detailsData.paymentMethod.last4}`
                    : details === 'loading'
                      ? 'Loading…'
                      : '—'}
                </span>
                <button onClick={() => void onUpdateCard()} className={`ml-auto shrink-0 ${BTN_NEUTRAL}`}>
                  Update
                </button>
              </div>
            </div>

            {/* Invoices — the past-invoice table; View opens the Stripe-hosted invoice page. */}
            <div>
              <SectionHeader>Invoices</SectionHeader>
              <InvoiceTable
                invoices={detailsData?.invoices ?? []}
                loading={details === 'loading'}
                errored={details === 'error'}
              />
            </div>

            {/* Cancellation — only on a live, non-cancelling sub. */}
            {showCancelBtn && (
              <div>
                <SectionHeader>Cancellation</SectionHeader>
                <div className="flex items-center gap-3">
                  <span className="text-[13px] text-white/55">
                    Cancel plan
                  </span>
                  <button onClick={() => setCancelConfirm(true)} className={`ml-auto shrink-0 ${DANGER_BTN}`}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

      {tab === 'usage' &&
        (hasUsage && ent ? (
          <div>
            <p className="mb-4 text-[13px] font-medium text-white/85">{planDisplayName(ent.plan)} plan</p>
            <UsageBar ent={ent} />
          </div>
        ) : (
          <Placeholder>Usage appears here once you’re on a plan.</Placeholder>
        ))}
    </>
  )

  return (
    <>
      <AnimatePresence>
        {open && (
          <Shell key="settings" onClose={close}>
            {isNarrow ? (
              // Narrow — a top header bar (Settings + ✕) + a horizontal, scrollable, text-only tab strip.
              <div className="flex h-[86vh] max-h-[720px] flex-col">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                  <h2 className="text-[14px] font-semibold text-white/90">Settings</h2>
                  <button
                    onClick={close}
                    aria-label="Close"
                    className="rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white/80"
                  >
                    <CloseIcon />
                  </button>
                </div>
                <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-white/10 px-3 py-2">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] ${
                        t.id === tab ? 'bg-white/10 text-white/90' : 'text-white/55 hover:bg-white/5 hover:text-white/80'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </nav>
                <div className="flex-1 overflow-y-auto p-6">{tabContent}</div>
              </div>
            ) : (
              // Wide — the left icon rail + a content pane with a floating ✕.
              <div className="flex h-[86vh] max-h-[720px]">
                <nav className="w-52 shrink-0 space-y-0.5 border-r border-white/10 bg-black/20 p-3">
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
                <div className="relative flex-1 overflow-y-auto p-8">
                  <button
                    onClick={close}
                    aria-label="Close"
                    className="absolute right-4 top-4 rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white/80"
                  >
                    <CloseIcon />
                  </button>
                  {/* Cap the content column so rows don't stretch across the wide modal (Claude-style). */}
                  <div className="max-w-xl">{tabContent}</div>
                </div>
              </div>
            )}
          </Shell>
        )}
      </AnimatePresence>

      {/* Light in-app confirm before Cancel opens Stripe (Stripe re-confirms on its own page). Sits
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
                    void window.cubic.openPortal('cancel').then((r) => {
                      if (!r.ok) addToast(billingActionErrorCopy(r.error))
                    })
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

/** Round avatar — provider photo when present, else initials from the name (or email). */
function Avatar({ user }: { user: { name?: string; email: string; avatarUrl?: string } }) {
  const [broken, setBroken] = useState(false)
  if (user.avatarUrl && !broken) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        onError={() => setBroken(true)}
        className="h-10 w-10 shrink-0 rounded-full object-cover"
      />
    )
  }
  const source = user.name || user.email || '?'
  const initials =
    source
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || source[0]?.toUpperCase()
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-[13px] font-medium text-white/80">
      {initials}
    </span>
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

/** Small bold section label used inside the Billing tab (Payment / Invoices / Cancellation). */
function SectionHeader({ children }: { children: ReactNode }) {
  return <h4 className="mb-3 text-[14px] font-semibold text-white/85">{children}</h4>
}

/** The Billing invoice history — Date · Due · Total · Status · View (opens the Stripe-hosted page). */
function InvoiceTable({ invoices, loading, errored }: { invoices: Invoice[]; loading: boolean; errored: boolean }) {
  if (loading) return <p className="text-[13px] text-white/40">Loading…</p>
  if (errored) return <p className="text-[13px] text-white/40">Couldn’t load your invoices.</p>
  if (invoices.length === 0) return <p className="text-[13px] text-white/40">No invoices yet.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="text-white/45">
            <th className="pb-2 pr-4 font-normal">Date</th>
            <th className="pb-2 pr-4 font-normal">Due</th>
            <th className="pb-2 pr-4 font-normal">Total</th>
            <th className="pb-2 pr-4 font-normal">Status</th>
            <th className="pb-2 text-right font-normal">Actions</th>
          </tr>
        </thead>
        <tbody className="text-white/85">
          {invoices.map((inv) => (
            <tr key={inv.id} className="border-t border-white/10">
              <td className="whitespace-nowrap py-2.5 pr-4">{fmtDate(inv.created)}</td>
              <td className="whitespace-nowrap py-2.5 pr-4 text-white/55">{inv.dueDate ? fmtDate(inv.dueDate) : ''}</td>
              <td className="whitespace-nowrap py-2.5 pr-4 tabular-nums">{fmtAmount(inv.total, inv.currency)}</td>
              <td className="whitespace-nowrap py-2.5 pr-4">{fmtStatus(inv.status)}</td>
              <td className="py-2.5 text-right">
                {inv.hostedUrl && (
                  <button
                    onClick={() => void window.cubic.openInvoice(inv.hostedUrl as string)}
                    className="text-blue-400 hover:underline"
                  >
                    View
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Unix seconds → "Jun 28, 2026". */
function fmtDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Cents → a localized currency string; whole amounts drop the ".00" (matches Stripe's own display). */
function fmtAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

/** Capitalize a Stripe status ('paid' → 'Paid'); em-dash for a null/draft status. */
function fmtStatus(status: string | null): string {
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : '—'
}

/** Capitalize a Stripe card brand ('visa' → 'Visa', 'amex' → 'Amex'). */
function cardBrand(brand: string): string {
  return brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'Card'
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
