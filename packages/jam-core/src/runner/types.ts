import type { AgentSettings, RunnerEvent } from '@chatrave/shared-types';

export interface AgentRunner {
  sendUserMessage(text: string): Promise<{ turnId: string; messageId: string }>;
  stopGeneration(turnId?: string): void;
  retryMessage(messageId: string): Promise<{ turnId: string; messageId: string }>;
  subscribeToEvents(listener: (event: RunnerEvent) => void): () => void;
}

export interface AgentRunnerConfig {
  settings: AgentSettings;
  maxRepairAttempts?: number;
  globalToolBudget?: number;
  now?: () => number;
}
