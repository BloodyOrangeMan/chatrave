import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_SETTINGS } from '../src';

describe('shared-types defaults', () => {
  it('provides default settings', () => {
    expect(DEFAULT_AGENT_SETTINGS.provider).toBe('openrouter');
    expect(DEFAULT_AGENT_SETTINGS.reasoningEnabled).toBe(true);
  });
});
