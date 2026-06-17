import type { BackendPhase } from '@shared/ipc'

/**
 * Full-screen takeover for the two backend states that make the app non-functional and that the user
 * must resolve themselves (§B6):
 *  - port-in-use: the backend child couldn't bind its port — another Cubic (or an orphaned backend) owns
 *    it. We never auto-restart (a respawn would just re-collide); the user quits the other process.
 *  - stopped: the backend crashed past its auto-restart budget — the user reopens the app.
 * Distinct from the always-on status dot (which covers the recoverable / AE-not-ready states); these two
 * block everything, so they get the whole window rather than a small indicator.
 */
export function BackendBlockedScreen({ phase }: { phase: Extract<BackendPhase, 'port-in-use' | 'stopped'> }) {
  const { title, body } =
    phase === 'port-in-use'
      ? {
          title: 'Another copy of Cubic is already running',
          body: 'Cubic couldn’t start because something is already using its port. Quit the other Cubic window (or any leftover Cubic process) and open this app again.',
        }
      : {
          title: 'Cubic stopped unexpectedly',
          body: 'The Cubic backend stopped and couldn’t recover on its own. Please quit and reopen the app.',
        }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-10 text-center [-webkit-app-region:drag]">
      <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
      <h1 className="text-[17px] font-semibold tracking-tight text-white/90">{title}</h1>
      <p className="max-w-sm text-[13px] leading-relaxed text-white/55">{body}</p>
    </div>
  )
}
