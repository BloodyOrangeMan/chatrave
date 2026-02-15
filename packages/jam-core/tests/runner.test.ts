import { describe, expect, it, vi } from 'vitest';
import { createAgentRunner } from '../src/runner/create-agent-runner';
import { createFakeListCompletionClient } from '../src/llm/fake-list/adapter';
import { getFakeScenario } from '../src/llm/fake-list/scenario';
import { hashString } from '../src/tools/common/hash';

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
    const activeCode = 's("bd")';
    const readMock = vi.fn().mockResolvedValue({
      path: 'active',
      code: activeCode,
      hash: hashString(activeCode),
      lineCount: 1,
    });
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
    expect(readMock).toHaveBeenCalledTimes(3);
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
          'Inspecting now. <|tool_calls_section_begin|> <|tool_call_begin|> functions.apply_strudel_change:0 <|tool_call_argument_begin|> {"baseHash":"fnv1a-2f10d95b","change":{"kind":"full_code","content":"stack(s(\\"bd*4\\"), s(\\"nope_sound\\"))"}} <|tool_call_end|> <|tool_calls_section_end|>',
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
      readCode: async () => {
        const activeCode = 's("bd")';
        return { path: 'active', code: activeCode, hash: hashString(activeCode), lineCount: 1 };
      },
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
          '<function_calls><invoke name="apply_strudel_change"><parameter name="baseHash">fnv1a-2f10d95b</parameter><parameter name="change">{"kind":"full_code","content":"stack(s(\\"bd*4\\"), s(\\"hh*8\\"))"}</parameter></invoke></function_calls>',
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
    expect(applyStatuses.some((entry) => entry.status === 'scheduled')).toBe(true);
    expect(deltas.join('')).toContain('Attempted apply and got validation feedback.');
  });

  it('rejects apply payload when baseHash is omitted', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockCompletionResponse(
          '<|tool_calls_section_begin|> <|tool_call_begin|> functions.apply_strudel_change:0 <|tool_call_argument_begin|> {"change":{"kind":"full_code","content":"stack(s(\\"bd*4\\"), s(\\"hh*8\\"))"}} <|tool_call_end|> <|tool_calls_section_end|>',
        ),
      )
      .mockResolvedValueOnce(mockCompletionResponse('Apply rejected because baseHash is required.'));
    vi.stubGlobal('fetch', fetchMock);

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
      applyStrudelChange: applyMock,
      now: () => 100,
    });

    const applyStatuses: string[] = [];
    const completed: Array<{ name: string; status: string; error?: string; response?: unknown }> = [];
    runner.subscribeToEvents((event) => {
      if (event.type === 'apply.status.changed') {
        applyStatuses.push(event.payload.status);
      }
      if (event.type === 'tool.call.completed') {
        completed.push({
          name: event.payload.name,
          status: event.payload.status,
          error: event.payload.errorMessage,
          response: event.payload.response,
        });
      }
    });

    await runner.sendUserMessage('make beat');
    expect(applyMock).not.toHaveBeenCalled();
    expect(applyStatuses).toContain('rejected');
    expect(completed.some((item) => item.name === 'apply_strudel_change' && item.status === 'succeeded')).toBe(true);
    const applyResponse = completed.find((item) => item.name === 'apply_strudel_change')?.response as { errorCode?: string };
    expect(applyResponse.errorCode).toBe('VALIDATION_ERROR');
  });

  it('does not auto-retry STALE_BASE_HASH and forwards stale metadata in tool result', async () => {
    const staleHash = hashString('stack(s("bd"))');
    const latestCode = 'stack(s("bd"), s("cp"))';
    const latestHash = hashString(latestCode);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockCompletionResponse(
          `<|tool_calls_section_begin|> <|tool_call_begin|> functions.apply_strudel_change:0 <|tool_call_argument_begin|> {"baseHash":"${staleHash}","change":{"kind":"patch","content":"s(\\"hh\\")"}} <|tool_call_end|> <|tool_calls_section_end|>`,
        ),
      )
      .mockResolvedValueOnce(mockCompletionResponse('Stale base detected; retry with latest hash.'));
    vi.stubGlobal('fetch', fetchMock);

    const applyMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'rejected',
        phase: 'STALE_BASE_HASH',
        diagnostics: [`STALE_BASE_HASH: expected ${staleHash} but active hash is ${latestHash}`],
        latestCode,
        latestHash,
        expectedBaseHash: staleHash,
      });
    const readMock = vi.fn().mockResolvedValue({
      path: 'active',
      code: latestCode,
      hash: latestHash,
      lineCount: 1,
    });

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
      readCode: readMock,
      applyStrudelChange: applyMock,
      now: () => 100,
    });

    const completedApplyPayloads: unknown[] = [];
    runner.subscribeToEvents((event) => {
      if (event.type === 'tool.call.completed' && event.payload.name === 'apply_strudel_change') {
        completedApplyPayloads.push(event.payload.response);
      }
    });

    await runner.sendUserMessage('make beat');
    expect(applyMock).toHaveBeenCalledTimes(0);
    expect(readMock).toHaveBeenCalled();
    expect(completedApplyPayloads).toHaveLength(1);
    const payload = completedApplyPayloads[0] as { latestCode?: string; latestHash?: string; expectedBaseHash?: string };
    expect(payload.latestCode).toBe(latestCode);
    expect(payload.latestHash).toBe(latestHash);
    expect(payload.expectedBaseHash).toBe(staleHash);
  });

  it('runs one unknown-symbol repair loop via strudel_knowledge and reapplies', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockCompletionResponse(
          '<|tool_calls_section_begin|> <|tool_call_begin|> functions.apply_strudel_change:0 <|tool_call_argument_begin|> {"baseHash":"fnv1a-52660a86","change":{"kind":"full_code","content":"stack(s(\\"bd*4\\"), s(\\"not_loaded\\"))"}} <|tool_call_end|> <|tool_calls_section_end|>',
        ),
      )
      .mockResolvedValueOnce(
        mockCompletionResponse(
          '<|tool_calls_section_begin|> <|tool_call_begin|> functions.apply_strudel_change:0 <|tool_call_argument_begin|> {"baseHash":"fnv1a-52660a86","change":{"kind":"full_code","content":"stack(s(\\"bd*4\\"), s(\\"hh*8\\"))"}} <|tool_call_end|> <|tool_calls_section_end|>',
        ),
      )
      .mockResolvedValueOnce(mockCompletionResponse('Applied repaired groove.'));
    vi.stubGlobal('fetch', fetchMock);

    const applyMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'rejected',
        phase: 'validate',
        diagnostics: ['Unknown sound(s): not_loaded'],
        unknownSymbols: ['not_loaded'],
      })
      .mockResolvedValueOnce({ status: 'scheduled', applyAt: '2026-02-15T00:00:03.000Z' });

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
      readCode: async () => {
        const activeCode = 'stack(s("bd"))';
        return { path: 'active', code: activeCode, hash: hashString(activeCode), lineCount: 1 };
      },
      applyStrudelChange: applyMock,
      knowledgeSources: {
        reference: [{ name: 's', description: 'sound selector', examples: ['s("bd")'] }],
        sounds: [{ key: 'hh', data: { type: 'sample', tag: 'drum-machines', prebake: true } }],
      },
      now: () => 100,
    });

    const completedTools: string[] = [];
    const applyStatuses: string[] = [];
    runner.subscribeToEvents((event) => {
      if (event.type === 'tool.call.completed') {
        completedTools.push(event.payload.name);
      }
      if (event.type === 'apply.status.changed') {
        applyStatuses.push(event.payload.status);
      }
    });

    await runner.sendUserMessage('make beat');
    expect(applyMock).toHaveBeenCalledTimes(2);
    expect(completedTools.filter((name) => name === 'strudel_knowledge')).toHaveLength(1);
    expect(applyStatuses).toContain('scheduled');
  });

  it('limits unknown-symbol auto-repair to one knowledge lookup per turn', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockCompletionResponse(
          '<|tool_calls_section_begin|> <|tool_call_begin|> functions.apply_strudel_change:0 <|tool_call_argument_begin|> {"baseHash":"fnv1a-52660a86","change":{"kind":"full_code","content":"stack(s(\\"bd*4\\"), s(\\"not_loaded\\"))"}} <|tool_call_end|> <|tool_calls_section_end|>',
        ),
      )
      .mockResolvedValueOnce(
        mockCompletionResponse(
          '<|tool_calls_section_begin|> <|tool_call_begin|> functions.apply_strudel_change:0 <|tool_call_argument_begin|> {"baseHash":"fnv1a-52660a86","change":{"kind":"full_code","content":"stack(s(\\"bd*4\\"), s(\\"still_missing\\"))"}} <|tool_call_end|> <|tool_calls_section_end|>',
        ),
      )
      .mockResolvedValueOnce(mockCompletionResponse('Repair failed after one attempt.'));
    vi.stubGlobal('fetch', fetchMock);

    const applyMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'rejected',
        phase: 'validate',
        diagnostics: ['Unknown sound(s): not_loaded'],
        unknownSymbols: ['not_loaded'],
      })
      .mockResolvedValueOnce({
        status: 'rejected',
        phase: 'validate',
        diagnostics: ['Unknown sound(s): still_missing'],
        unknownSymbols: ['still_missing'],
      });

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
      readCode: async () => {
        const activeCode = 'stack(s("bd"))';
        return { path: 'active', code: activeCode, hash: hashString(activeCode), lineCount: 1 };
      },
      applyStrudelChange: applyMock,
      knowledgeSources: {
        reference: [{ name: 's', description: 'sound selector', examples: ['s("bd")'] }],
        sounds: [{ key: 'hh', data: { type: 'sample', tag: 'drum-machines', prebake: true } }],
      },
      now: () => 100,
    });

    const completedTools: string[] = [];
    runner.subscribeToEvents((event) => {
      if (event.type === 'tool.call.completed') {
        completedTools.push(event.payload.name);
      }
    });

    await runner.sendUserMessage('make beat');
    expect(applyMock).toHaveBeenCalledTimes(2);
    expect(completedTools.filter((name) => name === 'strudel_knowledge')).toHaveLength(1);
  });

  it('includes full active code in runtime context only when hash changed', async () => {
    const completeMock = vi.fn().mockResolvedValue('ok');
    const activeCode = 'stack(s("bd"))';
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
      completionClient: { complete: completeMock },
      getReplSnapshot: () => ({ activeCodeHash: 'unknown', started: false }),
      readCode: async () => ({ path: 'active', code: activeCode, hash: hashString(activeCode), lineCount: 1 }),
      now: () => 100,
    });

    await runner.sendUserMessage('first');
    await runner.sendUserMessage('second');

    const firstMessages = completeMock.mock.calls[0][0].messages as Array<{ role: string; content: string }>;
    const secondMessages = completeMock.mock.calls[1][0].messages as Array<{ role: string; content: string }>;
    const firstMatch = firstMessages[1].content.match(/\[runtime_context\]\n([\s\S]*?)\n\[\/runtime_context\]/);
    const secondMatch = secondMessages[1].content.match(/\[runtime_context\]\n([\s\S]*?)\n\[\/runtime_context\]/);
    expect(firstMatch).toBeTruthy();
    expect(secondMatch).toBeTruthy();
    const firstContext = JSON.parse(firstMatch?.[1] ?? '{}') as { snapshot: { activeCode?: string } };
    const secondContext = JSON.parse(secondMatch?.[1] ?? '{}') as { snapshot: { activeCode?: string } };
    expect(firstContext.snapshot.activeCode).toBe(activeCode);
    expect(secondContext.snapshot.activeCode).toBeUndefined();
  });

  it('re-includes full active code in runtime context after hash changes', async () => {
    const completeMock = vi.fn().mockResolvedValue('ok');
    let activeCode = 'stack(s("bd"))';
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
      completionClient: { complete: completeMock },
      getReplSnapshot: () => ({ activeCodeHash: 'unknown', started: false }),
      readCode: async () => ({ path: 'active', code: activeCode, hash: hashString(activeCode), lineCount: 1 }),
      now: () => 100,
    });

    await runner.sendUserMessage('first');
    activeCode = 'stack(s("bd"), s("cp"))';
    await runner.sendUserMessage('second');

    const secondMessages = completeMock.mock.calls[1][0].messages as Array<{ role: string; content: string }>;
    const secondMatch = secondMessages[1].content.match(/\[runtime_context\]\n([\s\S]*?)\n\[\/runtime_context\]/);
    expect(secondMatch).toBeTruthy();
    const secondContext = JSON.parse(secondMatch?.[1] ?? '{}') as { snapshot: { activeCode?: string; activeCodeHash?: string } };
    expect(secondContext.snapshot.activeCode).toBe(activeCode);
    expect(secondContext.snapshot.activeCodeHash).toBe(hashString(activeCode));
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
