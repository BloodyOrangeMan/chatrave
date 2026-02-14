import { createAgentRunner } from '@chatrave/jam-core';
import type { AgentSettings, ReplSnapshot, RunnerEvent } from '@chatrave/shared-types';

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
  subscribe(listener: (event: RunnerEvent) => void): () => void;
}

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
    policy?: { quantize: 'next_cycle' | 'next_bar' };
  }): Promise<{ status: 'scheduled' | 'applied'; applyAt?: string }> => {
    const editor = hostContext?.editorRef?.current;
    if (!editor) {
      throw new Error('Editor context unavailable');
    }

    const nextCode =
      input.change.kind === 'full_code'
        ? input.change.content
        : `${editor.code ?? ''}\n${input.change.content}`;

    const cps = editor.repl?.scheduler?.cps ?? 0.5;
    const cycleMs = Math.max(250, Math.round((1 / Math.max(0.1, cps)) * 1000));
    const delayMs = input.policy?.quantize === 'next_bar' ? cycleMs * 2 : cycleMs;
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
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
