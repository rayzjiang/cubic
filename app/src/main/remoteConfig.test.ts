import { describe, it, expect } from 'vitest'
import { validateConfig, CONFIG_ENV_VARS } from './remoteConfig.js'

/**
 * §G-? — the client-side guard on Worker-served config. This is what stands between a bad push (or a
 * hand-edited ~/.cubic/remote-config.json) and the agent loop, so the fallback semantics are asserted
 * here rather than left to the E2E. Offline, no fs, no network.
 */

describe('validateConfig', () => {
  it('passes through realistic values untouched', () => {
    const incoming = { model: 'claude-sonnet-5', maxIters: 40, compactThreshold: 0.9, keepRecentTurns: 3, contextWindow: 200_000 }
    const { config, rejected } = validateConfig(incoming)
    expect(config).toEqual(incoming)
    expect(rejected).toEqual([])
  })

  it('accepts any non-empty model string — adding a model must never need an app release', () => {
    // The Worker's ALLOWED_MODELS is the real gate. Allowlisting here would re-couple "add a model"
    // to shipping a new build, on the value most likely to change.
    expect(validateConfig({ model: 'claude-some-future-model' }).config.model).toBe('claude-some-future-model')
    expect(validateConfig({ model: '   ' }).rejected).toHaveLength(1)
  })

  it('rejects the garbage the bounds exist for, and reports each one', () => {
    const { config, rejected } = validateConfig({ maxIters: 0, compactThreshold: 9, keepRecentTurns: -1, contextWindow: Number.NaN })
    expect(config).toEqual({}) // nothing valid, nothing to fall back to → all baked defaults
    expect(rejected.map((r) => r.key).sort()).toEqual(['compactThreshold', 'contextWindow', 'keepRecentTurns', 'maxIters'])
  })

  it('accepts values at the generous bounds but not past them', () => {
    expect(validateConfig({ maxIters: 100 }).rejected).toEqual([])
    expect(validateConfig({ maxIters: 101 }).rejected).toHaveLength(1)
    expect(validateConfig({ maxIters: 2.5 }).rejected).toHaveLength(1) // must be an integer
  })

  it('falls back to the LAST GOOD value when a key is present but invalid', () => {
    // One bad push must not drop users all the way to the baked default — they keep what already worked.
    const previous = { model: 'claude-sonnet-5', maxIters: 40 }
    const { config, rejected } = validateConfig({ model: '', maxIters: 20 }, previous)
    expect(config).toEqual({ model: 'claude-sonnet-5', maxIters: 20 })
    expect(rejected).toEqual([{ key: 'model', value: '' }])
  })

  it('does NOT resurrect an ABSENT key from the cache — that is how you revert to the baked default', () => {
    const { config, rejected } = validateConfig({ maxIters: 20 }, { model: 'claude-sonnet-5', maxIters: 40 })
    expect(config).toEqual({ maxIters: 20 })
    expect(config.model).toBeUndefined()
    expect(rejected).toEqual([])
  })

  it('ignores unknown keys instead of forwarding them as env vars', () => {
    const { config, rejected } = validateConfig({ maxIters: 20, someFutureKey: 'x', __proto__: 'nope' })
    expect(config).toEqual({ maxIters: 20 })
    expect(rejected).toEqual([])
  })

  it('treats a non-object payload as no config at all', () => {
    for (const bad of [null, undefined, 'a string', 42]) {
      expect(validateConfig(bad).config).toEqual({})
    }
  })

  it('maps every key to the env var the backend child already reads', () => {
    // The apply path is just main setting these on childEnv — if a name drifts, the override silently
    // stops working with nothing failing, so pin them.
    expect(CONFIG_ENV_VARS).toEqual({
      model: 'CUBIC_MODEL',
      maxIters: 'CUBIC_MAX_ITERATIONS',
      compactThreshold: 'CUBIC_COMPACT_THRESHOLD',
      keepRecentTurns: 'CUBIC_KEEP_RECENT_TURNS',
      contextWindow: 'CUBIC_CONTEXT_WINDOW',
    })
  })
})
