// Shared "luxury" chrome surface. A mostly-opaque tint laid over the macOS window vibrancy so a faint
// blur shows through on the top bar + sidebar, while the content panes stay fully solid for crisp text.
// Tune the look in ONE place: lower the alpha (e.g. /70) for heavier glass, raise it (e.g. /90) for an
// even subtler hint — or drop it from the TopBar to make only the sidebar translucent.
export const CHROME_BG = 'bg-neutral-900/80'

// First name for greetings ("Welcome back, Ray"). Takes the leading token of the OAuth display name;
// returns '' when no name is present (name is optional on AuthUser) so callers fall back to a plain
// greeting rather than an awkward "Welcome back, ".
export function firstName(user: { name?: string } | null | undefined): string {
  const n = user?.name?.trim()
  return n ? n.split(/\s+/)[0] : ''
}
