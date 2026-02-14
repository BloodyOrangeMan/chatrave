import { describe, expect, it, vi } from 'vitest';
import { createAgentRunner } from '../src/runner/create-agent-runner';

function mockCompletionResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content,
          },
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('agent runner', () => {
  it('emits delta then completion in order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockCompletionResponse('a'),
    );
    vi.stubGlobal('fetch', fetchMock);

    const runner = createAgentRunner({
      settings: {
        schemaVersion: 1,
        provider: 'openrouter',
        model: 'moonshotai/kimi-k2.5',
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

  it('executes pseudo tool calls and hides raw function tags', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockCompletionResponse(
          'Plan\n<function_calls><invoke name="read_code"><parameter name="path">active</parameter></invoke></function_calls>',
        ),
      )
      .mockResolvedValueOnce(mockCompletionResponse('Here is your techno beat update.'));
    vi.stubGlobal('fetch', fetchMock);

    const runner = createAgentRunner({
      settings: {
        schemaVersion: 1,
        provider: 'openrouter',
        model: 'moonshotai/kimi-k2.5',
        reasoningEnabled: true,
        reasoningMode: 'balanced',
        temperature: 0.2,
        apiKey: 'k',
      },
      readCode: async () => ({ code: 's(\"bd\")', lineCount: 1 }),
      now: () => 100,
    });

    const deltas: string[] = [];
    const events: string[] = [];
    runner.subscribeToEvents((event) => {
      events.push(event.type);
      if (event.type === 'assistant.stream.delta') {
        deltas.push(event.payload.delta);
      }
    });

    await runner.sendUserMessage('make beat');

    expect(events).toContain('tool.call.started');
    expect(events).toContain('tool.call.completed');
    expect(deltas.join('')).toContain('Here is your techno beat update.');
    expect(deltas.join('')).not.toContain('<function_calls>');
  });

  it('forces a second follow-up when first tool follow-up response is empty', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockCompletionResponse(
          'I will inspect first. <|tool_calls_section_begin|> <|tool_call_begin|> functions.read_code:0 <|tool_call_argument_begin|> {"path":"active"} <|tool_call_end|> <|tool_calls_section_end|>',
        ),
      )
      .mockResolvedValueOnce(mockCompletionResponse(''))
      .mockResolvedValueOnce(mockCompletionResponse('Try this: stack(s("bd hh sd hh"), s("hh*8").gain(0.7))'));
    vi.stubGlobal('fetch', fetchMock);

    const runner = createAgentRunner({
      settings: {
        schemaVersion: 1,
        provider: 'openrouter',
        model: 'moonshotai/kimi-k2.5',
        reasoningEnabled: true,
        reasoningMode: 'balanced',
        temperature: 0.2,
        apiKey: 'k',
      },
      readCode: async () => ({ code: 's(\"bd\")', lineCount: 1 }),
      now: () => 100,
    });

    const deltas: string[] = [];
    runner.subscribeToEvents((event) => {
      if (event.type === 'assistant.stream.delta') {
        deltas.push(event.payload.delta);
      }
    });

    await runner.sendUserMessage('make beat');
    const final = deltas.join('');
    expect(final).toContain('Try this:');
    expect(final).not.toContain('<|tool_calls_section_begin|>');
  });

  it('forces a second follow-up when first post-tool response is planning-only', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockCompletionResponse(
          'I will inspect first. <|tool_calls_section_begin|> <|tool_call_begin|> functions.read_code:0 <|tool_call_argument_begin|> {"path":"active"} <|tool_call_end|> <|tool_calls_section_end|>',
        ),
      )
      .mockResolvedValueOnce(mockCompletionResponse("I'll check the current code state first."))
      .mockResolvedValueOnce(mockCompletionResponse('Use this techno groove: stack(s("bd*4"), s("~ hh ~ hh"))'));
    vi.stubGlobal('fetch', fetchMock);

    const runner = createAgentRunner({
      settings: {
        schemaVersion: 1,
        provider: 'openrouter',
        model: 'moonshotai/kimi-k2.5',
        reasoningEnabled: true,
        reasoningMode: 'balanced',
        temperature: 0.2,
        apiKey: 'k',
      },
      readCode: async () => ({ code: 's(\"bd\")', lineCount: 1 }),
      now: () => 100,
    });

    const deltas: string[] = [];
    runner.subscribeToEvents((event) => {
      if (event.type === 'assistant.stream.delta') {
        deltas.push(event.payload.delta);
      }
    });

    await runner.sendUserMessage('make beat');
    const final = deltas.join('');
    expect(final).toContain('Use this techno groove');
    expect(final).not.toContain("I'll check the current code state first.");
  });

  it('auto-runs read_code when initial answer is planning-only without tool tags', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockCompletionResponse("I'll check the current state first, then propose a beat."),
      )
      .mockResolvedValueOnce(mockCompletionResponse('Use this: stack(s("bd*4"), s("~ hh ~ hh"))'));
    vi.stubGlobal('fetch', fetchMock);

    const runner = createAgentRunner({
      settings: {
        schemaVersion: 1,
        provider: 'openrouter',
        model: 'moonshotai/kimi-k2.5',
        reasoningEnabled: true,
        reasoningMode: 'balanced',
        temperature: 0.2,
        apiKey: 'k',
      },
      readCode: async () => ({ code: 's(\"bd\")', lineCount: 1 }),
      now: () => 100,
    });

    const events: string[] = [];
    const deltas: string[] = [];
    runner.subscribeToEvents((event) => {
      events.push(event.type);
      if (event.type === 'assistant.stream.delta') {
        deltas.push(event.payload.delta);
      }
    });

    await runner.sendUserMessage('make beat');
    expect(events).toContain('tool.call.started');
    expect(events).toContain('tool.call.completed');
    expect(deltas.join('')).toContain('Use this:');
  });

  it('forces code-block generation before auto-apply when response has no code block', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockCompletionResponse("I'll inspect current code first."),
      )
      .mockResolvedValueOnce(mockCompletionResponse('Current code is minimal. I will expand it.'))
      .mockResolvedValueOnce(mockCompletionResponse('```javascript\nstack(s("bd*4"), s("~ hh ~ hh"))\n```'));
    vi.stubGlobal('fetch', fetchMock);

    const runner = createAgentRunner({
      settings: {
        schemaVersion: 1,
        provider: 'openrouter',
        model: 'moonshotai/kimi-k2.5',
        reasoningEnabled: true,
        reasoningMode: 'balanced',
        temperature: 0.2,
        apiKey: 'k',
      },
      readCode: async () => ({ code: 's(\"bd\")', lineCount: 1 }),
      applyStrudelChange: async () => ({ status: 'scheduled', applyAt: '2026-02-14T00:00:00.000Z' }),
      now: () => 100,
    });

    const events: string[] = [];
    const deltas: string[] = [];
    runner.subscribeToEvents((event) => {
      events.push(event.type);
      if (event.type === 'assistant.stream.delta') {
        deltas.push(event.payload.delta);
      }
    });

    await runner.sendUserMessage('make techno beat');
    expect(events).toContain('apply.status.changed');
    expect(deltas.join('')).toContain('Apply status: scheduled');
  });
});
