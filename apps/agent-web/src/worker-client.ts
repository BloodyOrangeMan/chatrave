import { createAgentRunner } from '@chatrave/jam-core';
import type { AgentSettings, ReplSnapshot, RunnerEvent } from '@chatrave/shared-types';
import type { ApplyStrudelChangeInput } from '@chatrave/jam-core';
import { getReferenceSnapshot, getSoundsSnapshot } from '@chatrave/strudel-adapter';
import { transpiler } from '@strudel/transpiler/transpiler.mjs';
import { readRuntimeOverrides } from './runtime-overrides';

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
  | {
      status: 'rejected';
      phase?: string;
      diagnostics?: string[];
      unknownSymbols?: string[];
      latestCode?: string;
      latestHash?: string;
      expectedBaseHash?: string;
    };

type StrudelWindow = Window & {
  strudelMirror?: {
    repl?: {
      state?: Record<string, unknown>;
      soundMap?: { get?: () => Record<string, unknown> | undefined };
      sounds?: Record<string, unknown>;
      start?: () => void;
      toggle?: () => void;
    };
  };
  soundMap?: { get?: () => Record<string, unknown> | undefined };
  __strudelSoundMap?: { get?: () => Record<string, unknown> | undefined } | Record<string, unknown>;
};

function extractSoundNames(code: string): string[] {
  const names = new Set<string>();
  const soundCallRegex = /\bs\s*\(([\s\S]*?)\)/g;
  let soundCallMatch: RegExpExecArray | null;

  while ((soundCallMatch = soundCallRegex.exec(code)) !== null) {
    const args = soundCallMatch[1] ?? '';
    const stringLiteralRegex = /(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g;
    let stringMatch: RegExpExecArray | null;
    while ((stringMatch = stringLiteralRegex.exec(args)) !== null) {
      const source = stringMatch[2] ?? '';
      const tokens = source
        .split(/\s+/)
        .map((token) =>
          token
            .trim()
            .replace(/[\[\]\(\)\{\}<>,|]/g, '')
            .replace(/[*:~].*$/, '')
            .replace(/^-+|-+$/g, ''),
        )
        .filter(Boolean);
      for (const token of tokens) {
        if (/^[a-zA-Z0-9_/-]+$/.test(token)) {
          names.add(token.toLowerCase());
        }
      }
    }
  }

  return Array.from(names);
}

function getLoadedSoundNames(): { ok: true; names: Set<string> } | { ok: false; reason: string } {
  const globalWindow = window as StrudelWindow;
  const candidates: Array<unknown> = [
    globalWindow.strudelMirror?.repl?.soundMap,
    globalWindow.strudelMirror?.repl?.state?.['soundMap'],
    globalWindow.__strudelSoundMap,
    globalWindow.soundMap,
    globalWindow.strudelMirror?.repl?.state?.['sounds'],
    globalWindow.strudelMirror?.repl?.sounds,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && 'get' in candidate && typeof candidate.get === 'function') {
      const mapValue = candidate.get();
      if (mapValue && typeof mapValue === 'object') {
        return { ok: true, names: new Set(Object.keys(mapValue).map((key) => key.toLowerCase())) };
      }
    }
    if (candidate && typeof candidate === 'object') {
      return { ok: true, names: new Set(Object.keys(candidate).map((key) => key.toLowerCase())) };
    }
  }

  return {
    ok: false,
    reason: 'Loaded sound inventory unavailable. Refusing apply in fail-safe mode.',
  };
}

const dryRunValidateChange = (
  code: string,
): { ok: true } | { ok: false; diagnostics: string[] } => {
  try {
    transpiler(code, { id: 'chatrave-shadow-dry-run' });
    return { ok: true };
  } catch (error) {
    const message = (error as Error).message || String(error);
    return {
      ok: false,
      // Keep Strudel transpiler error text unmodified for maximum fidelity.
      diagnostics: [message],
    };
  }
};

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
  const runtimeOverrides = readRuntimeOverrides();
  let knowledgeSourcesCache: {
    reference: Awaited<ReturnType<typeof getReferenceSnapshot>>;
    sounds: ReturnType<typeof getSoundsSnapshot>;
  } | null = null;
  const loadKnowledgeSources = async () => {
    if (knowledgeSourcesCache) {
      return knowledgeSourcesCache;
    }
    const [reference, sounds] = await Promise.all([getReferenceSnapshot(), Promise.resolve(getSoundsSnapshot())]);
    knowledgeSourcesCache = { reference, sounds };
    return knowledgeSourcesCache;
  };
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

  const applyStrudelChange = async (input: ApplyStrudelChangeInput): Promise<HostApplyResult> => {
    const editor = hostContext?.editorRef?.current;
    if (!editor) {
      throw new Error('Editor context unavailable');
    }
    const activeCode = editor.code ?? '';
    const activeHash = hashString(activeCode);
    if (input.baseHash !== activeHash) {
      return {
        status: 'rejected',
        phase: 'STALE_BASE_HASH',
        diagnostics: [`STALE_BASE_HASH: expected ${input.baseHash} but active hash is ${activeHash}`],
        latestCode: activeCode,
        latestHash: activeHash,
        expectedBaseHash: input.baseHash,
      };
    }

    const nextCode =
      input.change.kind === 'full_code'
        ? input.change.content
        : `${activeCode}\n${input.change.content}`;

    const dryRun = dryRunValidateChange(nextCode);
    if (!dryRun.ok) {
      return {
        status: 'rejected',
        phase: 'validate',
        diagnostics: dryRun.diagnostics,
      };
    }

    const referencedSounds = extractSoundNames(nextCode);
    if (referencedSounds.length > 0) {
      const loadedSounds = getLoadedSoundNames();
      if (!loadedSounds.ok) {
        return {
          status: 'rejected',
          phase: 'validate',
          diagnostics: [loadedSounds.reason],
          unknownSymbols: referencedSounds,
        };
      }
      const unknownSounds = referencedSounds.filter((name) => !loadedSounds.names.has(name));
      if (unknownSounds.length > 0) {
        return {
          status: 'rejected',
          phase: 'validate',
          diagnostics: [`Unknown sound(s): ${unknownSounds.join(', ')}`],
          unknownSymbols: unknownSounds,
        };
      }
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
    openRouterBaseUrl: runtimeOverrides.openRouterBaseUrl,
    openRouterExtraHeaders: runtimeOverrides.openRouterExtraHeaders,
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
    getKnowledgeSources: loadKnowledgeSources,
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
