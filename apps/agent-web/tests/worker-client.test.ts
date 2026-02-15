// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSettings } from '@chatrave/shared-types';

const { createAgentRunnerMock } = vi.hoisted(() => ({
  createAgentRunnerMock: vi.fn(),
}));

vi.mock('@strudel/transpiler/transpiler.mjs', () => ({
  transpiler: (input: string) => {
    if (input.includes('__unknown__')) {
      throw new Error('__unknown__ is not defined');
    }
    if (input.includes('missingGlobal')) {
      throw new Error('missingGlobal is not defined');
    }
    if (input.includes('s("hh*8")\n  s("cp*2")')) {
      throw new Error('Unexpected token');
    }
    if (input.trim().endsWith('s("cp*2")')) {
      throw new Error('Unexpected end of input');
    }
    return { output: input };
  },
}));

vi.mock('@chatrave/jam-core', () => ({
  createAgentRunner: createAgentRunnerMock,
}));

const { createRunnerWorkerClient } = await import('../src/worker-client');

function buildSettings(): AgentSettings {
  return {
    schemaVersion: 1,
    provider: 'openrouter',
    model: 'moonshotai/kimi-k2.5',
    reasoningEnabled: true,
    reasoningMode: 'balanced',
    temperature: 0.3,
    apiKey: 'k',
  };
}

function setupCapturedApply(
  initialCode = 's("bd")',
  options?: { soundsAvailable?: string[]; exposeSoundMap?: boolean },
): {
  apply: (
    input: { change: { kind: 'patch' | 'full_code'; content: string } },
  ) => Promise<
    | { status: 'scheduled' | 'applied'; applyAt?: string; diagnostics?: string[] }
    | { status: 'rejected'; phase?: string; diagnostics?: string[]; unknownSymbols?: string[] }
  >;
  editor: { code: string; setCode: ReturnType<typeof vi.fn>; repl: { scheduler: { cps: number } } };
  handleEvaluate: ReturnType<typeof vi.fn>;
} {
  const handleEvaluate = vi.fn();
  const editor = {
    code: initialCode,
    setCode: vi.fn(),
    repl: { scheduler: { cps: 2 } },
  };
  let capturedApply:
    | ((
        input: { change: { kind: 'patch' | 'full_code'; content: string } },
      ) => Promise<
        | { status: 'scheduled' | 'applied'; applyAt?: string; diagnostics?: string[] }
        | { status: 'rejected'; phase?: string; diagnostics?: string[]; unknownSymbols?: string[] }
      >)
    | undefined;

  createAgentRunnerMock.mockImplementation((config: { applyStrudelChange: typeof capturedApply }) => {
    capturedApply = config.applyStrudelChange;
    return {
      sendUserMessage: vi.fn().mockResolvedValue({ turnId: 't', messageId: 'm' }),
      stopGeneration: vi.fn(),
      retryMessage: vi.fn().mockResolvedValue({ turnId: 't2', messageId: 'm2' }),
      resetContext: vi.fn(),
      subscribeToEvents: vi.fn().mockReturnValue(() => {}),
    };
  });

  createRunnerWorkerClient(buildSettings(), {
    started: true,
    handleEvaluate,
    handleTogglePlay: vi.fn(),
    editorRef: { current: editor },
  });

  if (!capturedApply) {
    throw new Error('Failed to capture applyStrudelChange');
  }

  const soundsAvailable = options?.soundsAvailable ?? ['bd', 'hh', 'cp', 'triangle'];
  const exposeSoundMap = options?.exposeSoundMap ?? true;
  (window as Window & { strudelMirror?: unknown }).strudelMirror = exposeSoundMap
    ? {
        repl: {
          soundMap: {
            get: () =>
              Object.fromEntries(soundsAvailable.map((name) => [name, { data: { type: 'sample' }, onTrigger: vi.fn() }])),
          },
        },
      }
    : { repl: {} };

  return { apply: capturedApply, editor, handleEvaluate };
}

