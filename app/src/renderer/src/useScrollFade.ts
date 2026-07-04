import { useCallback, useRef } from 'react'

const FADE = '24px'

/**
 * Dynamic scroll-fade. Returns a callback ref for a scroll container that also carries the `scroll-fade`
 * class: it toggles that element's `--fade-top` / `--fade-bottom` CSS vars (0 ↔ 24px) from scroll
 * position, so a fade appears only on an edge that has clipped content — more above → fade the top ("scroll
 * up for more"), more below → fade the bottom ("scroll down for more"). Because the fade turns OFF at each
 * edge, the first/last row is always crisp when you reach it.
 *
 * Recomputes on scroll, viewport resize (ResizeObserver), and content growth (MutationObserver — e.g. a new
 * message streaming in or the list changing), rAF-coalesced. Purely presentational: sets style, never
 * triggers a React re-render, so it composes with a component's own scroll logic (see MessageList).
 */
export function useScrollFade<T extends HTMLElement>(): (el: T | null) => void {
  const teardown = useRef<(() => void) | null>(null)

  return useCallback((el: T | null) => {
    teardown.current?.()
    teardown.current = null
    if (!el) return

    const update = (): void => {
      const canScroll = el.scrollHeight - el.clientHeight > 1
      const atTop = el.scrollTop <= 1
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 1
      el.style.setProperty('--fade-top', canScroll && !atTop ? FADE : '0px')
      el.style.setProperty('--fade-bottom', canScroll && !atBottom ? FADE : '0px')
    }

    // Coalesce the bursty sources (scroll frames, streaming mutations) into one read/write per frame.
    let raf = 0
    const schedule = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        update()
      })
    }

    el.addEventListener('scroll', schedule, { passive: true })
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    const mo = new MutationObserver(schedule)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    update()

    teardown.current = () => {
      if (raf) cancelAnimationFrame(raf)
      el.removeEventListener('scroll', schedule)
      ro.disconnect()
      mo.disconnect()
    }
  }, [])
}
