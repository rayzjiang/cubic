# 6/20 DONE VERIFIED, I THINK ITS GOOD ENOUGH - Taste Eval — does Cubic make motion a pro would ship?

> **Why this exists:** taste/style is the moat (Palmier went generative; precise editable AE motion graphics is
> our open lane, but only if the output is genuinely good). This is the protocol for the **Phase 5 §G-0 ship gate**.
> It is NOT a "does it work" test (we know it works) — it grades **does it look designed**, and **diagnoses where
> taste breaks** so the system-prompt grill can target the fix.

## The core idea: label every failure
Each failure is one of two buckets — labeling which is the most valuable output of this eval:
- **Judgment gap** — it COULD have done it right but chose wrong (linear ease, no stagger, bounced a corporate
  title). → system-prompt fix in `server/ai/src/prompt/rules.ts` `<motion_design_principles>`. The grill target.
- **Capability gap** — the tool/recipe physically can't do it (e.g. no motion-blur control). → code, defer post-mvp.

## Setup (one-time, ~5 min)
One AE project, identical start for every trial:
- Comp `1920x1080 @ 30fps`, 10s.
- Text layer: `Acne` (fake brand).
- Text layer: `Ship faster with AI` (tagline).
- Any logo PNG dropped in the project panel.
- Save as `taste-eval.aep`. Duplicate before each trial (or `restoreProject` / Cmd+Z between runs) so every trial is clean.

## How to run + verify ONE trial
1. Select the relevant layer(s) in AE (or nothing, to test its targeting).
2. Type the prompt in Cubic. Let it build.
3. **RAM preview (numpad 0).** Static keyframes lie — watch it move. (Agent reads values at playhead t=0; judging the
   static timeline will fool you.)
4. **Open the Graph Editor** on the animated props. A pro ease curve is a smooth S / sharp ease-out; a flat diagonal
   = linear = amateur tell. Five seconds here beats the preview.
5. Score against the rubric. Save the Cubic chat transcript.

## The 7 trials (easy → hard; taste breaks at the composition level)
- **T1 — "make the title pop in"** · ease + life. *Pass:* fast-in/slow-settle ease-out, slight overshoot then settle,
  scales from center (anchor right), ~0.3–0.5s. *Fail:* linear, no overshoot, scales from a corner, instant/sluggish.
- **T2 — "slide the logo in from the left, smooth"** · easing on position + timing. *Pass:* eased slide, sensible
  distance, clean settle. *Fail:* linear/robotic constant speed, no motion blur on the fast move.
- **T3 — "animate the headline, subhead, and logo in together"** · stagger + hierarchy (first real taste test).
  *Pass:* elements cascade ~0.05–0.1s apart, clear lead element. *Fail:* all-at-once, or random order with no rhythm.
- **T4 — "make this feel premium and subtle, it's a corporate launch"** · RESTRAINT (highest-signal test).
  *Pass:* dials DOWN — soft fades, gentle ease, minimal/no bounce. *Fail:* bouncy juice on a brief that said subtle.
  (Knowing when NOT to juice IS taste — where a primitive-only system usually fails.)
- **T5 — "animate the headline in word by word, kinetic typography"** · craft depth (text animators + range selectors).
  *Pass:* per-word reveal, eased offset + stagger. *Fail:* whole line as one block, or a crude opacity fade.
- **T6 — "make the title bounce"** · designed vs cartoonish. *Pass:* settle with 1–2 decaying overshoots (inertial),
  reads physical. *Fail:* one big linear scale-up, or an endless/over-amped wobble.
- **T7 — "build a 5-second product launch intro from scratch: animated logo, headline, subtle background"** ·
  composition-level COHERENCE (integration test). *Pass:* reads as one designed sequence with pacing + a through-line.
  *Fail:* a pile of independent effects, timing collisions, "technically animated, clearly not designed."

## Rubric — score each trial 0–2 on 6 dimensions
0 = wrong · 1 = acceptable · 2 = a pro would ship it.
1. **Easing** — no linear motion; ease-out on entrances; organic curves in the graph editor. *(#1 amateur-vs-pro tell.)*
2. **Timing/pacing** — snappy ~0.3–0.6s entrances; not instant, not sluggish.
3. **Life (overshoot/settle)** — appropriate moves overshoot-and-settle, not dead stops.
4. **Stagger & hierarchy** — multi-element cascades with a clear lead, not all-at-once.
5. **Restraint/fit** — matches the brief's tone (subtle when asked; not everything bouncing).
6. **Coherence** — reads as one designed sequence, not stacked independent effects.

Plus a binary **craft check** (flag breakage, not scored): scale stayed 3-element `[x,y,z]`, anchor sane, nothing visibly broken.

## The "good enough?" bar (= §G-0 gate)
- **Avg ≥1.5 across T1–T7, AND T4 + T7 both ≥1** → real taste; Phase 5 / ship justified.
- **T1–T2 strong but T3/T4/T7 weak** → likely outcome: *competent primitives, no composition taste.* Almost entirely
  a **judgment gap → prompt-fixable.** Good news — grill moves the needle without code.
- **Linear motion or broken props anywhere** → deeper (recipe defaults / capability). Flag it.

## What to bring to the grill (per trial)
1. The 6 scores + one-line gut call: "would I ship this? y/n."
2. The chat transcript.
3. Every failure labeled **judgment** vs **capability**.

Then we rewrite `<motion_design_principles>` to close the judgment gaps specifically (e.g. ease-out influence 75–90%
on entrances; stagger 0.05–0.1s; restraint rules — subtle/corporate briefs get fades not bounces; compose
multi-element builds with a lead element + cascade), and shelve capability gaps as post-mvp recipe work.
