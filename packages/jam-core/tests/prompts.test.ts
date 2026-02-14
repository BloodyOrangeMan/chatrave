import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/prompts/loader';

describe('system prompt builder', () => {
  it('renders all placeholders', async () => {
    const result = await buildSystemPrompt({
      vars: {
        MAX_REPAIR_ATTEMPTS: '4',
        GLOBAL_TOOL_BUDGET: '20',
      },
    });

    expect(result.unresolvedPlaceholders).toEqual([]);
    expect(result.prompt).toContain('MAX_REPAIR_ATTEMPTS=4');
    expect(result.prompt).toContain('GLOBAL_TOOL_BUDGET=20');
  });
});
