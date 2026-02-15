import { createAgentSession } from '@chatrave/agent-core';
import type { AgentSettings, RunnerEvent } from '@chatrave/shared-types';
import { dispatchToolCall, type StrudelKnowledgeInput } from '@chatrave/agent-tools';
import { createStrudelBridge, type AgentHostContext } from '@chatrave/strudel-bridge';
import { readRuntimeOverrides } from './runtime-overrides';

export type { AgentHostContext } from '@chatrave/strudel-bridge';

export interface RunnerWorkerClient {
  send(text: string): void;
  stop(turnId?: string): void;
  retry(messageId: string): void;
  resetContext(options?: { omitRuntimeContext?: boolean }): void;
  runDevKnowledge(input: StrudelKnowledgeInput): Promise<unknown>;
  subscribe(listener: (event: RunnerEvent) => void): () => void;
}

export function createRunnerWorkerClient(settings: AgentSettings, hostContext?: AgentHostContext): RunnerWorkerClient {
  const bridge = createStrudelBridge(hostContext);
  const runtime = readRuntimeOverrides();

  const session = createAgentSession({
    settings,
    modelTimeoutMs: 180_000,
    maxSteps: 24,
    globalToolBudget: 40,
    maxRepairAttempts: 4,
    getReplSnapshot: bridge.getReplSnapshot,
    readCode: bridge.readCode,
    applyStrudelChange: bridge.applyStrudelChange,
    getKnowledgeSources: bridge.getKnowledgeSources,
    mock: {
      enabled: runtime.mockEnabled,
      scenario: runtime.mockScenario,
    },
  });

  const listeners = new Set<(event: RunnerEvent) => void>();
  session.subscribeToEvents((event) => {
    for (const listener of listeners) {
      listener(event);
    }
  });

  return {
    send(text) {
      void session.sendUserMessage(text);
    },
    stop(turnId) {
      session.stopGeneration(turnId);
    },
    retry(messageId) {
      void session.retryMessage(messageId);
    },
    resetContext(options) {
      session.resetContext(options);
    },
    async runDevKnowledge(input) {
      const knowledgeSources = await bridge.getKnowledgeSources();
      const result = await dispatchToolCall(
        {
          id: `dev-knowledge-${Date.now()}`,
          name: 'strudel_knowledge',
          input,
        },
        {
          knowledgeSources,
        },
      );
      return result.output ?? result.error ?? { status: 'unavailable' };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
