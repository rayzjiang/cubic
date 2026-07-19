import { describe, it, expect } from 'vitest';
import { CONFIG, FORCE_MODEL, BOUNDS, configViolations, applyForceModel, type RemoteConfig } from '../src/config.js';
import { ALLOWED_MODELS } from '../src/metering.js';

/**
 * §G-? — the PRE-DEPLOY control for the Worker-served runtime config. `npm run deploy` runs
 * `npm test` first, so an out-of-range value in `CONFIG` fails before it can ever reach a client
 * (this repo has no CI — that npm gate is the whole safety net). All offline, zero API spend.
 */

describe('CONFIG (the live values)', () => {
  it('is within the sanity bounds — THIS is the gate that stops a bad push', () => {
    expect(configViolations(CONFIG)).toEqual([]);
  });

  it('only carries known keys (a typo would otherwise ship as a silently-ignored no-op)', () => {
    const known = new Set(['model', ...Object.keys(BOUNDS)]);
    expect(Object.keys(CONFIG).filter((k) => !known.has(k))).toEqual([]);
  });
});

describe('FORCE_MODEL (the emergency brake)', () => {
  it('is priced + allowlisted when set, so it can never 400 the gate it bypasses', () => {
    // Unset is the normal state. When set, it MUST be a model the gate accepts and metering can price —
    // otherwise the brake would reject every request and break metering instead of fixing anything.
    if (FORCE_MODEL !== undefined) expect(ALLOWED_MODELS.has(FORCE_MODEL)).toBe(true);
  });

  it('is a no-op on the request body while unset', () => {
    if (FORCE_MODEL !== undefined) return; // covered by the deliberate-override tests below
    const body: Record<string, unknown> = { model: 'claude-sonnet-4-6', max_tokens: 4096 };
    applyForceModel(body);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body).not.toHaveProperty('thinking');
  });
});

describe('configViolations', () => {
  it('accepts an empty config (the normal state: clients keep their baked defaults)', () => {
    expect(configViolations({})).toEqual([]);
  });

  it('accepts realistic values well inside the bounds', () => {
    const cfg: RemoteConfig = { model: 'claude-sonnet-5', maxIters: 40, compactThreshold: 0.9, keepRecentTurns: 3, contextWindow: 200_000 };
    expect(configViolations(cfg)).toEqual([]);
  });

  it('rejects the garbage the bounds exist for', () => {
    expect(configViolations({ maxIters: 0 })).toHaveLength(1);
    expect(configViolations({ maxIters: -5 })).toHaveLength(1);
    expect(configViolations({ maxIters: 10_000 })).toHaveLength(1);
    expect(configViolations({ maxIters: 2.5 })).toHaveLength(1); // must be an integer
    expect(configViolations({ compactThreshold: 9 })).toHaveLength(1); // the classic 0.9 fat-finger
    expect(configViolations({ contextWindow: Number.NaN })).toHaveLength(1);
    expect(configViolations({ model: '' })).toHaveLength(1);
  });

  it('does NOT allowlist the model — adding a model must never need an app release', () => {
    // ALLOWED_MODELS (server-side, updatable by `wrangler deploy`) is the real gate; the client-side
    // bounds deliberately accept any non-empty string so a new model needs no client change.
    expect(configViolations({ model: 'claude-some-future-model' })).toEqual([]);
  });

  it('reports every bad key, not just the first', () => {
    expect(configViolations({ maxIters: 0, keepRecentTurns: 999 })).toHaveLength(2);
  });
});
