// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { hashString } from '@chatrave/agent-tools';

vi.mock('@strudel/transpiler/transpiler.mjs', () => ({
  transpiler: vi.fn(() => ({})),
}));

vi.mock('@chatrave/strudel-adapter', () => ({
  getReferenceSnapshot: vi.fn(async () => []),
  getSoundsSnapshot: vi.fn(() => []),
}));

import { createStrudelBridge } from '../src/index';

describe('applyStrudelChange semantic gate', () => {
  it('rejects invalid chord().voicing() symbols before scheduling', async () => {
    const editor = {
      code: 'setcpm(120/4)\nstack(s("bd*4"))',
      repl: { scheduler: { cps: 0.5 } },
      setCode: vi.fn(),
    };

    const bridge = createStrudelBridge({
      editorRef: { current: editor },
      handleEvaluate: vi.fn(),
    });

    const result = await bridge.applyStrudelChange({
      baseHash: hashString(editor.code),
      change: {
        kind: 'full_code',
        content: 'setcpm(128/4)\nconst c = chord("<c2m g1M>").voicing()\nstack(c)',
      },
    });

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('Expected rejected result');
    expect(result.phase).toBe('validate');
    expect(result.diagnostics?.some((line) => line.includes('INVALID_CHORD_VOICING_SYMBOL'))).toBe(true);
  });

  it('rejects unresolved param identifiers with NON_FINITE_PARAM_RISK', async () => {
    const editor = {
      code: 'setcpm(120/4)\nstack(s("bd*4"))',
      repl: { scheduler: { cps: 0.5 } },
      setCode: vi.fn(),
    };

    const bridge = createStrudelBridge({
      editorRef: { current: editor },
      handleEvaluate: vi.fn(),
    });

    const result = await bridge.applyStrudelChange({
      baseHash: hashString(editor.code),
      change: {
        kind: 'full_code',
        content: 'setcpm(128/4)\nconst b = note("c2").s("sawtooth").lpf(200 + saw.slow(8).range(100, 600))\nstack(b)',
      },
    });

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('Expected rejected result');
    expect(result.phase).toBe('validate');
    expect(result.diagnostics?.some((line) => line.includes('NON_FINITE_PARAM_RISK'))).toBe(true);
  });
});
