// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createJamAgent, dispatchToolCall, clearActiveCode } = vi.hoisted(() => ({
  createJamAgent: vi.fn(() => ({ id: 'real' })),
  dispatchToolCall: vi.fn(async () => ({ status: 'succeeded', output: { ok: true } })),
  clearActiveCode: vi.fn(),
}));

vi.mock('ai', () => ({
  DirectChatTransport: class DirectChatTransport {
    options: unknown;
    constructor(options: unknown) {
      this.options = options;
    }
  },
}));

vi.mock('@chatrave/agent-core', () => ({
  createJamAgent,
  getMockScenario: () => ({
    name: 'test',
    steps: [{ response: 'mocked' }],
  }),
}));

vi.mock('@chatrave/agent-tools', () => ({
  dispatchToolCall,
}));

vi.mock('@chatrave/strudel-bridge', () => ({
  createStrudelBridge: () => ({
    getReplSnapshot: () => ({ activeCodeHash: 'h', started: false, quantizeMode: 'next_cycle' }),
    readCode: async () => ({ code: '', hash: 'h' }),
    applyStrudelChange: async () => ({ status: 'scheduled' }),
    getKnowledgeSources: async () => ({ reference: [], sounds: [] }),
    clearActiveCode,
  }),
}));

import { createChatRuntime } from '../src/worker-client';

const settings = {
  schemaVersion: 2 as const,
  provider: 'openrouter' as const,
  model: 'x',
  reasoningEnabled: true,
  reasoningMode: 'balanced' as const,
  temperature: 0.3,
  apiKey: 'k',
  voice: {
    provider: 'web_speech' as const,
    language: '',
    openaiApiKey: '',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiModel: 'gpt-4o-mini-transcribe',
  },
};

describe('createChatRuntime', () => {
  beforeEach(() => {
    localStorage.clear();
    createJamAgent.mockClear();
    clearActiveCode.mockClear();
  });

  it('uses real agent by default', () => {
    createChatRuntime(settings);
    expect(createJamAgent).toHaveBeenCalledTimes(1);
  });

  it('uses mock transport when toggle is enabled', () => {
    localStorage.setItem('chatraveDevFakeUiEnabled', 'true');
    localStorage.setItem('chatraveMockLlmScenario', 'test');
    const runtime = createChatRuntime(settings);
    expect(createJamAgent).not.toHaveBeenCalled();
    expect(typeof runtime.transport.sendMessages).toBe('function');
  });

  it('runs dev knowledge tool', async () => {
    const runtime = createChatRuntime(settings);
    await runtime.runDevKnowledge({ query: 'setcpm' });
    expect(dispatchToolCall).toHaveBeenCalled();
  });

  it('clearActiveCode delegates to bridge', () => {
    const runtime = createChatRuntime(settings);
    runtime.clearActiveCode();
    expect(clearActiveCode).toHaveBeenCalledTimes(1);
  });
});
