/**
 * Per-account first-run flags (§D-1), stored in localStorage keyed by the signed-in user id — so each
 * account sees onboarding once on a given device, a different account gets its own run, and clearing
 * the key re-triggers it for testing. Renderer-only: no IPC, no backend, no server-side flag.
 *
 * Two flags, merged into one JSON record per user:
 *   - `intro`   — the pre-paywall info slides have been seen (OnboardingFlow).
 *   - `triedIt` — the post-subscribe "start a chat" coachmark has been dismissed (first chat started).
 *
 * The store hydrates these into `onboardingSeen`/`triedItSeen` when auth resolves signed-in, and calls
 * the mark* setters when the user completes each step.
 */

export interface FirstRunState {
  intro: boolean
  triedIt: boolean
  /** §H — the user's first-ever prompt has been sent (drives the first_prompt_sent analytics event,
   *  fired once per account). Renderer-only, like the others. */
  firstPrompt: boolean
}

const KEY = (userId: string): string => `cubic.firstrun.${userId}`

/** Read the record for a user. Missing / malformed → both false (a first-timer). */
export function readFirstRun(userId: string): FirstRunState {
  try {
    const raw = localStorage.getItem(KEY(userId))
    if (!raw) return { intro: false, triedIt: false, firstPrompt: false }
    const parsed = JSON.parse(raw) as Partial<FirstRunState>
    return { intro: parsed.intro === true, triedIt: parsed.triedIt === true, firstPrompt: parsed.firstPrompt === true }
  } catch {
    return { intro: false, triedIt: false, firstPrompt: false }
  }
}

/** Merge-write one flag on (never turns a flag back off). */
function write(userId: string, patch: Partial<FirstRunState>): void {
  try {
    const next = { ...readFirstRun(userId), ...patch }
    localStorage.setItem(KEY(userId), JSON.stringify(next))
  } catch {
    /* storage unavailable — non-fatal (the flow just re-shows next launch) */
  }
}

export function markIntroSeen(userId: string): void {
  write(userId, { intro: true })
}

export function markTriedIt(userId: string): void {
  write(userId, { triedIt: true })
}

export function markFirstPromptSent(userId: string): void {
  write(userId, { firstPrompt: true })
}
