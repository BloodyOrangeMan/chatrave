// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSettings, RunnerEvent } from '@chatrave/shared-types';

let subscribedListener: ((event: RunnerEvent) => void) | undefined;

vi.mock('@strudel/transpiler/transpiler.mjs', () => ({
  transpiler: (input: string) => ({ output: input }),
}));

vi.mock('@chatrave/storage-local', async () => {
  const shared = await import('@chatrave/shared-types');
  let settings: AgentSettings = { ...shared.DEFAULT_AGENT_SETTINGS };
  return {
    loadSettings: () => settings,
    saveSettings: (patch: Partial<AgentSettings>) => {
      settings = { ...settings, ...patch };
      return settings;
    },
  };
});

vi.mock('@chatrave/strudel-adapter', () => ({
  registerAgentTabRenderer: () => undefined,
}));

vi.mock('../src/worker-client', () => ({
  createRunnerWorkerClient: () => ({
    send: () => undefined,
    stop: () => undefined,
    retry: () => undefined,
    resetContext: () => undefined,
    runDevKnowledge: () => Promise.resolve({ ok: true }),
    subscribe: (listener: (event: RunnerEvent) => void) => {
      subscribedListener = listener;
      return () => {
        subscribedListener = undefined;
      };
    },
  }),
}));

const { mountAgentUi } = await import('../src/index');

describe('jump to latest behavior', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    subscribedListener = undefined;
  });

  it('shows jump button when feed is unpinned', () => {
    const container = document.createElement('div');
    mountAgentUi(container);

    const feed = container.querySelector('[data-testid="chat-feed"]') as HTMLDivElement;
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, writable: true, value: 1000 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, writable: true, value: 200 });
    Object.defineProperty(feed, 'scrollTop', { configurable: true, writable: true, value: 600 });
    feed.dispatchEvent(new Event('scroll'));

    const jumpWrap = container.querySelector('.agent-jump-wrap') as HTMLDivElement;
    expect(jumpWrap.style.display).toBe('flex');
  });

  it('shows jump button when new content arrives while unpinned', () => {
    const container = document.createElement('div');
    mountAgentUi(container);

    const feed = container.querySelector('[data-testid="chat-feed"]') as HTMLDivElement;
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, writable: true, value: 1000 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, writable: true, value: 200 });
    Object.defineProperty(feed, 'scrollTop', { configurable: true, writable: true, value: 600 });
    feed.dispatchEvent(new Event('scroll'));

    subscribedListener?.({
      type: 'runner.state.changed',
      payload: { runningTurnId: 'turn-1' },
    });
    subscribedListener?.({
      type: 'assistant.stream.delta',
      payload: { turnId: 'turn-1', messageId: 'msg-1', delta: 'new text' },
    });

    const jumpWrap = container.querySelector('.agent-jump-wrap') as HTMLDivElement;
    expect(jumpWrap.style.display).toBe('flex');
  });
});
