import { createUIMessageStream, type ChatTransport, type UIMessage, type UIMessageChunk } from 'ai';
import { getMockScenario } from '@chatrave/agent-core';
import type { ToolCall } from '@chatrave/agent-tools';

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

export function createMockTransport(context: {
  scenarioName?: string;
  runTool: (name: ToolCall['name'], input: unknown) => Promise<unknown>;
}): ChatTransport<UIMessage> {
  return {
    async sendMessages({ messages, abortSignal }) {
      const scenario = getMockScenario(context.scenarioName);
      console.log('[chatrave][ai-request] systemPrompt', 'mock scenario mode');
      console.log('[chatrave][ai-request] providerOptions', { mode: 'mock', scenario: scenario.name });
      console.log('[chatrave][ai-request] tools', ['read_code', 'apply_strudel_change', 'strudel_knowledge', 'skill']);
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