describe('worker-client apply validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    localStorage.clear();
    delete (window as Window & { strudelMirror?: unknown }).strudelMirror;
  });

  it('rejects malformed stack code (missing comma) and keeps active code unchanged', async () => {
    const { apply, editor, handleEvaluate } = setupCapturedApply('s("bd")');
    const broken = `stack(
  s("bd*4"),
  s("hh*8")
  s("cp*2")
)`;

    const result = await apply({ change: { kind: 'full_code', content: broken } });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') {
      throw new Error('Expected rejected result');
    }
    expect(result.phase).toBe('validate');
    expect(result.diagnostics?.[0]).toContain('Unexpected token');
    expect(editor.code).toBe('s("bd")');
    expect(editor.setCode).not.toHaveBeenCalled();
    expect(handleEvaluate).not.toHaveBeenCalled();
  });

  it('rejects unclosed function call code', async () => {
    const { apply } = setupCapturedApply('s("bd")');
    const broken = `stack(
  s("bd*4"),
  s("hh*8"),
  s("cp*2")
`;

    const result = await apply({ change: { kind: 'full_code', content: broken } });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') {
      throw new Error('Expected rejected result');
    }
    expect(result.phase).toBe('validate');
    expect(result.diagnostics?.[0]).toContain('Unexpected end of input');
  });

  it('rejects invalid patch content before scheduling', async () => {
    const { apply, editor } = setupCapturedApply('s("bd")');
    const brokenPatch = `stack(
  s("hh*8")
  s("cp*2")
)`;

    const result = await apply({ change: { kind: 'patch', content: brokenPatch } });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') {
      throw new Error('Expected rejected result');
    }
    expect(result.phase).toBe('validate');
    expect(editor.code).toBe('s("bd")');
    expect(editor.setCode).not.toHaveBeenCalled();
  });

  it('extracts unknownSymbols from dry-run failures', async () => {
    const { apply } = setupCapturedApply('s("bd")');
    const result = await apply({ change: { kind: 'full_code', content: '__unknown__' } });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') {
      throw new Error('Expected rejected result');
    }
    expect(result.unknownSymbols).toBeUndefined();
    expect(result.diagnostics?.[0]).toContain('__unknown__ is not defined');
  });

  it('rejects sounds that are not currently loaded', async () => {
    const { apply, editor } = setupCapturedApply('s("bd")');
    const result = await apply({
      change: { kind: 'full_code', content: 'stack(s("bd*4"), s("definitely_not_a_sound"))' },
    });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') {
      throw new Error('Expected rejected result');
    }
    expect(result.phase).toBe('validate');
    expect(result.diagnostics).toEqual(['Unknown sound(s): definitely_not_a_sound']);
    expect(result.unknownSymbols).toEqual(['definitely_not_a_sound']);
    expect(editor.code).toBe('s("bd")');
  });

  it('rejects apply when loaded sound inventory is unavailable (fail-safe)', async () => {
    const { apply, editor } = setupCapturedApply('s("bd")', { exposeSoundMap: false });
    const result = await apply({
      change: { kind: 'full_code', content: 'stack(s("bd*4"), s("hh*8"), s("cp*2"))' },
    });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') {
      throw new Error('Expected rejected result');
    }
    expect(result.phase).toBe('validate');
    expect(result.diagnostics?.[0]).toContain('Loaded sound inventory unavailable');
    expect(result.unknownSymbols).toEqual(['bd', 'hh', 'cp']);
    expect(editor.code).toBe('s("bd")');
  });

  it('preserves undefined global variable diagnostics from dry-run validation', async () => {
    const { apply, editor } = setupCapturedApply('s("bd")');
    const result = await apply({
      change: { kind: 'full_code', content: 'stack(s("bd*4"), missingGlobal)' },
    });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') {
      throw new Error('Expected rejected result');
    }
    expect(result.phase).toBe('validate');
    expect(result.diagnostics).toEqual(['missingGlobal is not defined']);
    expect(editor.code).toBe('s("bd")');
  });

  it('schedules code that defines and uses local variables', async () => {
    const { apply, editor, handleEvaluate } = setupCapturedApply('s("bd")');
    const validWithDefs = `const kick = s("bd*4")
const hats = s("hh*8")
stack(kick, hats)`;

    const result = await apply({ change: { kind: 'full_code', content: validWithDefs } });
    expect(result.status).toBe('scheduled');
    vi.advanceTimersByTime(600);
    expect(editor.code).toBe(validWithDefs);
    expect(editor.setCode).toHaveBeenCalledWith(validWithDefs);
    expect(handleEvaluate).toHaveBeenCalledTimes(1);
  });

  it('accepts setcpm(120/4) on the first line and schedules apply', async () => {
    const { apply, editor, handleEvaluate } = setupCapturedApply('s("bd")');
    const withTempoFirstLine = `setcpm(120/4)
stack(
  s("bd*4"),
  s("hh*8")
)`;

    const result = await apply({ change: { kind: 'full_code', content: withTempoFirstLine } });
    expect(result.status).toBe('scheduled');
    vi.advanceTimersByTime(600);
    expect(editor.code).toBe(withTempoFirstLine);
    expect(editor.setCode).toHaveBeenCalledWith(withTempoFirstLine);
    expect(handleEvaluate).toHaveBeenCalledTimes(1);
  });

  it('schedules valid code and applies quantized update after delay', async () => {
    const { apply, editor, handleEvaluate } = setupCapturedApply('s("bd")');
    const valid = `stack(
  s("bd*4"),
  s("hh*8"),
  s("cp*2")
)`;

    const result = await apply({ change: { kind: 'full_code', content: valid } });
    expect(result.status).toBe('scheduled');
    if (result.status !== 'scheduled' && result.status !== 'applied') {
      throw new Error('Expected scheduled/applied result');
    }
    expect(result.applyAt).toBeTruthy();
    expect(editor.code).toBe('s("bd")');
    expect(editor.setCode).not.toHaveBeenCalled();

    vi.advanceTimersByTime(600);
    expect(editor.code).toBe(valid);
    expect(editor.setCode).toHaveBeenCalledWith(valid);
    expect(handleEvaluate).toHaveBeenCalledTimes(1);
  });

});
