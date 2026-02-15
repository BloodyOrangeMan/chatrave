import type { AgentSettings, ReplSnapshot, RunnerEvent } from '@chatrave/shared-types';
import type { ApplyStrudelChangeInput, ReadCodeInput } from '@chatrave/agent-tools';
import type { KnowledgeSources } from '@chatrave/agent-tools';

export interface AgentSession {
  sendUserMessage(text: string): Promise<{ turnId: string; messageId: string }>;
  stopGeneration(turnId?: string): void;
  retryMessage(messageId: string): Promise<{ turnId: string; messageId: string }>;
  resetContext(options?: { omitRuntimeContext?: boolean }): void;
  subscribeToEvents(listener: (event: RunnerEvent) => void): () => void;
}

export interface AgentSessionConfig {
  settings: AgentSettings;
  modelTimeoutMs?: number;
  maxSteps?: number;
  maxRepairAttempts?: number;
  globalToolBudget?: number;
  getReplSnapshot?: () => ReplSnapshot;
  readCode?: (input: ReadCodeInput) => Promise<unknown>;
  applyStrudelChange?: (input: ApplyStrudelChangeInput) => Promise<unknown>;
  getKnowledgeSources?: () => Promise<KnowledgeSources | undefined> | KnowledgeSources | undefined;
  now?: () => number;
  mock?: {
    enabled: boolean;
    scenario?: string;
  };
}
