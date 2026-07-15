import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { Renderer, Program, Mesh, Triangle } from 'ogl'

/**
 * §D-1 — the animated background behind the sign-in screen. A single full-screen WebGL fragment shader
 * (via `ogl`) draws sparse silver hairlines that flow, glow, and slowly morph — a premium, monochrome,
 * subtly-metallic feel (inspired by, not copied from, terax.app). It lives ONLY on the signed-out
 * AuthScreen, so it unmounts the instant you sign in → zero GPU cost in the running app.
 *
 * The lines: each pixel's vertical position is warped by a stack of sine WAVES (full per-layer control in
 * CONFIG), the line SPACING is bunched into loose groups (so gaps vary), and lines are drawn where that
 * coordinate crosses a line-center — with a soft halo for a glowing bloom. Each line is faded in and out
 * along its OWN length (drifting SEGMENTS keyed to the line), so parts of it appear/disappear with nothing
 * covering it. Wave params are seeded randomly each launch and slowly wander (`morph`); a `topoWarp` knob
 * bends toward topographic contour loops; a Gaussian brightens near the cursor.
 *
 * Perf: DPR capped, the RAF loop pauses on window blur / tab-hide, `prefers-reduced-motion` (or a WebGL
 * failure) swaps the canvas for a static gradient. Only ≤ MAX_WAVES waves; the topo fbm is skipped when off.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  EDIT HERE — tune the whole look in one place (re-tunes live on a dev reload).
 *  ───────────────────────────────────────────────────────────────────────────── */
const MAX_WAVES = 6 // shader-side cap; bump this + the shader compiles a larger array if you need more

const CONFIG = {
  // Base scrim (CSS, behind the canvas): a near-black layer that blurs + dims the macOS vibrancy so the
  // lines read. Higher opacity = less desktop bleeds through; blurPx = how soft what's behind looks.
  baseColor: '#08080a',
  baseOpacity: 0.9,
  blurPx: 44,

  // Line field:
  lineCount: 16, // how many hairlines across the height (LOWER = sparser, bigger gaps — this is the #9 look)
  thickness: 0.014, // crisp-core half-width, in line-spacing units (higher = thicker)
  lineColor: [0.8, 0.83, 0.88] as [number, number, number], // silver-white (keep it monochrome)
  lineGlow: 0.08, // soft glow-halo width around each line (0 = crisp, no bloom)
  lineGlowStrength: 0.5, // halo brightness — the Terax-like glow (0 = off)

  // Grouping — vary the gaps so lines bunch into loose groups instead of perfectly-even spacing
  // (0 = perfectly even). Keep grouping · groupScale · 2π < 1 or lines start to cross.
  grouping: 0.16,
  groupScale: 0.7, // roughly how many groups across the height
  groupSpeed: 0.04, // how fast the grouping drifts

  // Wave layers — each warps the vertical coordinate as: amplitude · sin(2π · frequency · x + phase) +
  // offset, its phase advancing at `speed`. This is the curve's full control set — add/remove/tune each
  // wave freely (up to MAX_WAVES).
  waves: [
    { amplitude: 0.16, frequency: 0.33, phase: 0.0, offset: 0.0, speed: 0.14 },
    { amplitude: 0.1, frequency: 0.59, phase: 1.3, offset: 0.0, speed: -0.11 },
    { amplitude: 0.06, frequency: 1.0, phase: 0.0, offset: 0.0, speed: 0.08 },
  ],
  driftSpeed: 1.0, // global multiplier on every wave's speed (slow/fast the whole flow at once)

  // Segments — instead of covering the lines with a shape, fade EACH line in and out along its OWN length,
  // so parts of a line appear/disappear and drift — never a dark circle passing over. Each line's fade is
  // decorrelated from its neighbors, so the gaps never line up into a visible blob.
  segmentAmount: 0.45, // how much of each line is faded out (0 = whole line always lit; higher = more gaps)
  segmentScale: 2.9, // how many segments along a line (higher = shorter, more frequent gaps)
  segmentSoftness: 0.45, // fade softness at the segment ends (higher = gentler, more natural fade)
  segmentSpeed: 0.1, // how fast the visible segments drift along the lines

  randomSeed: true, // slight per-launch variation: randomize each wave's starting phase + the start time
  morph: 0.3, // how much the wave params (amp/freq/phase/speed) wander over time — 0 = fixed shape

  topoWarp: 0.01, // 0 = flowing horizontal lines · 1 = nested topographic contour loops (off by default)
  topoScale: 2.5, // size of the topographic hills/valleys when topoWarp > 0

  // Pointer glow:
  glowRadius: 0.2, // glow falloff radius, in screen-heights (smaller = tighter light around the cursor)
  glowStrength: 2.0, // glow intensity (0 disables the hover glow)

  // Perf:
  dprCap: 1.5, // max device-pixel-ratio (retina would otherwise be 2×+ → fan spin)
}

