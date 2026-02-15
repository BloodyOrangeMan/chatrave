import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import type { CompletionClient, CompletionMessage, CompletionRequest } from '../contracts';
import type { FakeScenario, FakeScenarioStep } from './scenario';

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (!ms || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const handle = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(handle);
      reject(new Error('The operation was aborted.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function toLcMessage(message: CompletionMessage): HumanMessage | SystemMessage | AIMessage {
  if (message.role === 'assistant') {
    return new AIMessage(message.content);
  }
  if (message.role === 'system') {
    return new SystemMessage(message.content);
  }
  return new HumanMessage(message.content);
}

function extractText(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  if (!output || typeof output !== 'object') {
    return '';
  }
  const maybe = output as { content?: unknown };
  if (typeof maybe.content === 'string') {
    return maybe.content;
  }
  if (Array.isArray(maybe.content)) {
    return maybe.content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      })
      .join('');
  }
  return '';
}

function renderToolCalls(step: FakeScenarioStep): string {
  if (!step.toolCalls || step.toolCalls.length === 0) {
    return '';
  }
  const invokes = step.toolCalls
    .map((call) => {
      return (
        '<|tool_call_begin|> ' +
        `functions.${call.name}:0 ` +
        '<|tool_call_argument_begin|> ' +
        `${JSON.stringify(call.args)} ` +
        '<|tool_call_end|>'
      );
    })
    .join(' ');
  return `<|tool_calls_section_begin|> ${invokes} <|tool_calls_section_end|>`;
}

function latestUserContent(messages: CompletionMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'user') {
      return message.content;
    }
  }
  return '';
}

function hasToolResult(latestUser: string, toolName: string): boolean {
  return latestUser.includes(`"name": "${toolName}"`) || latestUser.includes(`"name":"${toolName}"`);
}

function selectScenarioStep(scenario: FakeScenario, request: CompletionRequest): FakeScenarioStep {
  const steps = scenario.steps;
  if (!steps.length) {
    throw new Error(`Fake scenario has no steps: ${scenario.name}`);
  }
  if (steps.length === 1) {
    return steps[0];
  }

  const latestUser = latestUserContent(request.messages);
  const hasToolResults = latestUser.includes('Tool results:');
  if (!hasToolResults) {
    return steps[0];
  }

  const asksForcedFinal = latestUser.includes('previous answer was empty');
  if (scenario.name === 'read_then_apply_success') {
    if (hasToolResult(latestUser, 'apply_strudel_change')) {
      return steps[Math.min(2, steps.length - 1)];
    }
    if (hasToolResult(latestUser, 'read_code')) {
      return steps[Math.min(1, steps.length - 1)];
    }
    return steps[Math.min(1, steps.length - 1)];
  }

  if (scenario.name === 'successful_jam_apply' || scenario.name === 'jam_apply_rejected_unknown_sound') {
    if (hasToolResult(latestUser, 'apply_strudel_change')) {
      return steps[Math.min(1, steps.length - 1)];
    }
    return steps[0];
  }

  if (scenario.name === 'early_finish_read_only') {
    if (asksForcedFinal) {
      return steps[Math.min(2, steps.length - 1)];
    }
    if (hasToolResult(latestUser, 'read_code')) {
      return steps[Math.min(1, steps.length - 1)];
    }
    return steps[Math.min(1, steps.length - 1)];
  }

  if (asksForcedFinal) {
    return steps[Math.min(2, steps.length - 1)];
  }
  return steps[Math.min(1, steps.length - 1)];
}

export function createFakeListCompletionClient(scenario: FakeScenario): CompletionClient {
  const responseByStepId = new Map<string, string>();
  for (const step of scenario.steps) {
    const prefix = step.response ?? '';
    const renderedCalls = renderToolCalls(step);
    const text = renderedCalls ? [prefix, renderedCalls].filter(Boolean).join('\n') : prefix;
    responseByStepId.set(step.id, text);
  }

  return {
    async complete(request: CompletionRequest): Promise<string> {
      const step = selectScenarioStep(scenario, request);

      if (step.delayMs) {
        await wait(step.delayMs, request.signal);
      }

      if (step.error) {
        if (step.error === 'timeout') {
          await wait(24 * 60 * 60 * 1000, request.signal);
        }
        if (step.error === 'network') {
          throw new Error('Network request failed: fake network error');
        }
        if (step.error === 'http') {
          throw new Error('OpenRouter server error (502): fake upstream error');
        }
        if (step.error === 'parse') {
          throw new Error('Failed to parse OpenRouter completion JSON');
        }
      }

      const response = responseByStepId.get(step.id) ?? '';
      const model = new FakeListChatModel({ responses: [response] });
      const lcMessages = request.messages.map(toLcMessage);
      const output = await model.invoke(lcMessages);
      return extractText(output);
    },
  };
}
