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
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  signal?: AbortSignal;
}

interface LoggedMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function logModelInput(body: Record<string, unknown>): void {
  try {
    const messages = (body.messages as LoggedMessage[] | undefined) ?? [];
    const systemPrompt = messages.find((message) => message.role === 'system')?.content ?? '';
    const chatHistory = messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: message.content }));
    const toolRelatedMessages = messages.filter((message) => /Tool results:|<function_calls>|<\|tool_call/i.test(message.content));

    console.info('[chatrave][llm] model_input', {
      model: body.model,
      reasoning: body.reasoning,
      systemPrompt,
      chatHistory,
      toolDefinitions: 'No OpenRouter tool schema sent in this request path (pseudo-tools are prompt-driven).',
      toolRelatedMessages,
    });
  } catch {
    // Ignore logging failures.
  }
}

function buildBody(config: OpenRouterClientConfig, request: OpenRouterStreamRequest, stream: boolean): Record<string, unknown> {
  return {
    model: config.model,
    stream,
    temperature: config.temperature,
    messages:
      request.messages ??
      [
        ...(request.systemPrompt ? [{ role: 'system' as const, content: request.systemPrompt }] : []),
        { role: 'user' as const, content: request.userText },
      ],
    reasoning: config.reasoningEnabled ? { effort: config.reasoningEffort } : undefined,
  };
}

async function postOpenRouter(
  config: OpenRouterClientConfig,
  request: OpenRouterStreamRequest,
  stream: boolean,
): Promise<Response> {
  const url = `${config.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`;
  const body = buildBody(config, request, stream);
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${config.apiKey}`,
  };

  logModelInput(body);

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: request.signal,
      headers,
      body: JSON.stringify(body),
    });
    return response;
  } catch (error) {
    throw makeOpenRouterError(
      `Network request failed: ${(error as Error).message}`,
      'network',
      true,
    );
  }
}

function extractCompletionText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const maybeChoices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  if (!Array.isArray(maybeChoices) || maybeChoices.length === 0) {
    return '';
  }
  const content = maybeChoices[0]?.message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      })
      .join('');
  }
  return '';
}

export async function openRouterStream(
  config: OpenRouterClientConfig,
  request: OpenRouterStreamRequest,
): Promise<Response> {
  const response = await postOpenRouter(config, request, true);

  if (!response.ok) {
    throw mapHttpStatusToError(response.status, await response.text());
  }

  if (!response.body) {
    throw makeOpenRouterError('OpenRouter response body is empty', 'parse', false);
  }

  return response;
}

export async function openRouterComplete(
  config: OpenRouterClientConfig,
  request: OpenRouterStreamRequest,
): Promise<string> {
  const response = await postOpenRouter(config, request, false);
  if (!response.ok) {
    throw mapHttpStatusToError(response.status, await response.text());
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw makeOpenRouterError('Failed to parse OpenRouter completion JSON', 'parse', false);
  }
  return extractCompletionText(payload);
}
