// Shared "luxury" chrome surface. A mostly-opaque tint laid over the macOS window vibrancy so a faint
// blur shows through on the top bar + sidebar, while the content panes stay fully solid for crisp text.
// Tune the look in ONE place: lower the alpha (e.g. /70) for heavier glass, raise it (e.g. /90) for an
// even subtler hint — or drop it from the TopBar to make only the sidebar translucent.
export const CHROME_BG = 'bg-neutral-900/80'
