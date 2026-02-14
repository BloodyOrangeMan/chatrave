import { describe, expect, it } from 'vitest';
import { parseOpenRouterSse } from '../src/llm/openrouter/stream';

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe('openrouter sse parser', () => {
  it('reads content deltas and done marker', async () => {
    const stream = makeStream([
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);

    const deltas: string[] = [];
    for await (const chunk of parseOpenRouterSse(stream)) {
      if (!chunk.done) {
        deltas.push(chunk.delta);
      }
    }

    expect(deltas.join('')).toBe('hello world');
  });
});
