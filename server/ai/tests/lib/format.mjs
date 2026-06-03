// Shared terminal formatting + cost reporting for the live (real-API) test scripts.
//
// Real runs spend the user's own API money, so these scripts call enableLlmIO() to turn on the
// provider's I/O logger (which prints every request → response → token usage → est. cost at the
// single chokepoint, including calls made deep inside the agent loop) and printCostTotal() to show
// a per-run dollar total. One implementation, identical output everywhere — no per-script copies.

import { getDebugCost } from '../../build/index.js';

export const bold   = s => `\x1b[1m${s}\x1b[0m`;
export const green  = s => `\x1b[32m${s}\x1b[0m`;
export const red    = s => `\x1b[31m${s}\x1b[0m`;
export const dim    = s => `\x1b[2m${s}\x1b[0m`;
export const cyan   = s => `\x1b[36m${s}\x1b[0m`;
export const yellow = s => `\x1b[33m${s}\x1b[0m`;

/** Turn on full model I/O logging (request + response + usage + cost) for this run. Must be called
 *  before the first chat() — the provider reads the flag at call time. */
export function enableLlmIO() {
  process.env.CUBIC_LLM_DEBUG = '1';
}

/** Print a one-line cost total for the run; warn (yellow) if it crossed a small $ ceiling so a
 *  misconfigured loop can't silently burn money. Reads the provider's debug tally. */
export function printCostTotal(ceilingUsd = 0.10) {
  const c = getDebugCost();
  const tok = (c.inputTokens + c.outputTokens + c.cacheReadTokens).toLocaleString();
  const line = `▶ ${c.calls} call${c.calls === 1 ? '' : 's'} · ${tok} tok · ~$${c.costUsd.toFixed(5)}`;
  console.log('\n' + (c.costUsd > ceilingUsd ? yellow(bold(`${line}  ⚠ over $${ceilingUsd.toFixed(2)} ceiling`)) : dim(line)));
}
