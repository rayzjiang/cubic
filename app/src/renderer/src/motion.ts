// Central motion vocabulary — the single place to tune durations, easings, springs, and the reusable
// variants every animated component shares. Mirrors ui.ts ("tune the look in ONE place"). All
// state/layout/mount-driven animation speaks Motion; the only intentional CSS holdouts are the
// infinite spinners (animate-spin) and simple hover color fades (transition-colors).
//
// Reduced motion: useMotion() reads Motion's useReducedMotion() (driven by the OS "Reduce Motion"
// accessibility setting) and returns variants with the y-rise + spring stripped down to plain fast
// fades. Spinners are CSS and unaffected.
// TODO(settings): once an in-app Settings page exists, OR a user toggle into this signal
// (e.g. `const reduce = osReduce || store.reduceMotion`) so motion can be disabled without OS prefs.

import { useReducedMotion, type Transition, type Variants } from 'motion/react'

// Cubic-bezier tuple Motion accepts for `ease`.
type Bezier = [number, number, number, number]

// ── Durations (Motion uses SECONDS, not ms) ──
export const DURATION = {
  fast: 0.15, // micro-fades, message / list-row entrance
  base: 0.2, // view crossfade, title fade
  slow: 0.3, // compaction expand
} as const

// ── Easings ──
// Reuse the "expo" curve already used across the app (cubic-bezier(0.16,1,0.3,1)): nonlinear,
// fast-then-settle, NO overshoot. EASE_OUT is the standard decelerate for everything else.
export const EASE_EXPO: Bezier = [0.16, 1, 0.3, 1]
export const EASE_OUT: Bezier = [0, 0, 0.2, 1]

// ── Spring — the ONLY place overshoot is allowed: the send↔stop button morph. ──
export const SPRING: Transition = { type: 'spring', stiffness: 520, damping: 30, mass: 0.7 }

// ── Static variants (no reduced-motion branch; safe to import directly) ──

// Overlapping crossfade for the home↔chat view swap — pure opacity, no vertical movement.
export const crossfade: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DURATION.base, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: DURATION.base, ease: EASE_OUT } },
}

// Incoming chat message / generic mount fade+rise (~150ms). y is a transform → no layout/scroll impact.
export const fadeRise: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.fast, ease: EASE_OUT } },
}

// Home conversation list: parent staggers its children on view enter.
export const listStagger: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.035, delayChildren: 0.04 } },
}
export const listRow: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.fast, ease: EASE_OUT } },
}

// ── Reduced-motion-aware bundle ──
// A hook because the reduced-motion signal is only available at runtime (variants are static). When
// reduce is on: drop all y-travel + spring → plain fast opacity fades; springs snap instantly.
export function useMotion() {
  const reduce = useReducedMotion() ?? false

  const fade = (duration = DURATION.fast): Variants => ({
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration, ease: EASE_OUT } },
    exit: { opacity: 0, transition: { duration, ease: EASE_OUT } },
  })

  return {
    reduce,
    crossfade: reduce ? fade(DURATION.fast) : crossfade,
    fadeRise: reduce ? fade(DURATION.fast) : fadeRise,
    listStagger: reduce ? ({ initial: {}, animate: { transition: { staggerChildren: 0 } } } as Variants) : listStagger,
    listRow: reduce ? fade(DURATION.fast) : listRow,
    // Send/stop morph transition: spring normally, instant snap when reduced.
    morphTransition: (reduce ? { duration: 0 } : SPRING) as Transition,
  }
}
