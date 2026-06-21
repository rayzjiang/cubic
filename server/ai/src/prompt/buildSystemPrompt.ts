import type { SystemPrompt } from '../llm/types.js';
import { renderCommandCatalog } from './renderCatalog.js';
import { STATIC_RULES } from './rules.js';

/**
 * The static prefix: rules with the {{COMMAND_CATALOG}} placeholder replaced by
 * the generated command catalog. Computed once at module load — it never changes
 * between turns, so it forms a byte-stable, cacheable prompt prefix.
 */
const CACHED_RULES = STATIC_RULES.replace('{{COMMAND_CATALOG}}', renderCommandCatalog());

/**
 * Builds the system prompt: the stable, cacheable `cached` rules+catalog block.
 * Per-turn live AE state is NOT included here — it rides at the tail of the message
 * stream (ChatOptions.liveState) so it never busts this cache. See {@link SystemPrompt}.
 */
export function buildSystemPrompt(): SystemPrompt {
  return { cached: CACHED_RULES };
}
