import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/system-prompt';

describe('buildSystemPrompt', () => {
  it('includes available skills names when provided', () => {
    const prompt = buildSystemPrompt(['Jazz', 'Techno']);
    expect(prompt).toContain('AVAILABLE SKILLS');
    expect(prompt).toContain('Jazz');
    expect(prompt).toContain('Techno');
  });

  it('omits available skills section when no skills exist', () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).not.toContain('AVAILABLE SKILLS');
  });
});
