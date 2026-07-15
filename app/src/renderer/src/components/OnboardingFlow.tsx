import { useState } from 'react'
import { motion } from 'motion/react'
import { useChatStore } from '../store'
import { EASE_OUT } from '../motion'
import demo1Url from '../assets/onboarding/demo1.webp'
import demo2Url from '../assets/onboarding/demo2.webp'
import demo4Url from '../assets/onboarding/demo4.webp'
import cubicLogoUrl from '../assets/cubic-logo.svg'

/**
 * §D-1 — the pre-paywall first-run sequence. Shown once per account (App.tsx renders it as the whole
 * body when a signed-in user hasn't seen it), BEFORE the paywall — so a non-technical editor learns what
 * Cubic is and how it works before being asked for a card. Three fullscreen slides (What → Use-cases →
 * Ready + a heads-up that Cubic needs file access), a 3-square progress indicator, Next/Back + a subtle
 * Skip. Finishing or skipping marks it seen (localStorage, per user) → the router falls through to the
 * paywall. Copy + demo media are placeholders — P3c's §D-4 finalizes copy; a screenshot/short clip drops
 * into <DemoMedia/> later.
 */

const SLIDES: { title: string; body: string; media?: string }[] = [
  {
    title: 'Accelerate your After Effects workflow',
    body: 'Cubic is an AI agent for After Effects. It reads your project and builds anything you ask for, directly in your AE project. Everything stays manually editable and native to AE.',
    media: demo1Url,
  },
  {
    title: 'Complete understanding of your project',
    body: 'Cubic reads and fully understands your project: every composition, layer, property, expression, effect, and more. The same way a real editor would.',
    media: demo2Url,
  },
  {
    title: 'Animate faster than ever before',
    body: 'Smooth transitions. Bouncy keyframes. Satisfying overshoots.\nHours of manual work in AE, now done in seconds with Cubic.',
  },
  {
    title: 'Ready to get started?',
    body: 'One last thing: Cubic needs file access in After Effects to back up your project automatically, so every change stays undoable. We’ll guide you through it.',
    media: demo4Url,
  },
]

/** The per-slide demo media in a fixed 16:9 box. Every slide's media is stacked absolutely so the box is
 *  a CONSTANT height (the nav never shifts); only the active one is opaque, crossfading with the copy. A
 *  slide with no `media` shows the placeholder. Add more screenshots/clips by setting `media` on SLIDES. */
function DemoMedia({ step }: { step: number }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-white/4">
      {SLIDES.map((slide, i) => (
        <motion.div
          key={i}
          className="absolute inset-0 flex items-center justify-center"
          initial={false}
          animate={{ opacity: i === step ? 1 : 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          aria-hidden={i !== step}
        >
          {slide.media ? (
            <img src={slide.media} alt="" className="h-full w-full object-contain" />
          ) : (
            <span className="text-[12px] text-white/30">Demo coming soon</span>
          )}
        </motion.div>
      ))}
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
        <img src={cubicLogoUrl} alt="" className="mb-6 h-12 w-12" />
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

        {/* The demo box is a fixed 16:9 height (DemoMedia stacks the per-slide media absolutely), and the
            copy blocks are stacked in ONE grid cell (every child at col/row 1 → they overlap), so the
            container is ALWAYS as tall as the TALLEST slide — the nav below never shifts when a slide's
            description wraps to a different number of lines. Only the active block is opaque; it crossfades
            in. `whitespace-pre-line` lets a body use `\n` for a manual line break. */}
        <div className="flex w-full flex-col items-center text-center">
          <DemoMedia step={step} />
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
