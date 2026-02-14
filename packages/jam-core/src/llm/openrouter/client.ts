import type { ReasoningEffort } from '@chatrave/shared-types';
import { mapHttpStatusToError, makeOpenRouterError } from './errors';

export interface OpenRouterClientConfig {
  apiKey: string;
  model: string;
  temperature: number;
  reasoningEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  baseUrl?: string;
}

export interface OpenRouterStreamRequest {
  userText: string;
  systemPrompt?: string;
  signal?: AbortSignal;
}

export async function openRouterStream(
  config: OpenRouterClientConfig,
  request: OpenRouterStreamRequest,
): Promise<Response> {
  const url = `${config.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`;
  const body = {
    model: config.model,
    stream: true,
    temperature: config.temperature,
    messages: [
      ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
      { role: 'user', content: request.userText },
    ],
    reasoning: config.reasoningEnabled ? { effort: config.reasoningEffort } : undefined,
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: request.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw makeOpenRouterError(
      `Network request failed: ${(error as Error).message}`,
      'network',
      true,
    );
  }

  if (!response.ok) {
    throw mapHttpStatusToError(response.status, await response.text());
  }

  if (!response.body) {
    throw makeOpenRouterError('OpenRouter response body is empty', 'parse', false);
  }

  return response;
}
