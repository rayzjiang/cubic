import { useChatStore } from '../store'

/**
 * §B — full-window sign-in gate. Shown only in prod when there is no session (App.tsx routing); local
 * dev never reaches here. A full takeover with no TopBar (mirrors BackendBlockedScreen). The actual
 * OAuth handshake + token storage all live in main — this just kicks it off and reflects the status.
 *
 * Provider-agnostic by construction: render one button per supported provider. Google ships now; Apple
 * is a config-only follow-up (add the provider in Supabase + a button here once §B-2's account exists).
 */
export function AuthScreen() {
  const status = useChatStore((s) => s.auth.status)
  const error = useChatStore((s) => s.auth.error)
  const signingIn = status === 'signingIn'

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-10 text-center [-webkit-app-region:drag]">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-[20px] font-semibold tracking-tight text-white/90">Welcome to Cubic</h1>
        <p className="max-w-xs text-[13px] leading-relaxed text-white/55">
          Sign in to start animating in After Effects.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 [-webkit-app-region:no-drag]">
        <button
          onClick={() => void window.cubic.authSignIn('google')}
          disabled={signingIn}
          className="inline-flex items-center gap-3 rounded-lg bg-white px-5 py-2.5 text-[14px] font-medium text-neutral-800 shadow-sm transition hover:bg-white/90 disabled:cursor-default disabled:opacity-60"
        >
          <GoogleIcon />
          {signingIn ? 'Waiting for sign-in…' : 'Sign in with Google'}
        </button>

        {signingIn && (
          <p className="text-[12px] text-white/45">Complete sign-in in your browser, then come back.</p>
        )}
        {status === 'error' && error && <p className="max-w-xs text-[12px] text-red-400">{error}</p>}
      </div>
    </div>
  )
}

/** Google "G" mark (official four-color), inline so there's no asset dependency. */
function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18z"
      />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34z" />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  )
}
