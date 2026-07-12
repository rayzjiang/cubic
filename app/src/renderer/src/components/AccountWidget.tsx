import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useChatStore } from '../store'
import { EASE_OUT } from '../motion'
import { planPillText, paywallReason } from '../billing/entitlement'

/**
 * §B account-menu shell — a Claude-style account widget pinned bottom-left, persistent across Home +
 * Chat. In the sidebar it tracks the collapsed/expanded state (collapsed = avatar circle only); on Home
 * it renders expanded. Click opens an upward popover: email + Log out. Signed-out (only reachable in
 * local dev — prod gates at AuthScreen) shows a "Sign in" affordance instead.
 *
 * The popover is portaled to <body> and positioned from the trigger's rect: the sidebar clips its
 * overflow (for the collapse animation), which would otherwise cut the menu off.
 *
 * NOTE: the "Plan" line is a TEMPORARY placeholder to preview where the plan tag will sit — it claims
 * no tier (the billing model is undecided). §D-5 replaces it with real entitlement + Upgrade/Manage.
 */
export function AccountWidget({ collapsed = false }: { collapsed?: boolean }) {
  const user = useChatStore((s) => s.auth.user)
  const billing = useChatStore((s) => s.billing)
  const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)
  const setPickerOpen = useChatStore((s) => s.setPickerOpen)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const learnRef = useRef<HTMLButtonElement>(null)
  const flyoutRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ left: number; bottom: number } | null>(null)
  // "Learn more" side-flyout (Claude-style). Contents are placeholders until §G-2/§G-4 land.
  const [sub, setSub] = useState<{ left: number; top: number } | null>(null)
  const pill = planPillText(billing)
  // Contextual dropdown action (§D-5): a fast "Upgrade" only when the user has no active sub (→ picker →
  // Checkout). An active sub shows nothing here — plan changes live in Settings → Manage subscription.
  const canSubscribe = billing.status === 'ready' && paywallReason(billing.entitlement) === 'no_plan'

  // Position the popover above the trigger, opening upward from its top edge.
  const openMenu = (): void => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) setMenu({ left: r.left, bottom: window.innerHeight - r.top + 8 })
  }
  const closeMenu = (): void => {
    setMenu(null)
    setSub(null)
  }
  // Open the "Learn more" flyout to the right of its row (position from the row's own rect). Positioned
  // flush against the row (no gap) so hovering from the row onto the flyout doesn't cross dead space.
  const openSub = (): void => {
    const r = learnRef.current?.getBoundingClientRect()
    if (r) setSub({ left: r.right - 1, top: r.top })
  }
  // Close the flyout unless the pointer is moving between the row and the flyout (no timeout needed —
  // relatedTarget tells us where it's headed).
  const leaveSub = (e: { relatedTarget: EventTarget | null }): void => {
    const to = e.relatedTarget as Node | null
    if (!learnRef.current?.contains(to) && !flyoutRef.current?.contains(to)) setSub(null)
  }

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeMenu()
    }
    // The popover is position:fixed at coords derived from the trigger's rect at open-time. A window
    // resize moves the trigger, so re-anchor to it instead of leaving the menu floating at stale coords
    // (and drop the flyout, whose coords also go stale).
    const reposition = (): void => {
      openMenu()
      setSub(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', reposition)
    }
  }, [menu])

  // Signed out (local dev only): a direct sign-in affordance, no popover.
  if (!user) {
    return collapsed ? (
      <button
        onClick={() => void window.cubic.authSignIn('google')}
        className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full text-white/55 hover:bg-white/10 hover:text-white/90"
        aria-label="Sign in"
      >
        <PersonIcon />
      </button>
    ) : (
      <button
        onClick={() => void window.cubic.authSignIn('google')}
        className="m-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-white/70 hover:bg-white/10 hover:text-white/90"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10">
          <PersonIcon />
        </span>
        Sign in
      </button>
    )
  }

  const trigger = collapsed ? (
    <button
      ref={triggerRef}
      onClick={menu ? closeMenu : openMenu}
      className="mx-auto mb-2 rounded-full ring-white/20 hover:ring-2"
      aria-label="Account"
    >
      <Avatar user={user} />
    </button>
  ) : (
    <button
      ref={triggerRef}
      onClick={menu ? closeMenu : openMenu}
      className="m-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-white/10"
    >
      <Avatar user={user} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium leading-tight text-white/90">
          {user.name || user.email}
        </span>
        {/* Real plan/entitlement tag (§D-5); hidden while billing is loading/unavailable. */}
        {pill && <span className="truncate text-[11px] leading-tight text-white/40">{pill}</span>}
      </span>
      <UpDownIcon />
    </button>
  )

  return (
    <>
      {trigger}
      {createPortal(
        <>
          {/* Click-away backdrop (no exit anim — its instant removal is invisible). */}
          {menu && <div className="fixed inset-0 z-40" onMouseDown={closeMenu} />}
          {/* AnimatePresence so the popover animates BOTH open and close (mirrors AeStatus). */}
          <AnimatePresence>
            {menu && (
              <motion.div
                key="account-menu"
                className="fixed z-50 w-60 overflow-hidden rounded-xl border border-white/10 bg-neutral-800/95 py-1.5 shadow-2xl backdrop-blur"
                style={{ left: menu.left, bottom: menu.bottom }}
                initial={{ opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.98 }}
                transition={{ duration: 0.15, ease: EASE_OUT }}
              >
              <div className="truncate px-3 py-1.5 text-[12px] text-white/45">{user.email}</div>
              <div className="my-1 h-px bg-white/10" />
              {canSubscribe && (
                <button
                  onClick={() => {
                    closeMenu()
                    setPickerOpen(true)
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-white/80 hover:bg-white/10"
                >
                  <SparkleIcon />
                  Upgrade
                </button>
              )}
              <button
                onClick={() => {
                  closeMenu()
                  setSettingsOpen(true)
                }}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-white/80 hover:bg-white/10"
              >
                <SettingsIcon />
                Settings
              </button>
              <button
                ref={learnRef}
                onClick={() => (sub ? setSub(null) : openSub())}
                onMouseEnter={openSub}
                onMouseLeave={leaveSub}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-white/80 hover:bg-white/10"
              >
                <InfoIcon />
                Learn more
                <ChevronRightIcon />
              </button>
              <div className="my-1 h-px bg-white/10" />
              <button
                onClick={() => {
                  closeMenu()
                  void window.cubic.authSignOut()
                }}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-white/80 hover:bg-white/10"
              >
                <LogOutIcon />
                Log out
              </button>
              </motion.div>
            )}
          </AnimatePresence>
          {/* "Learn more" side-flyout — placeholder until §G-2/§G-4 wire the real Privacy/Terms/Help links. */}
          <AnimatePresence>
            {menu && sub && (
              <motion.div
                key="account-learn"
                ref={flyoutRef}
                onMouseLeave={leaveSub}
                className="fixed z-50 w-52 rounded-xl border border-white/10 bg-neutral-800/95 py-1.5 shadow-2xl backdrop-blur"
                style={{ left: sub.left, top: sub.top }}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.12, ease: EASE_OUT }}
              >
                <div className="px-3 py-2 text-[12px] text-white/40">More resources coming soon.</div>
              </motion.div>
            )}
          </AnimatePresence>
        </>,
        document.body,
      )}
    </>
  )
}

