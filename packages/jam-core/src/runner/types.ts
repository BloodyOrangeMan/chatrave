import type { AgentSettings, ReplSnapshot, RunnerEvent } from '@chatrave/shared-types';
import type { ApplyStrudelChangeInput, ReadCodeInput } from '../tools/contracts';
import type { KnowledgeSources } from '../tools/strudel-knowledge/execute';

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
  modelTimeoutMs?: number;
  getReplSnapshot?: () => ReplSnapshot;
  readCode?: (input: ReadCodeInput) => Promise<unknown>;
  applyStrudelChange?: (
    input: ApplyStrudelChangeInput,
  ) => Promise<{ status: 'scheduled' | 'applied'; applyAt?: string; diagnostics?: string[] }>;
  knowledgeSources?: KnowledgeSources;
  now?: () => number;
}
