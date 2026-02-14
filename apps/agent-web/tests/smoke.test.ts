// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { initAgentTab } from '../src';

describe('agent-web', () => {
  it('registers init function without throwing', () => {
    expect(() => initAgentTab()).not.toThrow();
  });
});
