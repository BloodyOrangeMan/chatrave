// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashString } from '@chatrave/agent-tools';
import { transpiler } from '@strudel/transpiler/transpiler.mjs';

vi.mock('@strudel/transpiler/transpiler.mjs', () => ({
  transpiler: vi.fn((code: string) => ({ output: code })),
}));

vi.mock('@chatrave/strudel-adapter', () => ({
  getReferenceSnapshot: vi.fn(async () => []),
  getSoundsSnapshot: vi.fn(() => []),
}));

import { createStrudelBridge } from '../src/index';

describe('applyStrudelChange runtime dry-run gate', () => {
  beforeEach(() => {
    (window as unknown as Record<string, unknown>).note = undefined;
  });

  it('rejects runtime method-chain failures before scheduling', async () => {
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
        content: 'const bass = { lfo(){ return {}; } };\n bass.lfo().lfospeed();\n bass',
      },
    });

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('Expected rejected result');
    expect(result.phase).toBe('validate');
    expect(result.diagnostics?.some((line) => line.includes('not a function'))).toBe(true);
  });

  it('rejects when runtime dry-run environment is unavailable', async () => {
    vi.mocked(transpiler).mockImplementationOnce(() => ({}) as never);
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
        content: 'const x = 1;\nx',
      },
    });

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('Expected rejected result');
    expect(result.phase).toBe('validate');
    expect(result.diagnostics?.some((line) => line.includes('RUNTIME_DRY_RUN_UNAVAILABLE'))).toBe(true);
  });

  it('schedules when runtime dry-run succeeds', async () => {
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
        content: 'const groove = 1;\n groove',
      },
    });

    expect(result.status).toBe('scheduled');
  });

  it('rejects unknown chord symbols in chord().voicing()', async () => {
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
        content: 'const chords = chord("Cmin~").voicing().s("triangle").lpf(800).room(0.3).gain(0.3)\nstack(chords)',
      },
    });

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('Expected rejected result');
    expect(result.phase).toBe('validate');
    expect(result.diagnostics?.some((line) => line.includes('unknown chord'))).toBe(true);
    expect(result.diagnostics?.some((line) => line.includes('Cmin~'))).toBe(true);
  });

});
