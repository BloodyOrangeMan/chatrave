import { describe, expect, it, vi } from 'vitest';
import { createAgentRunner } from '../src/runner/create-agent-runner';
import { createFakeListCompletionClient } from '../src/llm/fake-list/adapter';
import { getFakeScenario } from '../src/llm/fake-list/scenario';

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
  it('supports injected completion client for deterministic runs', async () => {
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
      completionClient: createFakeListCompletionClient({
        name: 'deterministic-inline',
        steps: [
          {
            id: 'inline-code',
            response: '```javascript\nsetcpm(120/4)\nstack(s("bd*4"), s("hh*8"))\n```',
          },
        ],
      }),
      readCode: async () => ({ code: 's("bd")' }),
      applyStrudelChange: async () => ({ status: 'scheduled', applyAt: '2026-02-15T00:00:00.000Z' }),
      now: () => 100,
    });

    const deltas: string[] = [];
    runner.subscribeToEvents((event) => {
      if (event.type === 'assistant.stream.delta') {
        deltas.push(event.payload.delta);
      }
    });

    await runner.sendUserMessage('give me a techno beat');
    expect(deltas.join('')).toContain('setcpm(120/4)');
  });

  it('executes explicit read and apply tool calls across multiple model rounds', async () => {
    const readMock = vi.fn().mockResolvedValue({ path: 'active', code: 's("bd")', lineCount: 1 });
    const applyMock = vi.fn().mockResolvedValue({ status: 'scheduled', applyAt: '2026-02-15T00:00:00.000Z' });

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
      completionClient: createFakeListCompletionClient(getFakeScenario('read_then_apply_success')),
      readCode: readMock,
      applyStrudelChange: applyMock,
      now: () => 100,
    });

    const completedTools: string[] = [];
    const applyStatuses: string[] = [];
    const deltas: string[] = [];

    runner.subscribeToEvents((event) => {
      if (event.type === 'tool.call.completed') {
        completedTools.push(event.payload.name);
      }
      if (event.type === 'apply.status.changed') {
        applyStatuses.push(event.payload.status);
      }
      if (event.type === 'assistant.stream.delta') {
        deltas.push(event.payload.delta);
      }
    });

    await runner.sendUserMessage('give me a techno beat');

    expect(completedTools).toContain('read_code');
    expect(completedTools).toContain('apply_strudel_change');
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyStatuses).toContain('scheduled');
    expect(deltas.join('')).toContain('cp*2');
  });

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

  it('emits deterministic fallback final text when post-tool responses remain empty', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockCompletionResponse(
          'Inspecting now. <|tool_calls_section_begin|> <|tool_call_begin|> functions.apply_strudel_change:0 <|tool_call_argument_begin|> {"currentCode":"s(\\"bd\\")","change":{"kind":"full_code","content":"stack(s(\\"bd*4\\"), s(\\"nope_sound\\"))"}} <|tool_call_end|> <|tool_calls_section_end|>',
        ),
      )
      .mockResolvedValueOnce(mockCompletionResponse(''))
      .mockResolvedValueOnce(mockCompletionResponse(''));
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
      applyStrudelChange: async () => ({
        status: 'rejected',
        phase: 'validate',
        diagnostics: ['Unknown sound(s): nope_sound'],
        unknownSymbols: ['nope_sound'],
      }),
      now: () => 100,
    });

    const deltas: string[] = [];
    let completedReason: string | undefined;
    runner.subscribeToEvents((event) => {
      if (event.type === 'assistant.stream.delta') {
        deltas.push(event.payload.delta);
      }
      if (event.type === 'assistant.turn.completed') {
        completedReason = event.payload.completedReason;
      }
    });

    await runner.sendUserMessage('make beat');
    const final = deltas.join('');
    expect(final).toContain('I could not generate a complete final response this turn.');
    expect(final).toContain('Apply rejected: Unknown sound(s): nope_sound.');
    expect(completedReason).toBe('fallback_final');
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

  it('does not auto-run read_code when initial answer is planning-only without tool tags', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockCompletionResponse("I'll check the current state first, then propose a beat."));
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
    expect(events).not.toContain('tool.call.started');
    expect(events).not.toContain('tool.call.completed');
    expect(deltas.join('')).toContain("I'll check the current state first");
  });

  it('does not auto-apply when assistant returns code block without apply tool call', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockCompletionResponse('```javascript\nstack(s("bd*4"), s("~ hh ~ hh"))\n```'));
    vi.stubGlobal('fetch', fetchMock);

    const applyMock = vi.fn().mockResolvedValue({ status: 'scheduled', applyAt: '2026-02-14T00:00:00.000Z' });
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
      applyStrudelChange: applyMock,
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
    expect(applyMock).not.toHaveBeenCalled();
    expect(events).not.toContain('apply.status.changed');
    expect(deltas.join('')).toContain('stack(s("bd*4"), s("~ hh ~ hh"))');
  });

  it('does not emit apply status when jam request has no explicit apply tool call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockCompletionResponse('Some analysis only, no code block.'));
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

    await runner.sendUserMessage('give me a techno beat');
    expect(events).not.toContain('apply.status.changed');
    expect(deltas.join('')).toContain('Some analysis only, no code block.');
  });

  it('maps failed direct apply tool call to rejected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockCompletionResponse(
          '<function_calls><invoke name="apply_strudel_change"><parameter name="currentCode">s("bd")</parameter></invoke></function_calls>',
        ),
      )
      .mockResolvedValueOnce(mockCompletionResponse('Attempted apply and got validation feedback.'));
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

    const applyStatuses: Array<{ status: string; reason?: string }> = [];
    const deltas: string[] = [];
    runner.subscribeToEvents((event) => {
      if (event.type === 'apply.status.changed') {
        applyStatuses.push({ status: event.payload.status, reason: event.payload.reason });
      }
      if (event.type === 'assistant.stream.delta') {
        deltas.push(event.payload.delta);
      }
    });

    await runner.sendUserMessage('give me a techno beat');
    expect(applyStatuses.some((entry) => entry.status === 'rejected')).toBe(true);
    expect(deltas.join('')).toContain('Attempted apply and got validation feedback.');
  });

  it('clears stored conversation context on resetContext', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockCompletionResponse('ok'));
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

    const first = await runner.sendUserMessage('hello');
    runner.resetContext({ omitRuntimeContext: true });

    await runner.sendUserMessage('after clear');
    await runner.sendUserMessage('after second clear');

    await expect(runner.retryMessage(first.messageId)).rejects.toThrow(/No source message stored for retry/);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(secondBody.messages[1].content).not.toContain('[runtime_context]');
    const thirdBody = JSON.parse(fetchMock.mock.calls[2][1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(thirdBody.messages[1].content).toContain('[runtime_context]');
  });
});
