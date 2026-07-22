import { useChatStore } from '../store'
import { AuthBackground } from './AuthBackground'
import cubicLogoUrl from '../assets/cubic-logo.svg'

/**
 * §B/§D-1 — full-window sign-in gate. Shown only in prod when there is no session (App.tsx routing);
 * local dev never reaches here. A cinematic full-bleed takeover: an animated WebGL hero (`AuthBackground`)
 * behind a centered, card-less sign-in (logo + headline + Google). The OAuth handshake + token storage
 * all live in main — this just kicks it off and reflects the status.
 *
 * Provider-agnostic by construction: render one button per supported provider. Google ships now; Apple
 * drops in as a sibling button here once §B-2's Supabase provider is configured.
 *
 * Copy (headline/subtext) is placeholder — final consumer-tone wording lands in P3c's §D-4 pass.
 */
export function AuthScreen() {
  const status = useChatStore((s) => s.auth.status)
  const error = useChatStore((s) => s.auth.error)
  const signingIn = status === 'signingIn'

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden px-8 text-center text-white">
      {/* Slim top drag strip — the rest of the window is no-drag so the pointer glow + button work. */}
      <div className="absolute inset-x-0 top-0 z-20 h-10 [-webkit-app-region:drag]" />
      <AuthBackground />

      {/* Soft radial dimmer behind the center content — lowers the background brightness right behind the
          text for readability, with edges faded so hard the shape itself is nearly invisible. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: 'min(760px, 92vw)',
          height: 'min(460px, 70vh)',
          background:
            'radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.4) 38%, rgba(0,0,0,0) 72%)',
          filter: 'blur(30px)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-6">
        {/* Brand lockup — logo + "Cubic" wordmark side by side (the logo's alt is empty so screen
            readers don't announce "Cubic" twice; the wordmark carries the name). */}
        <div className="flex items-center gap-2">
          <img
            src={cubicLogoUrl}
            alt=""
            className="h-14 w-14 opacity-95 drop-shadow-[0_2px_24px_rgba(255,255,255,0.16)]"
          />
          <span className="text-[42px] font-semibold leading-none tracking-tight text-white drop-shadow-[0_2px_24px_rgba(255,255,255,0.16)]">
            Cubic
          </span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-[26px] font-semibold tracking-tight text-white">
            Animate in After Effects, with AI
          </h1>
          <p className="max-w-sm text-[13px] leading-relaxed text-white/55">
            Describe the motion you want — Cubic builds it directly in AE.
          </p>
        </div>

        <div className="mt-1 flex flex-col items-center gap-3">
          <button
            onClick={() => void window.cubic.authSignIn('google')}
            disabled={signingIn}
            className="inline-flex items-center gap-3 rounded-lg bg-white px-5 py-2.5 text-[14px] font-medium text-neutral-900 shadow-lg shadow-black/25 transition hover:bg-white/90 disabled:cursor-default disabled:opacity-60"
          >
            <GoogleIcon />
            {signingIn ? 'Waiting for sign-in…' : 'Continue with Google'}
          </button>

          {signingIn && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-[12px] text-white/45">Complete sign-in in your browser, then come back.</p>
              {/* Escape hatch: the OAuth tab lives in the system browser, so we can't detect it closing.
                  Cancel returns to a clickable signed-out state instead of orphaning the wait forever. */}
              <button
                onClick={() => void window.cubic.authCancelSignIn()}
                className="text-[12px] text-white/45 underline-offset-2 transition hover:text-white/75 hover:underline"
              >
                Cancel
              </button>
            </div>
          )}
          {status === 'error' && error && <p className="max-w-xs text-[12px] text-red-400">{error}</p>}
        </div>
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
