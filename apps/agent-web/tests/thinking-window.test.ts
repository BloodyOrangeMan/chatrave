import { describe, expect, it } from 'vitest';
import { getThinkingPreview } from '../src/thinking-preview';

describe('thinking preview window', () => {
  it('returns full text when shorter than max chars', () => {
    expect(getThinkingPreview('short idea', 20)).toBe('short idea');
  });

  it('returns a tail window when text exceeds max chars', () => {
    const source = '0123456789abcdefghijklmnopqrstuvwxyz';
    expect(getThinkingPreview(source, 8)).toBe('...stuvwxyz');
  });

  it('trims leading whitespace from truncated tail', () => {
    const source = 'first part second part\n     latest tokens';
    expect(getThinkingPreview(source, 12)).toBe('...atest tokens');
  });
});
