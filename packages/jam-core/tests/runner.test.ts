import { describe, expect, it, vi } from 'vitest';
import { createAgentRunner } from '../src/runner/create-agent-runner';

const encoder = new TextEncoder();

function mockFetchResponse(parts: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(part));
      }
      controller.close();
    },
  });

  return new Response(stream, { status: 200 });
}

describe('agent runner', () => {
  it('emits delta then completion in order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockFetchResponse([
        'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const runner = createAgentRunner({
      settings: {
        schemaVersion: 1,
        provider: 'openrouter',
        model: 'moonshotai/kimi-2.5',
        reasoningEnabled: true,
        reasoningMode: 'balanced',
        temperature: 0.2,
        apiKey: 'k',
      },
      now: () => 100,
    });

    const events: string[] = [];
    runner.subscribeToEvents((event) => events.push(event.type));

    await runner.sendUserMessage('hi');

    expect(events).toContain('assistant.stream.delta');
    expect(events).toContain('assistant.turn.completed');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });
});
