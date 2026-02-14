import type { ReasoningEffort, ReasoningMode } from '@chatrave/shared-types';

export const DEFAULT_OPENROUTER_MODEL = 'moonshotai/kimi-2.5';

export function mapModeToEffort(mode: ReasoningMode): ReasoningEffort {
  if (mode === 'fast') return 'low';
  if (mode === 'deep') return 'high';
  return 'medium';
}
