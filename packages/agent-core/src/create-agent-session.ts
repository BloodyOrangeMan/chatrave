import { createOpenAI } from '@ai-sdk/openai';
import { stepCountIs, streamText, tool } from 'ai';
import type { RunnerContextEnvelope, RunnerEvent } from '@chatrave/shared-types';
import {
  dispatchToolCall,
  type KnowledgeSources,
  type ReadCodeInput,
  type ToolCall,
  type ToolResult,
} from '@chatrave/agent-tools';
import { z } from 'zod';
import { getMockScenario } from './mock-scenarios';
import { SYSTEM_PROMPT } from './system-prompt';
import type { AgentSession, AgentSessionConfig } from './types';

interface ReadSnapshot {
  code: string;
  hash: string;
}

function createIds(now: () => number): { turnId: string; messageId: string } {
  const id = `${now()}-${Math.random().toString(16).slice(2, 8)}`;
  return { turnId: `turn-${id}`, messageId: `msg-${id}` };
}

function splitChunks(content: string, size: number): string[] {
  if (!content) return [];
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += size) {
    chunks.push(content.slice(i, i + size));
  }
  return chunks;
}

function toReadSnapshot(value: unknown): ReadSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const maybe = value as { code?: unknown; hash?: unknown };
  if (typeof maybe.code !== 'string' || typeof maybe.hash !== 'string') return null;
  return { code: maybe.code, hash: maybe.hash };
}

function buildEnvelope(
  config: AgentSessionConfig,
  active: ReadSnapshot | null,
  includeActiveCode: boolean,
): RunnerContextEnvelope {
  const snapshot = config.getReplSnapshot?.() ?? {
    activeCodeHash: active?.hash ?? 'unknown',
    started: false,
    quantizeMode: 'next_cycle' as const,
  };

  if (active) {
    snapshot.activeCodeHash = active.hash;
    if (includeActiveCode) {
      snapshot.activeCode = active.code;
    } else {
      delete snapshot.activeCode;
    }
  }

  return {
    snapshot,
    toolBudgetRemaining: config.globalToolBudget ?? 40,
    repairAttemptsRemaining: config.maxRepairAttempts ?? 4,
  };
}

function extractApplyStatus(result: ToolResult): { status: 'scheduled' | 'applied' | 'rejected'; applyAt?: string; reason?: string } | null {
  if (result.name !== 'apply_strudel_change') return null;
  if (result.status === 'failed') {
    return { status: 'rejected', reason: result.error?.message ?? 'apply failed' };
  }
  if (!result.output || typeof result.output !== 'object') return null;
  const output = result.output as { status?: unknown; applyAt?: unknown; diagnostics?: unknown };
  if (output.status === 'scheduled' || output.status === 'applied') {
    return { status: output.status, applyAt: typeof output.applyAt === 'string' ? output.applyAt : undefined };
  }
  if (output.status === 'rejected') {
    const diagnostics = Array.isArray(output.diagnostics)
      ? output.diagnostics.filter((item): item is string => typeof item === 'string')
      : [];
    return { status: 'rejected', reason: diagnostics.join('; ') || 'apply rejected' };
  }
  return null;
}

function mapReasoningEffort(mode: 'fast' | 'balanced' | 'deep'): 'low' | 'medium' | 'high' {
  if (mode === 'fast') return 'low';
  if (mode === 'deep') return 'high';
  return 'medium';
}

function createApplyInputSchema() {
  return z.object({
    baseHash: z.string().min(1, 'baseHash is required'),
    change: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('full_code'), content: z.string() }),
      z.object({
        kind: z.literal('search_replace'),
        search: z.string(),
        replace: z.string(),
        occurrence: z.enum(['single', 'all']).optional(),
      }),
    ]),
  });
}

function createReadInputSchema() {
  return z.object({ path: z.string().optional(), query: z.string().optional() }).passthrough();
}

function createKnowledgeInputSchema() {
  return z.object({
    query: z.union([
      z.string(),
      z.object({ q: z.string(), domain: z.enum(['auto', 'reference', 'sounds']).optional() }),
    ]),
  });
}

