// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('@strudel/transpiler/transpiler.mjs', () => ({
  transpiler: (input: string) => ({ output: input }),
}));

const { initAgentTab } = await import('../src');

describe('agent-web', () => {
  it('registers init function without throwing', () => {
    expect(() => initAgentTab()).not.toThrow();
  });
});
