import type { LiveAEState } from '../context/buildContext.js';
import { formatStateForPrompt } from '../context/format.js';
import { STATIC_RULES } from './rules.js';

export function buildSystemPrompt(state: LiveAEState): string {
  return `${STATIC_RULES}\n\n${formatStateForPrompt(state)}`;
}
