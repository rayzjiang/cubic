import { useState } from 'react'
import { motion } from 'motion/react'
import { useChatStore } from '../store'
import { EASE_OUT } from '../motion'

/**
 * §D-1 — the pre-paywall first-run sequence. Shown once per account (App.tsx renders it as the whole
 * body when a signed-in user hasn't seen it), BEFORE the paywall — so a non-technical editor learns what
 * Cubic is and how it works before being asked for a card. Three fullscreen slides (What → Use-cases →
 * Ready + a heads-up that Cubic needs file access), a 3-square progress indicator, Next/Back + a subtle
 * Skip. Finishing or skipping marks it seen (localStorage, per user) → the router falls through to the
 * paywall. Copy + demo media are placeholders — P3c's §D-4 finalizes copy; a screenshot/short clip drops
 * into <DemoMedia/> later.
 */

const SLIDES = [
  {
    title: 'Accelerate your After Effects workflow',
    body: 'Cubic is an AI editor for After Effects. Prompt it with the changes you want, and Cubic builds it directly in your AE project.',
  },
  {
    title: 'Restyle, redesign, reanimate',
    body: 'Ask for smooth transitions, keyframes, graph edits — tedious edits that used to mean digging through AE. \nWith Cubic, effortlessly get it done in seconds.',
  },
  {
    title: 'You’re all set',
    body: 'One quick thing after you subscribe: Cubic needs file access in After Effects to save frames and keep automatic backups (so you can undo Cubic’s changes). We’ll walk you through it.',
  },
]

/** Per-slide media slot — a placeholder rectangle today; swap in an <img>/<video> later with no layout
 *  change (fixed 16:9). */
function DemoMedia() {
  return (
    <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-white/10 bg-white/4">
      <span className="text-[12px] text-white/30">Demo coming soon</span>
    </div>
  )
}

export function OnboardingFlow() {
  const markOnboardingSeen = useChatStore((s) => s.markOnboardingSeen)
  // Reopened via Back from the paywall → resume on the last slide; a genuine first run starts at slide 1.
  const resumeAtEnd = useChatStore((s) => s.onboardingResumeAtEnd)
  const [step, setStep] = useState(resumeAtEnd ? SLIDES.length - 1 : 0)
  const isLast = step === SLIDES.length - 1

  const next = (): void => {
    if (isLast) markOnboardingSeen()
    else setStep((s) => s + 1)
  }
  const back = (): void => setStep((s) => Math.max(0, s - 1))

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-neutral-950 px-8 [-webkit-app-region:drag]">
      {/* Soft premium glow (matches FullscreenPaywall). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 55% 45% at 50% 38%, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0) 70%)' }}
      />

      {/* Skip — top-right, always available. */}
      <button
        onClick={markOnboardingSeen}
        className="absolute right-5 top-11 z-10 text-[12px] text-white/35 [-webkit-app-region:no-drag] hover:text-white/60"
      >
        Skip
      </button>

      <div className="relative flex w-full max-w-lg flex-col items-center [-webkit-app-region:no-drag]">
        {/* 3-square progress indicator. */}
        <div className="mb-8 flex gap-2">
          {SLIDES.map((_, i) => (
            <motion.span
              key={i}
              className="h-2.5 w-2.5 rounded-xs"
              animate={{ backgroundColor: i <= step ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.15)' }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
            />
          ))}
        </div>

        {/* The media is identical across slides (only the copy changes), so it sits still. All three copy
            blocks are stacked in ONE grid cell (every child at col/row 1 → they overlap), so the container
            is ALWAYS as tall as the TALLEST slide — the nav below never shifts when a slide's description
            wraps to a different number of lines (the longest slide sets the height for all). Only the
            active block is opaque; it crossfades in. `whitespace-pre-line` lets a body use `\n` for a
            manual line break. */}
        <div className="flex w-full flex-col items-center text-center">
          <DemoMedia />
          <div className="mt-8 grid w-full grid-cols-1">
            {SLIDES.map((slide, i) => (
              <motion.div
                key={i}
                className="col-start-1 row-start-1 flex flex-col items-center text-center"
                initial={false}
                animate={{ opacity: i === step ? 1 : 0 }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
                aria-hidden={i !== step}
                style={{ pointerEvents: i === step ? 'auto' : 'none' }}
              >
                <h1 className="text-[24px] font-semibold tracking-tight text-white/90">{slide.title}</h1>
                <p className="mx-auto mt-2 max-w-md whitespace-pre-line text-[13.5px] leading-relaxed text-white/55">{slide.body}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Nav — Back (hidden on step 0) + Next / Get started. */}
        <div className="mt-10 flex w-full items-center justify-between">
          <button
            onClick={back}
            className={`text-[13px] text-white/45 hover:text-white/70 ${step === 0 ? 'pointer-events-none opacity-0' : ''}`}
          >
            Back
          </button>
          <button
            onClick={next}
            className="rounded-lg bg-white px-5 py-2.5 text-[13px] font-medium text-neutral-900 hover:bg-white/90"
          >
            {isLast ? 'Get started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
