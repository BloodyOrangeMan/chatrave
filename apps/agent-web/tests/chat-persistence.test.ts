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

describe('chat persistence', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    subscribedListener = undefined;
  });

  it('restores messages after remount', () => {
    const firstContainer = document.createElement('div');
    mountAgentUi(firstContainer);

    subscribedListener?.({
      type: 'runner.state.changed',
      payload: { runningTurnId: 'turn-1' },
    });
    subscribedListener?.({
      type: 'assistant.stream.delta',
      payload: { turnId: 'turn-1', messageId: 'msg-1', delta: 'Persist me' },
    });
    subscribedListener?.({
      type: 'assistant.turn.completed',
      payload: {
        turnId: 'turn-1',
        messageId: 'msg-1',
        status: 'completed',
        timing: { startedAt: 1, endedAt: 2, durationMs: 1 },
        content: 'Persist me',
      },
    });

    const secondContainer = document.createElement('div');
    mountAgentUi(secondContainer);
    expect(secondContainer.textContent).toContain('Persist me');
  });
});
