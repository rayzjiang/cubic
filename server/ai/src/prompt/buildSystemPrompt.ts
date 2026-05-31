import type { LiveAEState } from '../context/buildContext.js';
import type { SystemPrompt } from '../llm/types.js';
import { formatStateForPrompt } from '../context/format.js';
import { renderCommandCatalog } from './renderCatalog.js';
import { STATIC_RULES } from './rules.js';

/**
 * The static prefix: rules with the {{COMMAND_CATALOG}} placeholder replaced by
 * the generated command catalog. Computed once at module load — it never changes
 * between turns, so it forms a byte-stable, cacheable prompt prefix.
 */
const CACHED_RULES = STATIC_RULES.replace('{{COMMAND_CATALOG}}', renderCommandCatalog());

/**
 * Builds the split system prompt: stable `cached` rules+catalog (a cache
 * breakpoint) + per-turn `volatile` live AE state. See {@link SystemPrompt}.
 */
export function buildSystemPrompt(state: LiveAEState): SystemPrompt {
  return { cached: CACHED_RULES, volatile: formatStateForPrompt(state) };
}