export function createAgentSession(config: AgentSessionConfig): AgentSession {
  const now = config.now ?? Date.now;
  const listeners = new Set<(event: RunnerEvent) => void>();
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const completedSource = new Map<string, string>();
  let running: { turnId: string; abortController: AbortController } | null = null;
  let cachedKnowledge: KnowledgeSources | undefined;
  let lastModelKnownHash: string | null = null;
  let omitRuntimeContext = false;

  const emit = (event: RunnerEvent): void => {
    for (const listener of listeners) listener(event);
  };

  const ensureKnowledge = async (): Promise<void> => {
    if (cachedKnowledge || !config.getKnowledgeSources) return;
    cachedKnowledge = await config.getKnowledgeSources();
  };

  async function executeTurn(sourceMessageId: string, text: string): Promise<{ turnId: string; messageId: string }> {
    const ids = createIds(now);
    const startedAt = now();
    if (running) running.abortController.abort();
    const abortController = new AbortController();
    running = { turnId: ids.turnId, abortController };
    emit({ type: 'runner.state.changed', payload: { runningTurnId: ids.turnId } });

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const toolResults: ToolResult[] = [];

    try {
      const skipContext = omitRuntimeContext;
      omitRuntimeContext = false;

      const active = config.readCode ? toReadSnapshot(await config.readCode({ path: 'active' } as ReadCodeInput)) : null;
      const includeActiveCode =
        !skipContext && !!active && active.code.trim().length > 0 && active.hash !== lastModelKnownHash;
      if (active) lastModelKnownHash = active.hash;

      const contextEnvelope = buildEnvelope(config, active, includeActiveCode);
      const contextualUserText = skipContext
        ? `User request:\n${text}`
        : `[runtime_context]\n${JSON.stringify(contextEnvelope)}\n[/runtime_context]\n\nUser request:\n${text}`;

      const runTool = async (name: ToolCall['name'], input: unknown, id?: string): Promise<unknown> => {
        const call: ToolCall = {
          id: id ?? `tool-${now()}-${Math.random().toString(16).slice(2, 8)}`,
          name,
          input,
        };

        if (call.name === 'strudel_knowledge') {
          await ensureKnowledge();
        }

        emit({ type: 'tool.call.started', payload: { id: call.id, name: call.name } });
        const result = await dispatchToolCall(call, {
          now,
          readCode: config.readCode,
          applyStrudelChange: config.applyStrudelChange as never,
          knowledgeSources: cachedKnowledge,
        });
        toolResults.push(result);

        emit({
          type: 'tool.call.completed',
          payload: {
            id: result.id,
            name: result.name,
            status: result.status,
            durationMs: result.durationMs,
            request: call.input,
            response: result.output,
            errorMessage: result.error?.message,
          },
        });

        const applyStatus = extractApplyStatus(result);
        if (applyStatus) {
          emit({
            type: 'apply.status.changed',
            payload: { status: applyStatus.status, applyAt: applyStatus.applyAt, reason: applyStatus.reason },
          });
        }

        if (result.status === 'failed') {
          return { status: 'tool_failed', message: result.error?.message ?? 'Tool failed' };
        }
        return result.output ?? {};
      };

      let finalText = '';
      let emittedText = '';
      let sawThinking = false;
      let sawTextDelta = false;

      timeoutHandle = setTimeout(() => abortController.abort(), config.modelTimeoutMs ?? 120_000);

      if (config.mock?.enabled) {
        const scenario = getMockScenario(config.mock.scenario);
        for (const step of scenario.steps) {
          if (step.thinking) {
            for (const delta of splitChunks(step.thinking, 5)) {
              sawThinking = true;
              emit({ type: 'assistant.thinking.delta', payload: { turnId: ids.turnId, messageId: ids.messageId, delta } });
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          }

          if (Array.isArray(step.toolCalls)) {
            for (const call of step.toolCalls) {
              await runTool(call.name, call.input);
            }
          }

          if (step.response) {
            finalText = `${finalText}${finalText ? '\n\n' : ''}${step.response}`;
            for (const delta of splitChunks(step.response, 3)) {
              sawTextDelta = true;
              emittedText += delta;
              emit({ type: 'assistant.stream.delta', payload: { turnId: ids.turnId, messageId: ids.messageId, delta } });
              await new Promise((resolve) => setTimeout(resolve, 16));
            }
          }
        }
      } else {
        const provider = createOpenAI({
          apiKey: config.settings.apiKey,
          baseURL: 'https://openrouter.ai/api/v1',
        });

        const result = streamText({
          model: provider.chat(config.settings.model),
          temperature: config.settings.temperature,
          stopWhen: stepCountIs(config.maxSteps ?? 16),
          abortSignal: abortController.signal,
          system: SYSTEM_PROMPT,
          messages: [...history, { role: 'user', content: contextualUserText }],
          providerOptions: config.settings.reasoningEnabled
            ? { openai: { reasoning: { effort: mapReasoningEffort(config.settings.reasoningMode) } } }
            : undefined,
          tools: {
            read_code: tool({
              description: 'Read active code/context before editing.',
              inputSchema: createReadInputSchema(),
              execute: async (input, options) => runTool('read_code', input, options.toolCallId),
            }),
            apply_strudel_change: tool({
              description: 'Apply validated Strudel change with dry-run and quantized swap.',
              inputSchema: createApplyInputSchema(),
              execute: async (input, options) => runTool('apply_strudel_change', input, options.toolCallId),
            }),
            strudel_knowledge: tool({
              description: 'Lookup Strudel reference/sounds with fuzzy ranking.',
              inputSchema: createKnowledgeInputSchema(),
              execute: async (input, options) => runTool('strudel_knowledge', input, options.toolCallId),
            }),
          },
        });

        for await (const chunk of result.fullStream as AsyncIterable<Record<string, unknown>>) {
          const type = typeof chunk.type === 'string' ? chunk.type : '';
          const delta =
            typeof chunk.textDelta === 'string'
              ? chunk.textDelta
              : typeof chunk.text === 'string'
                ? chunk.text
                : '';

          if (type === 'reasoning-delta' && delta) {
            sawThinking = true;
            emit({ type: 'assistant.thinking.delta', payload: { turnId: ids.turnId, messageId: ids.messageId, delta } });
            continue;
          }

          if (type === 'text-delta' && delta) {
            sawTextDelta = true;
            emittedText += delta;
            emit({ type: 'assistant.stream.delta', payload: { turnId: ids.turnId, messageId: ids.messageId, delta } });
          }
        }

        finalText = emittedText || (await result.text) || '';
      }

      if (!finalText.trim()) {
        finalText = 'I could not produce a complete answer. Please retry with a narrower request.';
      }

      if (!sawTextDelta && finalText) {
        for (const delta of splitChunks(finalText, 2)) {
          emit({ type: 'assistant.stream.delta', payload: { turnId: ids.turnId, messageId: ids.messageId, delta } });
        }
      }

      emit({ type: 'assistant.thinking.completed', payload: { turnId: ids.turnId, messageId: ids.messageId } });

      const endedAt = now();
      emit({
        type: 'assistant.turn.completed',
        payload: {
          turnId: ids.turnId,
          messageId: ids.messageId,
          status: 'completed',
          timing: { startedAt, endedAt, durationMs: endedAt - startedAt },
          content: finalText,
          completedReason: sawThinking ? 'normal' : 'normal',
        },
      });

      history.push({ role: 'user', content: text });
      history.push({ role: 'assistant', content: finalText });
      completedSource.set(sourceMessageId, text);
      return ids;
    } catch (error) {
      const endedAt = now();
      emit({ type: 'assistant.thinking.completed', payload: { turnId: ids.turnId, messageId: ids.messageId } });
      if (abortController.signal.aborted) {
        emit({
          type: 'assistant.turn.canceled',
          payload: {
            turnId: ids.turnId,
            messageId: ids.messageId,
            status: 'canceled',
            timing: { startedAt, endedAt, durationMs: endedAt - startedAt },
          },
        });
      } else {
        emit({
          type: 'chat.message.failed',
          payload: {
            message: { id: ids.messageId, role: 'assistant', content: '', status: 'failed', createdAt: startedAt },
            reason: (error as Error).message,
          },
        });
      }
      return ids;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (running?.turnId === ids.turnId) running = null;
      emit({ type: 'runner.state.changed', payload: { runningTurnId: null } });
    }
  }

  return {
    async sendUserMessage(text: string) {
      return executeTurn(`u-${now()}`, text);
    },
    stopGeneration(turnId?: string) {
      if (!running) return;
      if (turnId && running.turnId !== turnId) return;
      running.abortController.abort();
    },
    async retryMessage(messageId: string) {
      const source = completedSource.get(messageId);
      if (!source) {
        throw new Error(`No source message stored for retry: ${messageId}`);
      }
      return executeTurn(messageId, source);
    },
    resetContext(options) {
      if (running) {
        running.abortController.abort();
        running = null;
      }
      if (options?.omitRuntimeContext) {
        omitRuntimeContext = true;
      }
      history.length = 0;
      completedSource.clear();
      lastModelKnownHash = null;
      emit({ type: 'runner.state.changed', payload: { runningTurnId: null } });
    },
    subscribeToEvents(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
