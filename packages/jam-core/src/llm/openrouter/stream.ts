import { makeOpenRouterError } from './errors';

export interface OpenRouterStreamChunk {
  delta: string;
  done: boolean;
}

function extractDelta(json: unknown): string {
  if (!json || typeof json !== 'object') {
    return '';
  }

  const maybeChoices = (json as { choices?: Array<{ delta?: { content?: string } }> }).choices;
  if (!Array.isArray(maybeChoices) || maybeChoices.length === 0) {
    return '';
  }

  return maybeChoices[0]?.delta?.content ?? '';
}

export async function* parseOpenRouterSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<OpenRouterStreamChunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      const lines = event
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => line.startsWith('data:'));

      for (const line of lines) {
        const payload = line.slice('data:'.length).trim();
        if (!payload) {
          continue;
        }
        if (payload === '[DONE]') {
          yield { delta: '', done: true };
          return;
        }

        try {
          const parsed = JSON.parse(payload) as unknown;
          const delta = extractDelta(parsed);
          if (delta) {
            yield { delta, done: false };
          }
        } catch {
          throw makeOpenRouterError('Failed to parse OpenRouter SSE payload', 'parse', false);
        }
      }
    }
  }

  if (buffer.trim()) {
    throw makeOpenRouterError('Unterminated SSE frame from OpenRouter', 'parse', false);
  }
}
