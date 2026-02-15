import type { CompletionClient, CompletionRequest } from '../contracts';
import { openRouterComplete } from './client';

export interface OpenRouterCompletionAdapterOptions {
  baseUrl?: string;
  extraHeaders?: Record<string, string>;
}

export function createOpenRouterCompletionClient(
  options: OpenRouterCompletionAdapterOptions = {},
): CompletionClient {
  return {
    async complete(request: CompletionRequest): Promise<string> {
      return openRouterComplete(
        {
          apiKey: request.apiKey,
          model: request.model,
          temperature: request.temperature,
          reasoningEnabled: request.reasoningEnabled,
          reasoningEffort: request.reasoningEffort,
          baseUrl: options.baseUrl,
          extraHeaders: options.extraHeaders,
        },
        {
          userText: request.messages[request.messages.length - 1]?.content ?? '',
          messages: request.messages,
          signal: request.signal,
        },
      );
    },
  };
}

