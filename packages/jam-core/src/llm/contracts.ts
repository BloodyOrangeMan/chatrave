import type { ReasoningEffort } from '@chatrave/shared-types';

export type CompletionRole = 'system' | 'user' | 'assistant';

export interface CompletionMessage {
  role: CompletionRole;
  content: string;
}

export interface CompletionRequest {
  apiKey: string;
  model: string;
  temperature: number;
  reasoningEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  messages: CompletionMessage[];
  signal?: AbortSignal;
}

export interface CompletionClient {
  complete(request: CompletionRequest): Promise<string>;
}

