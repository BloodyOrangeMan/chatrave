import { hashString, type ApplyStrudelChangeInput, type ReadCodeInput } from '@chatrave/agent-tools';
import { getReferenceSnapshot, getSoundsSnapshot } from '@chatrave/strudel-adapter';
import { transpiler } from '@strudel/transpiler/transpiler.mjs';
import type { ReplSnapshot } from '@chatrave/shared-types';

export interface AgentHostContext {
  started?: boolean;
  handleEvaluate?: () => void;
  handleTogglePlay?: () => void;
  editorRef?: { current?: { code?: string; repl?: { scheduler?: { cps?: number } }; setCode?: (code: string) => void } };
}

type ApplyResult =
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

  return { ok: false, reason: 'Loaded sound inventory unavailable. Refusing apply in fail-safe mode.' };
}

function dryRunValidate(code: string): { ok: true } | { ok: false; diagnostics: string[] } {
  try {
    transpiler(code, { id: 'chatrave-shadow-dry-run' });
    return { ok: true };
  } catch (error) {
    return { ok: false, diagnostics: [(error as Error).message || String(error)] };
  }
}

function countMatchesLiteral(input: string, search: string): number {
  if (!search) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = input.indexOf(search, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + search.length;
  }
}

function isStarted(hostContext?: AgentHostContext): boolean {
  if (hostContext?.started) return true;
  try {
    const started = (window as Window & { strudelMirror?: { repl?: { state?: { started?: boolean } } } }).strudelMirror?.repl
      ?.state?.started;
    return Boolean(started);
  } catch {
    return false;
  }
}

function tryStartPlayback(hostContext?: AgentHostContext): void {
  hostContext?.handleTogglePlay?.();
  if (isStarted(hostContext)) return;
  try {
    const repl = (window as Window & { strudelMirror?: { repl?: { start?: () => void; toggle?: () => void } } }).strudelMirror
      ?.repl;
    repl?.start?.();
    repl?.toggle?.();
  } catch {
    // fallback below
  }
  if (isStarted(hostContext)) return;

  const playButton = Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent?.trim().toLowerCase() === 'play' || button.textContent?.trim() === '...',
  );
  if (playButton instanceof HTMLButtonElement) {
    playButton.click();
  }
}

export function createStrudelBridge(hostContext?: AgentHostContext) {
  let knowledgeCache: {
    reference: Awaited<ReturnType<typeof getReferenceSnapshot>>;
    sounds: ReturnType<typeof getSoundsSnapshot>;
  } | null = null;

  async function loadKnowledgeSources() {
    if (knowledgeCache) return knowledgeCache;
    const [reference, sounds] = await Promise.all([getReferenceSnapshot(), Promise.resolve(getSoundsSnapshot())]);
    knowledgeCache = { reference, sounds };
    return knowledgeCache;
  }

  function getReplSnapshot(): ReplSnapshot {
    const activeCode = hostContext?.editorRef?.current?.code ?? '';
    const cps = hostContext?.editorRef?.current?.repl?.scheduler?.cps;
    return {
      activeCodeHash: hashString(activeCode),
      started: isStarted(hostContext),
      cps: typeof cps === 'number' ? cps : undefined,
      cpm: typeof cps === 'number' ? cps * 60 : undefined,
      quantizeMode: 'next_cycle',
    };
  }

  async function readCode(input: ReadCodeInput): Promise<unknown> {
    const activeCode = hostContext?.editorRef?.current?.code ?? '';
    if (input.path === 'active' || !input.path) {
      return {
        path: 'active',
        code: activeCode,
        hash: hashString(activeCode),
        lineCount: activeCode ? activeCode.split('\n').length : 0,
      };
    }
    return { path: input.path, code: '', hash: '', lineCount: 0 };
  }

  async function applyStrudelChange(input: ApplyStrudelChangeInput): Promise<ApplyResult> {
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

    let nextCode = activeCode;
    if (input.change.kind === 'full_code') {
      nextCode = input.change.content;
    } else if (input.change.kind === 'search_replace') {
      const matches = countMatchesLiteral(activeCode, input.change.search);
      const occurrence = input.change.occurrence ?? 'single';
      if (matches === 0) {
        return { status: 'rejected', phase: 'validate', diagnostics: ['search_replace: no match found for search string'] };
      }
      if (occurrence === 'single' && matches !== 1) {
        return {
          status: 'rejected',
          phase: 'validate',
          diagnostics: [`search_replace: expected single match but found ${matches}`],
        };
      }
      nextCode = occurrence === 'all' ? activeCode.split(input.change.search).join(input.change.replace) : activeCode.replace(input.change.search, input.change.replace);
    } else {
      return {
        status: 'rejected',
        phase: 'validate',
        diagnostics: ['patch is deprecated; use search_replace or full_code'],
      };
    }

    const dry = dryRunValidate(nextCode);
    if (!dry.ok) {
      return { status: 'rejected', phase: 'validate', diagnostics: dry.diagnostics };
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
    const applyAt = new Date(Date.now() + cycleMs).toISOString();

    setTimeout(() => {
      editor.code = nextCode;
      editor.setCode?.(nextCode);
      hostContext?.handleEvaluate?.();
      if (!isStarted(hostContext)) {
        tryStartPlayback(hostContext);
      }
    }, cycleMs);

    return { status: 'scheduled', applyAt };
  }

  return {
    getReplSnapshot,
    readCode,
    applyStrudelChange,
    getKnowledgeSources: loadKnowledgeSources,
    isStarted: () => isStarted(hostContext),
    tryStartPlayback: () => tryStartPlayback(hostContext),
  };
}
