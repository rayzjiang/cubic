// ─────────────────────────────────────────────────────────────────────────────
//  EDIT HERE — the rotating headline messages (the big bold line on each screen).
//
//  One line is picked at random per app launch and stays put while the app is
//  open (so it doesn't flicker as you move home ⇄ chat); a fresh one rolls on the
//  next launch or a ⌘R reload — same feel as ChatGPT / Claude.
//
//  Each entry is a function of the user's FIRST name. `fn` is '' when the name is
//  unknown (not signed in / OAuth gave no name), so every line writes BOTH forms:
//  a name-aware version and a plain fallback. To add/remove/reword a message,
//  just edit the arrays below — nothing else to touch.
//
//  NOTE: only the bold HEADLINE rotates. The grey sub-line under each is still
//  static and lives in its component (HomeView.tsx / MessageList.tsx).
// ─────────────────────────────────────────────────────────────────────────────

type Greeting = (fn: string) => string

/** Home / landing screen headline (sits above "Pick up a conversation…"). */
export const HOME_GREETINGS: Greeting[] = [
  (fn) => (fn ? `Welcome back, ${fn}` : 'Welcome back'),
  (fn) => (fn ? `Good to see you, ${fn}` : 'Good to see you'),
  (fn) => (fn ? `Ready when you are, ${fn}` : 'Ready when you are'),
  (fn) => (fn ? `Back in the studio, ${fn}?` : 'Back in the studio?'),
  (fn) => (fn ? `Where were we, ${fn}?` : 'Where were we?'),
]

/** New-chat empty-state headline (sits above "Describe a look, a motion…"). */
export const CHAT_GREETINGS: Greeting[] = [
  (fn) => (fn ? `What are we building today, ${fn}?` : 'What are we building today?'),
  (fn) => (fn ? `What's the vision, ${fn}?` : "What's the vision?"),
  (fn) => (fn ? `What should we make, ${fn}?` : 'What should we make?'),
  (fn) => (fn ? `Let's create something, ${fn}` : "Let's create something"),
  (fn) => (fn ? `Where do we start, ${fn}?` : 'Where do we start?'),
]

// ── plumbing (no need to edit below) ─────────────────────────────────────────
// Math.random() is fine here — this is the React renderer, not a workflow script.
const pick = (list: Greeting[]): Greeting => list[Math.floor(Math.random() * list.length)]

// Chosen ONCE, when this module first loads (i.e. once per app launch / reload).
// ES modules are singletons, so both components see the same stable pick.
export const homeGreeting = pick(HOME_GREETINGS)
export const chatGreeting = pick(CHAT_GREETINGS)