const VERT = /* glsl */ `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }
`

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uMouseActive;

uniform float uLineCount;
uniform float uThickness;
uniform float uLineGlow;
uniform float uLineGlowStrength;
uniform vec3 uLineColor;

uniform float uGrouping;
uniform float uGroupScale;
uniform float uGroupSpeed;

uniform float uWaveCount;
uniform float uWaveAmp[${MAX_WAVES}];
uniform float uWaveFreq[${MAX_WAVES}];
uniform float uWavePhase[${MAX_WAVES}];
uniform float uWaveOffset[${MAX_WAVES}];

uniform float uSegAmount;
uniform float uSegScale;
uniform float uSegSoftness;
uniform float uSegSpeed;
uniform float uSegSeed;

uniform float uTopoWarp;
uniform float uTopoScale;

uniform float uGlowRadius;
uniform float uGlowStrength;

const float TAU = 6.28318530718;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}

void main(){
  float aspect = uResolution.x / uResolution.y;
  vec2 uv = vUv;
  vec2 p = vec2(uv.x * aspect, uv.y);

  // Stacked sine warp of the vertical coordinate. Per-layer params come from CONFIG.waves; their phase is
  // integrated (and gently morphed) on the CPU, so time enters purely through uWavePhase — no jumps.
  float warp = 0.0;
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    if (float(i) >= uWaveCount) break;
    warp += uWaveAmp[i] * sin(TAU * uWaveFreq[i] * p.x + uWavePhase[i]) + uWaveOffset[i];
  }
  float horiz = uv.y + warp;

  // Grouping — bunch the line spacing into loose groups so the gaps vary (not perfectly even). This warps
  // the coordinate as a function of itself, compressing lines in some bands and spreading them in others.
  horiz += uGrouping * sin(TAU * uGroupScale * horiz + 0.5 * p.x + uTime * uGroupSpeed);

  // Topographic mode: draw iso-contours of a 2D fbm field → nested map-like loops. Blended in by uTopoWarp
  // (skipped entirely when off so it costs nothing at 0).
  float field = horiz;
  if (uTopoWarp > 0.001) {
    float topo = fbm(p * uTopoScale + vec2(uTime * 0.02, uTime * 0.015));
    field = mix(horiz, topo, uTopoWarp);
  }

  float coord = field * uLineCount;
  float d = abs(fract(coord) - 0.5);                       // distance to the nearest line center
  float aa = 1.5 * uLineCount / uResolution.y + 0.0015;    // ~1.5px anti-alias, in line-spacing units
  float core = 1.0 - smoothstep(uThickness, uThickness + aa, d);          // crisp bright core
  float halo = 1.0 - smoothstep(uThickness, uThickness + uLineGlow, d);   // wide soft glow
  float lineShape = core + halo * uLineGlowStrength;

  // Segments — fade each line in/out ALONG its own length (keyed to the line index + position along it),
  // so parts of a line appear/disappear and drift, with NO shape occluding it. Adjacent lines sample a
  // decorrelated noise slice (lineId offset), so the gaps never line up into a visible 2D blob.
  float lineId = floor(coord);
  float seg = noise(vec2(p.x * uSegScale + uTime * uSegSpeed + uSegSeed, lineId * 2.7 + uSegSeed));
  float vis = smoothstep(uSegAmount, uSegAmount + uSegSoftness, seg);
  lineShape *= vis;

  // Subtle metallic brightness variation along the lines.
  float sheen = 0.65 + 0.35 * noise(vec2(uv.x * 2.0 + uTime * 0.014, uv.y * 1.2));

  // Pointer glow — brighten lines within a soft Gaussian radius of the cursor.
  vec2 m = vec2(uMouse.x * aspect, uMouse.y);
  float dist = distance(p, m);
  float glow = exp(-(dist * dist) / (uGlowRadius * uGlowRadius)) * uGlowStrength * uMouseActive;

  // Cursor glow only brightens the LINES (a multiplier on lineShape) — no additive background halo.
  float intensity = lineShape * sheen * (0.5 + glow * 1.6);
  intensity = clamp(intensity, 0.0, 1.0);

  // Dither: a smooth glow gradient over a near-black base bands into visible rings at each 1/255 color
  // step, so add ±1 LSB of per-pixel noise to break the bands → continuous, real-light-looking falloff.
  intensity += (hash(gl_FragCoord.xy) - 0.5) * (2.0 / 255.0);

  gl_FragColor = vec4(uLineColor, intensity);   // silver lines on transparent → the CSS scrim shows through
}
`

export function AuthBackground() {
  const reduce = useReducedMotion() ?? false
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (reduce) return
    const canvas = canvasRef.current
    if (!canvas) return

    try {
      const renderer = new Renderer({ canvas, alpha: true, dpr: Math.min(CONFIG.dprCap, window.devicePixelRatio || 1) })
      const gl = renderer.gl

      // ── Wave setup: base params + a random per-launch seed + phase accumulators (integrated on CPU). ──
      const waves = CONFIG.waves.slice(0, MAX_WAVES)
      const count = waves.length
      const seed = CONFIG.randomSeed ? Math.random() * 1000 : 0
      // Deterministic-from-seed pseudo-random in [0,1) so each wave gets a stable per-launch phase offset.
      const rand = (i: number): number => {
        const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453
        return x - Math.floor(x)
      }
      const randPhase = waves.map((_, i) => (CONFIG.randomSeed ? rand(i) * Math.PI * 2 : 0))
      // Per-launch segment offset — shifts where each line's gaps fall so the arrangement varies a little
      // between launches, while the fade amount stays consistent (never all-lit / all-dark).
      const segSeed = CONFIG.randomSeed ? rand(101) * 50 : 0
      const phaseAccum = new Array(count).fill(0) as number[]
      // Slow smooth wobble in ~[-1,1] driving the live param morph (distinct per wave + channel k).
      const wob = (i: number, t: number, k: number): number => {
        const s = seed + i * 1.7 + k * 4.3
        return 0.6 * Math.sin(t * (0.11 + k * 0.017) + s) + 0.4 * Math.sin(t * (0.043 + k * 0.009) + s * 1.7)
      }
      const pad = (arr: number[]): number[] => {
        const a = new Array(MAX_WAVES).fill(0) as number[]
        for (let i = 0; i < count; i++) a[i] = arr[i]
        return a
      }

      const program = new Program(gl, {
        vertex: VERT,
        fragment: FRAG,
        uniforms: {
          uTime: { value: 0 },
          uResolution: { value: [1, 1] },
          uMouse: { value: [0.5, 0.5] },
          uMouseActive: { value: 0 },
          uLineCount: { value: CONFIG.lineCount },
          uThickness: { value: CONFIG.thickness },
          uLineGlow: { value: CONFIG.lineGlow },
          uLineGlowStrength: { value: CONFIG.lineGlowStrength },
          uLineColor: { value: CONFIG.lineColor },
          uGrouping: { value: CONFIG.grouping },
          uGroupScale: { value: CONFIG.groupScale },
          uGroupSpeed: { value: CONFIG.groupSpeed },
          uWaveCount: { value: count },
          uWaveAmp: { value: pad(waves.map((w) => w.amplitude)) },
          uWaveFreq: { value: pad(waves.map((w) => w.frequency)) },
          uWavePhase: { value: pad(waves.map((w, i) => w.phase + randPhase[i])) },
          uWaveOffset: { value: pad(waves.map((w) => w.offset)) },
          uSegAmount: { value: CONFIG.segmentAmount },
          uSegScale: { value: CONFIG.segmentScale },
          uSegSoftness: { value: CONFIG.segmentSoftness },
          uSegSpeed: { value: CONFIG.segmentSpeed },
          uSegSeed: { value: segSeed },
          uTopoWarp: { value: CONFIG.topoWarp },
          uTopoScale: { value: CONFIG.topoScale },
          uGlowRadius: { value: CONFIG.glowRadius },
          uGlowStrength: { value: CONFIG.glowStrength },
        },
      })
      const mesh = new Mesh(gl, { geometry: new Triangle(gl), program })

      const resize = (): void => {
        const parent = canvas.parentElement
        const w = parent?.clientWidth || window.innerWidth
        const h = parent?.clientHeight || window.innerHeight
        renderer.setSize(w, h)
        program.uniforms.uResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight]
      }
      resize()
      window.addEventListener('resize', resize)

      // Pointer glow: ease current → target so it trails the cursor; decay when the pointer leaves.
      const tgt = { x: 0.5, y: 0.5, a: 0 }
      const cur = { x: 0.5, y: 0.5, a: 0 }
      const onMove = (e: PointerEvent): void => {
        const r = canvas.getBoundingClientRect()
        tgt.x = (e.clientX - r.left) / r.width
        tgt.y = 1 - (e.clientY - r.top) / r.height
        tgt.a = 1
      }
      const onLeave = (): void => {
        tgt.a = 0
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerleave', onLeave)

      let raf = 0
      let running = true
      let last = 0
      let elapsed = CONFIG.randomSeed ? Math.random() * 200 : 0 // random start point → not the same every launch
      const frame = (now: number): void => {
        if (!running) return
        if (!last) last = now
        const dt = Math.min(0.05, (now - last) / 1000) // cap dt so a resume doesn't jump the animation
        last = now
        elapsed += dt

        // Advance + gently morph each wave (phase integrated so a changing speed never jumps the curve).
        const amp = new Array(MAX_WAVES).fill(0) as number[]
        const freq = new Array(MAX_WAVES).fill(0) as number[]
        const phase = new Array(MAX_WAVES).fill(0) as number[]
        for (let i = 0; i < count; i++) {
          const m = CONFIG.morph
          const effSpeed = waves[i].speed * CONFIG.driftSpeed * (1 + m * wob(i, elapsed, 2) * 0.5)
          phaseAccum[i] += effSpeed * dt
          amp[i] = waves[i].amplitude * (1 + m * wob(i, elapsed, 0) * 0.4)
          freq[i] = waves[i].frequency * (1 + m * wob(i, elapsed, 1) * 0.25)
          phase[i] = waves[i].phase + randPhase[i] + phaseAccum[i] + m * wob(i, elapsed, 3) * 0.6
        }
        program.uniforms.uWaveAmp.value = amp
        program.uniforms.uWaveFreq.value = freq
        program.uniforms.uWavePhase.value = phase

        cur.x += (tgt.x - cur.x) * 0.06
        cur.y += (tgt.y - cur.y) * 0.06
        cur.a += (tgt.a - cur.a) * 0.08
        program.uniforms.uTime.value = elapsed
        program.uniforms.uMouse.value = [cur.x, cur.y]
        program.uniforms.uMouseActive.value = cur.a
        renderer.render({ scene: mesh })
        raf = requestAnimationFrame(frame)
      }
      const start = (): void => {
        if (!running) {
          running = true
          last = 0
          raf = requestAnimationFrame(frame)
        }
      }
      const stop = (): void => {
        running = false
        cancelAnimationFrame(raf)
        tgt.a = 0
      }
      const onVisibility = (): void => (document.hidden ? stop() : start())
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('blur', stop)
      window.addEventListener('focus', start)
      raf = requestAnimationFrame(frame)

      return () => {
        cancelAnimationFrame(raf)
        window.removeEventListener('resize', resize)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerleave', onLeave)
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('blur', stop)
        window.removeEventListener('focus', start)
        gl.getExtension('WEBGL_lose_context')?.loseContext()
      }
    } catch {
      setFailed(true) // WebGL unavailable → the static fallback below renders instead
      return
    }
  }, [reduce])

  // Reduced motion OR a WebGL failure → a calm static gradient (no canvas, no loop).
  if (reduce || failed) {
    return (
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 90% at 50% 0%, #14141a 0%, ${CONFIG.baseColor} 62%)`,
          opacity: CONFIG.baseOpacity,
          backdropFilter: `blur(${CONFIG.blurPx}px)`,
          WebkitBackdropFilter: `blur(${CONFIG.blurPx}px)`,
        }}
      />
    )
  }

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Base scrim: blurs + dims the vibrancy so the lines read (keeps a hint of translucency). */}
      <div
        className="absolute inset-0"
        style={{
          background: CONFIG.baseColor,
          opacity: CONFIG.baseOpacity,
          backdropFilter: `blur(${CONFIG.blurPx}px)`,
          WebkitBackdropFilter: `blur(${CONFIG.blurPx}px)`,
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  )
}
