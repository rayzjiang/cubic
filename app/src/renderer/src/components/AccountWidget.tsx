import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { useChatStore } from '../store'
import { EASE_OUT } from '../motion'

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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<{ left: number; bottom: number } | null>(null)

  // Position the popover above the trigger, opening upward from its top edge.
  const openMenu = (): void => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) setMenu({ left: r.left, bottom: window.innerHeight - r.top + 8 })
  }
  const closeMenu = (): void => setMenu(null)

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeMenu()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
        {/* TODO §D-5: replace with real plan/entitlement (placeholder only — no tier claimed). */}
        <span className="truncate text-[11px] leading-tight text-white/40">Plan</span>
      </span>
      <UpDownIcon />
    </button>
  )

  return (
    <>
      {trigger}
      {menu &&
        createPortal(
          <>
            {/* Click-away backdrop. */}
            <div className="fixed inset-0 z-40" onMouseDown={closeMenu} />
            <motion.div
              className="fixed z-50 w-60 overflow-hidden rounded-xl border border-white/10 bg-neutral-800/95 py-1.5 shadow-2xl backdrop-blur"
              style={{ left: menu.left, bottom: menu.bottom }}
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.15, ease: EASE_OUT }}
            >
              <div className="truncate px-3 py-1.5 text-[12px] text-white/45">{user.email}</div>
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
          </>,
          document.body,
        )}
    </>
  )
}

/** Round avatar — provider photo when present, else initials from the name (or email). */
function Avatar({ user }: { user: { name?: string; email: string; avatarUrl?: string } }) {
  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
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