/** Round avatar — provider photo when present, else initials from the name (or email). Falls back to
 *  initials if the image fails to load (broken/expired avatar URL, CSP, offline). */
function Avatar({ user }: { user: { name?: string; email: string; avatarUrl?: string } }) {
  const [broken, setBroken] = useState(false)
  if (user.avatarUrl && !broken) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        onError={() => setBroken(true)}
        className="h-7 w-7 shrink-0 rounded-full object-cover"
      />
    )
  }
  const source = user.name || user.email || '?'
  const initials = source
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || source[0]?.toUpperCase()
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-medium text-white/80">
      {initials}
    </span>
  )
}

function UpDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-white/40">
      <path d="M5 6.5 L8 3.5 L11 6.5" />
      <path d="M5 9.5 L8 12.5 L11 9.5" />
    </svg>
  )
}

function PersonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3.5 13 C3.5 10.5 5.5 9.5 8 9.5 C10.5 9.5 12.5 10.5 12.5 13" />
    </svg>
  )
}

function LogOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-white/55">
      <path d="M6 2.5 H3.5 A1 1 0 0 0 2.5 3.5 V12.5 A1 1 0 0 0 3.5 13.5 H6" />
      <path d="M10 11 L13 8 L10 5" />
      <path d="M13 8 H6" />
    </svg>
  )
}

function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-white/55">
      <path d="M8 2 L9.2 6.2 L13.5 7.5 L9.2 8.8 L8 13 L6.8 8.8 L2.5 7.5 L6.8 6.2 Z" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-white/55">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7.3 V11" />
      <circle cx="8" cy="5.2" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="ml-auto shrink-0 text-white/40">
      <path d="M6 3.5 L10.5 8 L6 12.5" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-white/55">
      <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.281Z" />
      <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  )
}
