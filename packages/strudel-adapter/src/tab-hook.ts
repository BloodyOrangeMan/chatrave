export interface AgentTabHostContext {
  started?: boolean;
}

export interface AgentTabRenderer {
  render: (container: HTMLElement, context: AgentTabHostContext) => void;
  unmount?: (container: HTMLElement) => void;
}

declare global {
  interface Window {
    __CHATRAVE_AGENT_TAB_RENDERER__?: AgentTabRenderer;
    strudelMirror?: {
      repl?: {
        soundMap?: { get?: () => Record<string, { data?: Record<string, unknown> }> | undefined };
        state?: { soundMap?: { get?: () => Record<string, { data?: Record<string, unknown> }> | undefined } };
      };
    };
    soundMap?: { get?: () => Record<string, { data?: Record<string, unknown> }> | undefined };
  }
}

let mountedContainer: HTMLElement | null = null;

export function registerAgentTabRenderer(renderer: AgentTabRenderer): void {
  window.__CHATRAVE_AGENT_TAB_RENDERER__ = renderer;
}

export function mountAgentTab(container: HTMLElement, context: AgentTabHostContext): void {
  const renderer = window.__CHATRAVE_AGENT_TAB_RENDERER__;
  if (!renderer) {
    container.textContent = 'Agent tab renderer unavailable';
    return;
  }

  if (mountedContainer && mountedContainer !== container && renderer.unmount) {
    renderer.unmount(mountedContainer);
  }

  mountedContainer = container;
  renderer.render(container, context);
}

export function unmountAgentTab(): void {
  const renderer = window.__CHATRAVE_AGENT_TAB_RENDERER__;
  if (!renderer || !mountedContainer || !renderer.unmount) {
    return;
  }

  renderer.unmount(mountedContainer);
  mountedContainer = null;
}

export interface StrudelReferenceSnapshotItem {
  name: string;
  description?: string;
  params?: Array<{ name?: string; type?: string; description?: string }>;
  examples?: string[];
  tags?: Array<string | { title?: string; value?: string; text?: string }>;
  synonyms?: string[];
}

export interface StrudelSoundSnapshotItem {
  key: string;
  data?: {
    type?: string;
    tag?: string;
    prebake?: boolean;
    samples?: unknown[];
    tables?: unknown[];
    fonts?: unknown[];
  };
}

function normalizeReferenceDoc(raw: unknown): StrudelReferenceSnapshotItem[] {
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  const docs = (raw as { docs?: unknown }).docs;
  if (!Array.isArray(docs)) {
    return [];
  }
  const normalized: StrudelReferenceSnapshotItem[] = [];
  for (const item of docs) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const doc = item as {
        name?: unknown;
        description?: unknown;
        params?: unknown;
        examples?: unknown;
        tags?: unknown;
        synonyms?: unknown;
      };
      if (typeof doc.name !== 'string' || !doc.name.trim()) {
        continue;
      }
      normalized.push({
        name: doc.name,
        description: typeof doc.description === 'string' ? doc.description : undefined,
        params: Array.isArray(doc.params)
          ? doc.params
              .filter((param): param is { name?: string; type?: string; description?: string } => Boolean(param))
              .map((param) => ({
                name: typeof param.name === 'string' ? param.name : undefined,
                type: typeof param.type === 'string' ? param.type : undefined,
                description: typeof param.description === 'string' ? param.description : undefined,
              }))
          : undefined,
        examples: Array.isArray(doc.examples) ? doc.examples.filter((example): example is string => typeof example === 'string') : undefined,
        tags: Array.isArray(doc.tags)
          ? doc.tags.filter(
              (tag): tag is string | { title?: string; value?: string; text?: string } =>
                typeof tag === 'string' || (tag && typeof tag === 'object'),
            )
          : undefined,
        synonyms: Array.isArray(doc.synonyms)
          ? doc.synonyms.filter((synonym): synonym is string => typeof synonym === 'string')
          : undefined,
      });
  }
  return normalized;
}

async function tryFetchJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

export async function getReferenceSnapshot(): Promise<StrudelReferenceSnapshotItem[]> {
  const candidates = [
    new URL('../doc.json', import.meta.url).toString(),
    new URL('/doc.json', window.location.origin).toString(),
  ];

  for (const candidate of candidates) {
    const payload = await tryFetchJson(candidate);
    const normalized = normalizeReferenceDoc(payload);
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return [];
}

export function getSoundsSnapshot(): StrudelSoundSnapshotItem[] {
  const candidates: Array<unknown> = [
    window.strudelMirror?.repl?.soundMap,
    window.strudelMirror?.repl?.state?.soundMap,
    window.soundMap,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && 'get' in candidate && typeof candidate.get === 'function') {
      const value = candidate.get();
      if (value && typeof value === 'object') {
        return Object.entries(value).map(([key, entry]) => ({
          key,
          data: (entry as { data?: StrudelSoundSnapshotItem['data'] })?.data,
        }));
      }
    }
  }

  return [];
}
