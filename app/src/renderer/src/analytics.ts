/**
 * §H analytics seam. Forwards a renderer event to main over IPC (fire-and-forget); main holds the one
 * PostHog client, stamps identity, applies the event-name + per-event property whitelist, and sends.
 * The renderer never imports posthog and never sees the key. Unknown event names (the legacy
 * message_sent/turn_done/… calls) are simply dropped in main, so those call sites stay free.
 */
export function track(event: string, props?: Record<string, unknown>): void {
  try {
    window.cubic.trackEvent(event, props)
  } catch {
    /* telemetry is best-effort — never throw into the UI (e.g. no preload bridge in a renderer test) */
  }
}
