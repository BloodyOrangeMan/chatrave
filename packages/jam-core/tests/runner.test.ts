import { describe, expect, it, vi } from 'vitest';
import { createAgentRunner } from '../src/runner/create-agent-runner';
import { createFakeListCompletionClient } from '../src/llm/fake-list/adapter';
import { getFakeScenario } from '../src/llm/fake-list/scenario';
import { hashString } from '../src/tools/common/hash';

describe('agent runner (ai-sdk refactor)', () => {
  it('supports deterministic completionClient seam and executes explicit tools', async () => {
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
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyStatuses).toContain('scheduled');
    expect(deltas.join('')).toContain('cp*2');
  });

  it('includes full active code only when active hash changes', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      content: 'ok',
      toolCalls: [],
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
      completionClient: { complete: completeMock },
      readCode: async () => {
        const code = 'stack(s("bd"))';
        return { path: 'active', code, hash: hashString(code), lineCount: 1 };
      },
      now: () => 100,
    });

    await runner.sendUserMessage('first');
    await runner.sendUserMessage('second');

    const firstUserContent = completeMock.mock.calls[0][0].messages[1].content as string;
    const secondUserContent = completeMock.mock.calls[1][0].messages[1].content as string;
    expect(firstUserContent).toContain('"activeCode"');
    expect(secondUserContent).not.toContain('"activeCode"');
  });

  it('re-includes full active code after hash changes', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      content: 'ok',
      toolCalls: [],
    });

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
      readCode: async () => ({
        path: 'active',
        code: activeCode,
        hash: hashString(activeCode),
        lineCount: 1,
      }),
      now: () => 100,
    });

    await runner.sendUserMessage('first');
    activeCode = 'stack(s("bd"), s("cp"))';
    await runner.sendUserMessage('second');

    const secondUserContent = completeMock.mock.calls[1][0].messages[1].content as string;
    expect(secondUserContent).toContain('"activeCode"');
    expect(secondUserContent).toContain('cp');
  });

  it('emits fallback final text when model output is empty', async () => {
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
      completionClient: {
        complete: vi.fn().mockResolvedValue({ content: '', toolCalls: [] }),
      },
      now: () => 100,
    });

    const deltas: string[] = [];
    runner.subscribeToEvents((event) => {
      if (event.type === 'assistant.stream.delta') {
        deltas.push(event.payload.delta);
      }
    });

    await runner.sendUserMessage('hello');

    expect(deltas.join('')).toContain('I could not generate a complete final response this turn.');
  });

  it('omits runtime envelope after resetContext({omitRuntimeContext:true})', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      content: 'ok',
      toolCalls: [],
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
      completionClient: { complete: completeMock },
      readCode: async () => ({
        path: 'active',
        code: 'stack(s("bd"))',
        hash: hashString('stack(s("bd"))'),
        lineCount: 1,
      }),
      now: () => 100,
    });

    runner.resetContext({ omitRuntimeContext: true });
    await runner.sendUserMessage('hello');

    const userContent = completeMock.mock.calls[0][0].messages[1].content as string;
    expect(userContent).not.toContain('[runtime_context]');
    expect(userContent).toContain('User request:');
  });
});
