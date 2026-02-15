import { describe, expect, it } from 'vitest';
import { createFakeListCompletionClient } from '../src/llm/fake-list/adapter';
import { getFakeScenario } from '../src/llm/fake-list/scenario';

const baseRequest = {
  apiKey: 'k',
  model: 'mock',
  temperature: 0.2,
  reasoningEnabled: true,
  reasoningEffort: 'medium' as const,
  messages: [{ role: 'user' as const, content: 'hello' }],
};

describe('fake list completion client', () => {
  it('returns deterministic explicit apply call for successful jam scenario', async () => {
    const client = createFakeListCompletionClient(getFakeScenario('successful_jam_apply'));
    const first = await client.complete(baseRequest);

    expect(first).toContain('<|tool_calls_section_begin|>');
    expect(first).toContain('functions.apply_strudel_change:0');
    expect(first).toContain('"kind":"full_code"');
  });

  it('restarts at step 1 for each new user turn without tool results', async () => {
    const client = createFakeListCompletionClient({
      name: 'single',
      steps: [
        { id: 'step-1', response: 'first', toolCalls: [{ name: 'read_code', args: { path: 'active' } }] },
        { id: 'step-2', response: 'second' },
      ],
    });
    const first = await client.complete(baseRequest);
    const second = await client.complete(baseRequest);
    expect(first).toContain('functions.read_code:0');
    expect(second).toContain('functions.read_code:0');
  });

  it('exposes rejection-oriented scenario via explicit apply tool call', async () => {
    const client = createFakeListCompletionClient(getFakeScenario('jam_apply_rejected_unknown_sound'));
    const first = await client.complete(baseRequest);
    expect(first).toContain('functions.apply_strudel_change:0');
    expect(first).toContain('definitely_not_a_sound');
  });

  it('renders structured toolCalls into pipe-style markup', async () => {
    const client = createFakeListCompletionClient(getFakeScenario('read_then_apply_success'));
    const first = await client.complete(baseRequest);
    expect(first).toContain('<|tool_calls_section_begin|>');
    expect(first).toContain('functions.read_code:0');
    expect(first).toContain('"path":"active"');
  });

  it('selects follow-up step when tool results are present', async () => {
    const client = createFakeListCompletionClient(getFakeScenario('read_then_apply_success'));
    const followUp = await client.complete({
      ...baseRequest,
      messages: [{ role: 'user', content: 'Tool results:\n[{"name":"read_code"}]\n\nProvide final response.' }],
    });
    expect(followUp).toContain('functions.apply_strudel_change:0');
    expect(followUp).toContain('cp*2');
  });

  it('selects forced-final step when follow-up asks for retry', async () => {
    const client = createFakeListCompletionClient(getFakeScenario('early_finish_read_only'));
    const forcedFinal = await client.complete({
      ...baseRequest,
      messages: [{ role: 'user', content: 'Tool results:\n[]\n\nYour previous answer was empty.' }],
    });
    expect(forcedFinal).toContain('setcpm(120/4)');
    expect(forcedFinal).toContain('hh*8');
  });

  it('returns final response after apply tool result for read_then_apply_success', async () => {
    const client = createFakeListCompletionClient(getFakeScenario('read_then_apply_success'));
    const final = await client.complete({
      ...baseRequest,
      messages: [{ role: 'user', content: 'Tool results:\n[{"name":"apply_strudel_change"}]\n\nProvide final response.' }],
    });
    expect(final).toContain('```javascript');
    expect(final).toContain('cp*2');
  });
});
