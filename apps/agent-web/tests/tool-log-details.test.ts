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
    subscribe: (listener: (event: RunnerEvent) => void) => {
      subscribedListener = listener;
      return () => {
        subscribedListener = undefined;
      };
    },
  }),
}));

const { mountAgentUi } = await import('../src/index');

describe('tool log details', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    subscribedListener = undefined;
  });

  it('renders request and response payload for completed tools', () => {
    const container = document.createElement('div');
    mountAgentUi(container);

    expect(subscribedListener).toBeTypeOf('function');

    subscribedListener?.({
      type: 'tool.call.completed',
      payload: {
        id: 'tool-1',
        name: 'read_code',
        status: 'succeeded',
        durationMs: 12,
        request: { path: 'active' },
        response: { path: 'active', lineCount: 4 },
      },
    });

    const output = container.querySelector('pre');
    expect(output?.textContent).toContain('[Tool read_code: succeeded]');
    expect(output?.textContent).toContain('[Tool Request]');
    expect(output?.textContent).toContain('"path": "active"');
    expect(output?.textContent).toContain('[Tool Response]');
    expect(output?.textContent).toContain('"lineCount": 4');
  });
});
