import { createUIMessageStream, DirectChatTransport, type ChatTransport, type UIMessage, type UIMessageChunk } from 'ai';
import { createJamAgent, getMockScenario } from '@chatrave/agent-core';
import type { AgentSettings } from '@chatrave/shared-types';
import { dispatchToolCall, type StrudelKnowledgeInput, type ToolCall } from '@chatrave/agent-tools';
import { createStrudelBridge, type AgentHostContext } from '@chatrave/strudel-bridge';
import { isDevFakeUiEnabled, readRuntimeScenario } from './runtime-overrides';

export type { AgentHostContext } from '@chatrave/strudel-bridge';

export interface ChatRuntime {
  transport: ChatTransport<any>;
  clearActiveCode(): void;
  runDevKnowledge(input: StrudelKnowledgeInput): Promise<unknown>;
}

function chunkText(input: string, size: number): string[] {
  if (!input) return [];
  const chunks: string[] = [];
  for (let index = 0; index < input.length; index += size) {
    chunks.push(input.slice(index, index + size));
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createMockTransport(context: {
  scenarioName?: string;
  runTool: (name: ToolCall['name'], input: unknown) => Promise<unknown>;
}): ChatTransport<UIMessage> {
  return {
    async sendMessages({ messages, abortSignal }) {
      const scenario = getMockScenario(context.scenarioName);
      console.log('[chatrave][ai-request] systemPrompt', 'mock-scenario');
      console.log('[chatrave][ai-request] providerOptions', { mode: 'mock', scenario: scenario.name });
      console.log('[chatrave][ai-request] tools', ['read_code', 'apply_strudel_change', 'strudel_knowledge']);
      console.log('[chatrave][ai-request] messages', messages);
      const stream = createUIMessageStream<UIMessage>({
        originalMessages: messages,
        execute: async ({ writer }) => {
          const thinkingId = `reasoning-${Date.now()}`;
          const textId = `text-${Date.now()}`;

          for (const step of scenario.steps) {
            if (abortSignal?.aborted) {
              writer.write({ type: 'abort', reason: 'aborted' });
              return;
            }

            if (step.thinking) {
              writer.write({ type: 'reasoning-start', id: thinkingId });
              for (const delta of chunkText(step.thinking, 12)) {
                writer.write({ type: 'reasoning-delta', id: thinkingId, delta });
                await sleep(28);
              }
              writer.write({ type: 'reasoning-end', id: thinkingId });
            }

            if (Array.isArray(step.toolCalls)) {
              for (const toolCall of step.toolCalls) {
                if (abortSignal?.aborted) {
                  writer.write({ type: 'abort', reason: 'aborted' });
                  return;
                }
                const toolCallId = `${toolCall.name}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
                writer.write({
                  type: 'tool-input-available',
                  toolCallId,
                  toolName: toolCall.name,
                  input: toolCall.input,
                } as UIMessageChunk);
                try {
                  const output = await context.runTool(toolCall.name, toolCall.input);
                  writer.write({ type: 'tool-output-available', toolCallId, output } as UIMessageChunk);
                } catch (error) {
                  writer.write({
                    type: 'tool-output-error',
                    toolCallId,
                    errorText: (error as Error).message,
                  } as UIMessageChunk);
                }
              }
            }

            if (step.response) {
              writer.write({ type: 'text-start', id: textId });
              for (const delta of chunkText(step.response, 7)) {
                writer.write({ type: 'text-delta', id: textId, delta });
                await sleep(20);
              }
              writer.write({ type: 'text-end', id: textId });
            }
          }
        },
      });
      return stream;
    },
    async reconnectToStream() {
      return null;
    },
  };
}

export function createChatRuntime(settings: AgentSettings, hostContext?: AgentHostContext): ChatRuntime {
  const bridge = createStrudelBridge(hostContext);
  const mockEnabled = isDevFakeUiEnabled();
  const scenario = readRuntimeScenario();

  const runTool = async (name: ToolCall['name'], input: unknown): Promise<unknown> => {
    const knowledgeSources = name === 'strudel_knowledge' ? await bridge.getKnowledgeSources() : undefined;
    const result = await dispatchToolCall(
      {
        id: `${name}-${Date.now()}`,
        name,
        input,
      },
      {
        readCode: bridge.readCode,
        applyStrudelChange: bridge.applyStrudelChange,
        knowledgeSources,
      },
    );

    if (result.status === 'failed') {
      throw new Error(result.error?.message ?? `${name} failed`);
    }
    return result.output ?? {};
  };

  const transport = mockEnabled
    ? createMockTransport({
        scenarioName: scenario,
        runTool,
      })
    : (new DirectChatTransport({
        agent: createJamAgent({
          settings,
          maxSteps: 24,
          globalToolBudget: 40,
          maxRepairAttempts: 4,
          getReplSnapshot: bridge.getReplSnapshot,
          readCode: bridge.readCode,
          applyStrudelChange: bridge.applyStrudelChange,
          getKnowledgeSources: bridge.getKnowledgeSources,
        }),
      }) as ChatTransport<any>);

  return {
    transport,
    clearActiveCode() {
      bridge.clearActiveCode();
    },
    async runDevKnowledge(input) {
      const knowledgeSources = await bridge.getKnowledgeSources();
      const result = await dispatchToolCall(
        {
          id: `dev-knowledge-${Date.now()}`,
          name: 'strudel_knowledge',
          input,
        },
        { knowledgeSources },
      );
      return result.output ?? result.error ?? { status: 'unavailable' };
    },
  };
}
