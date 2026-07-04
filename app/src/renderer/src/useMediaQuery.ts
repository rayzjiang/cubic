// Reactive media-query match, tear-free via useSyncExternalStore (subscribe to the MediaQueryList,
// read `.matches`). Mirrors the flat top-level module style of motion.ts / ui.ts.
//
// `useIsNarrow` is the app's one responsive breakpoint: below the 768px `md` line the chat sidebar
// stops being inline and becomes an overlay drawer (Claude/ChatGPT desktop behavior). The 767.98px cap
// avoids a sub-pixel dead zone at exactly 768.
import { useSyncExternalStore } from 'react'

const NARROW_QUERY = '(max-width: 767.98px)'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false, // server/no-window fallback (never hit in Electron, keeps the API total)
  )
}

/** True when the window is narrow enough to swap the inline sidebar for the overlay drawer. */
export function useIsNarrow(): boolean {
  return useMediaQuery(NARROW_QUERY)
}
