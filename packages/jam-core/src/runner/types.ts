import type { AgentSettings, ReplSnapshot, RunnerEvent } from '@chatrave/shared-types';
import type { CompletionClient } from '../llm/contracts';
import type { ApplyStrudelChangeInput, ReadCodeInput } from '../tools/contracts';
import type { KnowledgeSources } from '../tools/strudel-knowledge/execute';

export interface AgentRunner {
  sendUserMessage(text: string): Promise<{ turnId: string; messageId: string }>;
  stopGeneration(turnId?: string): void;
  retryMessage(messageId: string): Promise<{ turnId: string; messageId: string }>;
  resetContext(options?: { omitRuntimeContext?: boolean }): void;
  subscribeToEvents(listener: (event: RunnerEvent) => void): () => void;
}

export interface AgentRunnerConfig {
  settings: AgentSettings;
  completionClient?: CompletionClient;
  openRouterBaseUrl?: string;
  openRouterExtraHeaders?: Record<string, string>;
  maxRepairAttempts?: number;
  globalToolBudget?: number;
  modelTimeoutMs?: number;
  getReplSnapshot?: () => ReplSnapshot;
  readCode?: (input: ReadCodeInput) => Promise<unknown>;
  applyStrudelChange?: (
    input: ApplyStrudelChangeInput,
  ) => Promise<
    | { status: 'scheduled' | 'applied'; applyAt?: string; diagnostics?: string[] }
    | {
        status: 'rejected';
        phase?: string;
        diagnostics?: string[];
        unknownSymbols?: string[];
        latestCode?: string;
        latestHash?: string;
        expectedBaseHash?: string;
      }
  >;
  knowledgeSources?: KnowledgeSources;
  getKnowledgeSources?: () => Promise<KnowledgeSources | undefined> | KnowledgeSources | undefined;
  now?: () => number;
}
