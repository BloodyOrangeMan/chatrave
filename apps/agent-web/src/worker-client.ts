import { createAgentRunner } from '@chatrave/jam-core';
import type { AgentSettings, ReplSnapshot, RunnerEvent } from '@chatrave/shared-types';
import { transpiler } from '@strudel/transpiler';

export interface AgentHostContext {
  started?: boolean;
  handleEvaluate?: () => void;
  handleTogglePlay?: () => void;
  editorRef?: { current?: { code?: string; repl?: { scheduler?: { cps?: number } } } };
}

export interface RunnerWorkerClient {
  send(text: string): void;
  stop(turnId?: string): void;
  retry(messageId: string): void;
  resetContext(options?: { omitRuntimeContext?: boolean }): void;
  subscribe(listener: (event: RunnerEvent) => void): () => void;
}

type HostApplyResult =
  | { status: 'scheduled' | 'applied'; applyAt?: string; diagnostics?: string[] }
  | { status: 'rejected'; phase?: string; diagnostics?: string[]; unknownSymbols?: string[] };

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function buildSnapshot(hostContext?: AgentHostContext): ReplSnapshot {
  const activeCode = hostContext?.editorRef?.current?.code ?? '';
  const cps = hostContext?.editorRef?.current?.repl?.scheduler?.cps;

  return {
    activeCodeHash: hashString(activeCode),
    started: Boolean(hostContext?.started),
    cps: typeof cps === 'number' ? cps : undefined,
    cpm: typeof cps === 'number' ? cps * 60 : undefined,
    quantizeMode: 'next_cycle',
  };
}

export function createRunnerWorkerClient(settings: AgentSettings, hostContext?: AgentHostContext): RunnerWorkerClient {
  const isStarted = (): boolean => {
    if (hostContext?.started) {
      return true;
    }
    try {
      const started = (window as Window & { strudelMirror?: { repl?: { state?: { started?: boolean } } } }).strudelMirror
        ?.repl?.state?.started;
      return Boolean(started);
    } catch {
      return false;
    }
  };

  const tryStartPlayback = (): void => {
    hostContext?.handleTogglePlay?.();
    if (isStarted()) {
      return;
    }
    try {
      const repl = (window as Window & { strudelMirror?: { repl?: { start?: () => void; toggle?: () => void } } })
        .strudelMirror?.repl;
      repl?.start?.();
      repl?.toggle?.();
    } catch {
      // fall through to button click fallback
    }
    if (isStarted()) {
      return;
    }

    const playButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.trim().toLowerCase() === 'play' || button.textContent?.trim() === '...',
    );
    if (playButton instanceof HTMLButtonElement) {
      playButton.click();
    }
  };

  const applyStrudelChange = async (input: {
    change: { kind: 'patch' | 'full_code'; content: string };
  }): Promise<HostApplyResult> => {
    const editor = hostContext?.editorRef?.current;
    if (!editor) {
      throw new Error('Editor context unavailable');
    }

    const nextCode =
      input.change.kind === 'full_code'
        ? input.change.content
        : `${editor.code ?? ''}\n${input.change.content}`;

    const dryRun = dryRunValidateChange(nextCode);
    if (!dryRun.ok) {
      return {
        status: 'rejected',
        phase: 'validate',
        diagnostics: dryRun.diagnostics,
        unknownSymbols: dryRun.unknownSymbols,
      };
    }

    const cps = editor.repl?.scheduler?.cps ?? 0.5;
    const cycleMs = Math.max(250, Math.round((1 / Math.max(0.1, cps)) * 1000));
    const delayMs = cycleMs;
    const applyAt = new Date(Date.now() + delayMs).toISOString();

    setTimeout(() => {
      editor.code = nextCode;
      if (typeof (editor as { setCode?: (code: string) => void }).setCode === 'function') {
        (editor as { setCode: (code: string) => void }).setCode(nextCode);
      }
      hostContext?.handleEvaluate?.();
      if (!isStarted()) {
        tryStartPlayback();
      }
    }, delayMs);

    return { status: 'scheduled', applyAt };
  };

  const runner = createAgentRunner({
    settings,
    modelTimeoutMs: 120_000,
    getReplSnapshot: () => buildSnapshot(hostContext),
    readCode: async (input) => {
      const activeCode = hostContext?.editorRef?.current?.code ?? '';
      if (input.path === 'active' || !input.path) {
        return {
          path: 'active',
          code: activeCode,
          hash: hashString(activeCode),
          lineCount: activeCode ? activeCode.split('\n').length : 0,
        };
      }
      return {
        path: input.path,
        code: '',
        hash: '',
        lineCount: 0,
      };
    },
    applyStrudelChange,
  });

  const listeners = new Set<(event: RunnerEvent) => void>();

  runner.subscribeToEvents((event) => {
    for (const listener of listeners) {
      listener(event);
    }
  });

  return {
    send(text) {
      void runner.sendUserMessage(text);
    },
    stop(turnId) {
      runner.stopGeneration(turnId);
    },
    retry(messageId) {
      void runner.retryMessage(messageId);
    },
    resetContext(options) {
      runner.resetContext(options);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
  const dryRunValidateChange = (
    code: string,
  ): { ok: true } | { ok: false; diagnostics: string[]; unknownSymbols: string[] } => {
    try {
      transpiler(code, { id: 'chatrave-shadow-dry-run' });
      return { ok: true };
    } catch (error) {
      const message = (error as Error).message || String(error);
      const unknownSymbols = /is not defined/i.test(message)
        ? [message.match(/([A-Za-z_][A-Za-z0-9_]*) is not defined/i)?.[1] ?? 'unknown']
        : [];
      return {
        ok: false,
        diagnostics: [`DRY_RUN_VALIDATE_FAILED: ${message}`],
        unknownSymbols,
      };
    }
  };
