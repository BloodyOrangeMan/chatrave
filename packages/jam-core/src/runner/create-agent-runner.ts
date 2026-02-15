import { createOpenAI } from '@ai-sdk/openai';
import { stepCountIs, streamText, tool } from 'ai';
import type { RunnerContextEnvelope, RunnerEvent } from '@chatrave/shared-types';
import { z } from 'zod';
import { buildSystemPrompt } from '../prompts/loader';
import { dispatchToolCall } from '../tools/dispatcher';
import type { ToolCall, ToolResult } from '../tools/contracts';
import { mapModeToEffort } from './model-profile';
import { parsePseudoFunctionCalls } from './tool-call-parser';
import type { AgentRunner, AgentRunnerConfig } from './types';

function createIds(now: () => number): { turnId: string; messageId: string } {
  const id = `${now()}-${Math.random().toString(16).slice(2, 8)}`;
  return { turnId: `turn-${id}`, messageId: `msg-${id}` };
}

interface ReadCodeSnapshot {
  code: string;
  hash: string;
}

interface RuntimeContextOptions {
  activeSnapshot: ReadCodeSnapshot | null;
  includeActiveCode: boolean;
}

function makeContextEnvelope(config: AgentRunnerConfig, options: RuntimeContextOptions): RunnerContextEnvelope {
  const fallbackSnapshot: RunnerContextEnvelope['snapshot'] = {
    activeCodeHash: 'unknown',
    started: false,
    recentUserIntent: '',
  };
  const baseSnapshot = config.getReplSnapshot?.() ?? fallbackSnapshot;
  const snapshot = { ...baseSnapshot };

  if (options.activeSnapshot) {
    snapshot.activeCodeHash = options.activeSnapshot.hash;
    if (options.includeActiveCode) {
      snapshot.activeCode = options.activeSnapshot.code;
    } else if ('activeCode' in snapshot) {
      delete snapshot.activeCode;
    }
  }

  return {
    snapshot,
    toolBudgetRemaining: config.globalToolBudget ?? 40,
    repairAttemptsRemaining: config.maxRepairAttempts ?? 4,
  };
}

function toReadCodeSnapshot(output: unknown): ReadCodeSnapshot | null {
  if (!output || typeof output !== 'object') {
    return null;
  }
  const maybe = output as { code?: unknown; hash?: unknown };
  if (typeof maybe.code !== 'string' || typeof maybe.hash !== 'string') {
    return null;
  }
  return { code: maybe.code, hash: maybe.hash };
}

async function readActiveSnapshot(config: AgentRunnerConfig): Promise<ReadCodeSnapshot | null> {
  if (!config.readCode) {
    return null;
  }
  const output = await config.readCode({ path: 'active' });
  return toReadCodeSnapshot(output);
}

function splitForUiStreaming(content: string, chunkSize: number): string[] {
  if (!content) {
    return [];
  }
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += chunkSize) {
    chunks.push(content.slice(i, i + chunkSize));
  }
  return chunks;
}

function summarizeToolResultsForFallback(results: ToolResult[]): string {
  if (!Array.isArray(results) || results.length === 0) {
    return 'No tool output was available.';
  }

  for (const result of results) {
    if (result.name !== 'apply_strudel_change') {
      continue;
    }
    if (result.status === 'failed') {
      return `Apply failed: ${result.error?.message ?? 'runtime error'}.`;
    }
    if (!result.output || typeof result.output !== 'object') {
      continue;
    }
    const output = result.output as {
      status?: unknown;
      diagnostics?: unknown;
      applyAt?: unknown;
    };
    if (output.status === 'rejected') {
      const diagnostics = Array.isArray(output.diagnostics)
        ? output.diagnostics.filter((item): item is string => typeof item === 'string')
        : [];
      return diagnostics.length > 0 ? `Apply rejected: ${diagnostics.join('; ')}.` : 'Apply rejected.';
    }
    if (output.status === 'scheduled') {
      return typeof output.applyAt === 'string'
        ? `Apply scheduled at ${output.applyAt}.`
        : 'Apply scheduled on quantized boundary.';
    }
    if (output.status === 'applied') {
      return 'Apply completed successfully.';
    }
  }

  return 'Tools completed without a final user-facing answer.';
}

function extractApplyStatus(result: ToolResult): { status: 'scheduled' | 'applied' | 'rejected'; applyAt?: string; reason?: string } | null {
  if (result.name !== 'apply_strudel_change') {
    return null;
  }

  if (result.status === 'failed') {
    return {
      status: 'rejected',
      reason: result.error?.message ?? 'apply failed',
    };
  }

  if (!result.output || typeof result.output !== 'object') {
    return null;
  }

  const output = result.output as {
    status?: unknown;
    applyAt?: unknown;
    diagnostics?: unknown;
  };

  if (output.status === 'scheduled' || output.status === 'applied') {
    return {
      status: output.status,
      applyAt: typeof output.applyAt === 'string' ? output.applyAt : undefined,
    };
  }

  if (output.status === 'rejected') {
    const diagnostics = Array.isArray(output.diagnostics)
      ? output.diagnostics.filter((item): item is string => typeof item === 'string')
      : [];
    return {
      status: 'rejected',
      reason: diagnostics.join('; ') || 'apply rejected',
    };
  }

  return null;
}

function createApplyInputSchema() {
  return z.object({
    baseHash: z.string().min(1, 'baseHash is required'),
    change: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('full_code'),
        content: z.string(),
      }),
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
  return z
    .object({
      path: z.string().optional(),
      query: z.string().optional(),
    })
    .passthrough();
}

function createKnowledgeInputSchema() {
  return z.object({
    query: z.union([
      z.string(),
      z.object({
        q: z.string(),
        domain: z.enum(['auto', 'reference', 'sounds']).optional(),
      }),
    ]),
  });
}

function toStructuredToolCalls(raw: Array<{ id: string; name: string; argumentsJson: string }>, now: () => number): ToolCall[] {
  return raw
    .map((call, index) => {
      const name = call.name;
      if (name !== 'read_code' && name !== 'apply_strudel_change' && name !== 'strudel_knowledge') {
        return null;
      }
      let input: unknown = {};
      try {
        input = JSON.parse(call.argumentsJson || '{}');
      } catch {
        input = {};
      }
      return {
        id: call.id || `tool-${now()}-${index}`,
        name,
        input,
      };
    })
    .filter((value): value is ToolCall => Boolean(value));
}

export function createAgentRunner(config: AgentRunnerConfig): AgentRunner {
  const listeners = new Set<(event: RunnerEvent) => void>();
  const now = config.now ?? Date.now;
  const completedContent = new Map<string, string>();
  let running: { turnId: string; abortController: AbortController } | null = null;
  let omitRuntimeContext = false;
  let cachedKnowledgeSources = config.knowledgeSources;
  let lastModelKnownHash: string | null = null;

  const emit = (event: RunnerEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  async function executeTurn(messageId: string, text: string): Promise<{ turnId: string; messageId: string }> {
    const ids = createIds(now);
    const startedAt = now();

    if (running) {
      running.abortController.abort();
    }

    const abortController = new AbortController();
    running = { turnId: ids.turnId, abortController };
    emit({ type: 'runner.state.changed', payload: { runningTurnId: ids.turnId } });
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      const prompt = await buildSystemPrompt({
        vars: {
          MAX_REPAIR_ATTEMPTS: String(config.maxRepairAttempts ?? 4),
          GLOBAL_TOOL_BUDGET: String(config.globalToolBudget ?? 40),
        },
      });
      if (prompt.unresolvedPlaceholders.length > 0) {
        throw new Error(`Unresolved prompt placeholders: ${prompt.unresolvedPlaceholders.join(', ')}`);
      }

      const skipRuntimeContextThisTurn = omitRuntimeContext;
      omitRuntimeContext = false;

      const activeSnapshot = await readActiveSnapshot(config);
      const includeActiveCodeInContext =
        !skipRuntimeContextThisTurn &&
        !!activeSnapshot &&
        activeSnapshot.hash !== lastModelKnownHash &&
        activeSnapshot.code.trim().length > 0;

      if (activeSnapshot) {
        lastModelKnownHash = activeSnapshot.hash;
      }

      const contextualUserText = skipRuntimeContextThisTurn
        ? `User request:\n${text}`
        : `[runtime_context]\n${JSON.stringify(
            makeContextEnvelope(config, {
              activeSnapshot,
              includeActiveCode: includeActiveCodeInContext,
            }),
          )}\n[/runtime_context]\n\nUser request:\n${text}`;

      const timeoutMs = config.modelTimeoutMs ?? 120_000;
      timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);

      let remainingToolBudget = config.globalToolBudget ?? 40;
      const maxSteps = Math.max(1, Math.min(remainingToolBudget, 24));
      const toolResults: ToolResult[] = [];
      let emittedText = '';

      const ensureKnowledgeSources = async () => {
        if (cachedKnowledgeSources || !config.getKnowledgeSources) {
          return;
        }
        try {
          cachedKnowledgeSources = await config.getKnowledgeSources();
        } catch {
          cachedKnowledgeSources = undefined;
        }
      };

      const runTool = async (name: ToolCall['name'], input: unknown, toolCallId?: string): Promise<unknown> => {
        if (remainingToolBudget <= 0) {
          return {
            status: 'rejected',
            phase: 'input',
            errorCode: 'TOOL_BUDGET_EXHAUSTED',
            diagnostics: ['Global tool budget exhausted for this turn.'],
            suggestedNext: 'Retry with a narrower request.',
          };
        }
        remainingToolBudget -= 1;

        if (name === 'strudel_knowledge') {
          await ensureKnowledgeSources();
        }

        const callId = toolCallId ?? `tool-${now()}-${Math.random().toString(16).slice(2, 8)}`;
        const call: ToolCall = { id: callId, name, input };

        emit({ type: 'tool.call.started', payload: { id: call.id, name: call.name } });

        const result = await dispatchToolCall(call, {
          now,
          readCode: config.readCode,
          applyStrudelChange: config.applyStrudelChange,
          knowledgeSources: cachedKnowledgeSources,
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
            payload: {
              status: applyStatus.status,
              applyAt: applyStatus.applyAt,
              reason: applyStatus.reason,
            },
          });
        }

        if (result.status === 'failed') {
          return { status: 'tool_failed', message: result.error?.message ?? 'Tool execution failed.' };
        }

        return result.output ?? {};
      };

      if (config.completionClient) {
        const messagesForClient: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: prompt.prompt },
          { role: 'user', content: contextualUserText },
        ];

        let finalText = '';
        let toolRound = 0;
        while (true) {
          const response = await config.completionClient.complete({
            apiKey: config.settings.apiKey,
            model: config.settings.model,
            temperature: config.settings.temperature,
            reasoningEnabled: config.settings.reasoningEnabled,
            reasoningEffort: mapModeToEffort(config.settings.reasoningMode),
            messages: messagesForClient,
            toolChoice: 'auto',
            tools: [],
            signal: abortController.signal,
            onDelta: async (delta) => {
              emittedText += delta;
              emit({
                type: 'assistant.stream.delta',
                payload: { turnId: ids.turnId, messageId: ids.messageId, delta },
              });
            },
          });
          finalText = response.content || finalText;
          const toolCalls = toStructuredToolCalls(response.toolCalls ?? [], now);
          if (toolCalls.length === 0) {
            break;
          }

          const results: ToolResult[] = [];
          for (const call of toolCalls) {
            const output = await runTool(call.name, call.input, call.id);
            results.push({
              id: call.id,
              name: call.name,
              status: 'succeeded',
              output,
              startedAt: now(),
              endedAt: now(),
              durationMs: 0,
            });
          }

          messagesForClient.push(
            { role: 'assistant', content: response.content || 'Tool calls completed.' },
            { role: 'user', content: `Tool results:\n${JSON.stringify(results, null, 2)}` },
          );
          toolRound += 1;
          if (toolRound >= Math.max(1, Math.min(config.globalToolBudget ?? 40, 8))) {
            break;
          }
        }

        if (!finalText.trim()) {
          finalText = [
            'I could not generate a complete final response this turn.',
            summarizeToolResultsForFallback(toolResults),
            'Please retry and I will continue from the latest state.',
          ].join(' ');
        }

        if (!emittedText && finalText) {
          for (const delta of splitForUiStreaming(finalText, 2)) {
            emit({
              type: 'assistant.stream.delta',
              payload: { turnId: ids.turnId, messageId: ids.messageId, delta },
            });
          }
          emittedText = finalText;
        }

        emit({
          type: 'assistant.thinking.completed',
          payload: { turnId: ids.turnId, messageId: ids.messageId },
        });

        const endedAt = now();
        completedContent.set(messageId, text);
        emit({
          type: 'assistant.turn.completed',
          payload: {
            turnId: ids.turnId,
            messageId: ids.messageId,
            status: 'completed',
            timing: {
              startedAt,
              endedAt,
              durationMs: endedAt - startedAt,
            },
            content: finalText,
            completedReason: 'normal',
          },
        });
        return ids;
      }

      const provider = createOpenAI({
        apiKey: config.settings.apiKey,
        baseURL: config.openRouterBaseUrl ?? 'https://openrouter.ai/api/v1',
        headers: config.openRouterExtraHeaders,
      });

      const modelResult = streamText({
        model: provider.chat(config.settings.model),
        temperature: config.settings.temperature,
        stopWhen: stepCountIs(maxSteps),
        abortSignal: abortController.signal,
        system: prompt.prompt,
        messages: [{ role: 'user', content: contextualUserText }],
        providerOptions: config.settings.reasoningEnabled
          ? { openai: { reasoning: { effort: mapModeToEffort(config.settings.reasoningMode) } } }
          : undefined,
        tools: {
          read_code: tool({
            description: 'Read active code/context safely before edits.',
            inputSchema: createReadInputSchema(),
            execute: async (input, options): Promise<unknown> => runTool('read_code', input, options.toolCallId),
          }),
          apply_strudel_change: tool({
            description: 'Apply a validated Strudel code change using dry-run + quantized swap.',
            inputSchema: createApplyInputSchema(),
            execute: async (input, options): Promise<unknown> => runTool('apply_strudel_change', input, options.toolCallId),
          }),
          strudel_knowledge: tool({
            description: 'Lookup Strudel reference/sounds with exact + fuzzy match.',
            inputSchema: createKnowledgeInputSchema(),
            execute: async (input, options): Promise<unknown> => runTool('strudel_knowledge', input, options.toolCallId),
          }),
        },
      });

      let sawThinking = false;
      let sawTextDelta = false;

      for await (const chunk of modelResult.fullStream as AsyncIterable<Record<string, unknown>>) {
        const type = typeof chunk.type === 'string' ? chunk.type : '';
        const delta =
          typeof chunk.textDelta === 'string'
            ? chunk.textDelta
            : typeof chunk.text === 'string'
              ? chunk.text
              : '';

        if (type === 'reasoning-delta' && delta) {
          sawThinking = true;
          emit({
            type: 'assistant.thinking.delta',
            payload: { turnId: ids.turnId, messageId: ids.messageId, delta },
          });
          continue;
        }

        if (type === 'text-delta' && delta) {
          sawTextDelta = true;
          emittedText += delta;
          emit({
            type: 'assistant.stream.delta',
            payload: { turnId: ids.turnId, messageId: ids.messageId, delta },
          });
        }
      }

      const finalTextRaw = await modelResult.text;
      let finalText = emittedText || finalTextRaw || '';

      const parsedPseudoCalls = parsePseudoFunctionCalls(finalText);
      if (toolResults.length === 0 && parsedPseudoCalls.calls.length > 0) {
        for (const call of parsedPseudoCalls.calls) {
          if (call.name !== 'read_code' && call.name !== 'apply_strudel_change' && call.name !== 'strudel_knowledge') {
            continue;
          }
          await runTool(call.name, call.input ?? {});
        }

        finalText = parsedPseudoCalls.cleanedText.trim();
        emittedText = '';

        const followUp = streamText({
          model: provider.chat(config.settings.model),
          temperature: config.settings.temperature,
          abortSignal: abortController.signal,
          system: prompt.prompt,
          messages: [
            { role: 'user', content: contextualUserText },
            { role: 'assistant', content: finalText || 'Tool calls completed.' },
            { role: 'user', content: `Tool results:\n${JSON.stringify(toolResults, null, 2)}\n\nProvide final user-facing answer only.` },
          ],
          providerOptions: config.settings.reasoningEnabled
            ? { openai: { reasoning: { effort: mapModeToEffort(config.settings.reasoningMode) } } }
            : undefined,
        });

        for await (const chunk of followUp.fullStream as AsyncIterable<Record<string, unknown>>) {
          const type = typeof chunk.type === 'string' ? chunk.type : '';
          const delta =
            typeof chunk.textDelta === 'string'
              ? chunk.textDelta
              : typeof chunk.text === 'string'
                ? chunk.text
                : '';
          if (type === 'text-delta' && delta) {
            sawTextDelta = true;
            emittedText += delta;
            emit({
              type: 'assistant.stream.delta',
              payload: { turnId: ids.turnId, messageId: ids.messageId, delta },
            });
          }
        }
        const followUpText = await followUp.text;
        finalText = emittedText || followUpText || finalText;
      }

      finalText = parsePseudoFunctionCalls(finalText).cleanedText;

      if (!finalText.trim()) {
        finalText = [
          'I could not generate a complete final response this turn.',
          summarizeToolResultsForFallback(toolResults),
          'Please retry and I will continue from the latest state.',
        ].join(' ');
      }

      if (!sawTextDelta && finalText) {
        for (const delta of splitForUiStreaming(finalText, 2)) {
          emit({
            type: 'assistant.stream.delta',
            payload: { turnId: ids.turnId, messageId: ids.messageId, delta },
          });
        }
      }

      emit({
        type: 'assistant.thinking.completed',
        payload: { turnId: ids.turnId, messageId: ids.messageId },
      });

      const endedAt = now();
      completedContent.set(messageId, text);
      emit({
        type: 'assistant.turn.completed',
        payload: {
          turnId: ids.turnId,
          messageId: ids.messageId,
          status: 'completed',
          timing: {
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
          },
          content: finalText,
          completedReason: sawThinking ? 'normal' : 'normal',
        },
      });
    } catch (error) {
      const endedAt = now();
      const aborted = abortController.signal.aborted;

      emit({
        type: 'assistant.thinking.completed',
        payload: { turnId: ids.turnId, messageId: ids.messageId },
      });

      if (aborted) {
        emit({
          type: 'assistant.turn.canceled',
          payload: {
            turnId: ids.turnId,
            messageId: ids.messageId,
            status: 'canceled',
            timing: {
              startedAt,
              endedAt,
              durationMs: endedAt - startedAt,
            },
          },
        });
      } else {
        emit({
          type: 'chat.message.failed',
          payload: {
            message: {
              id: ids.messageId,
              role: 'assistant',
              content: '',
              status: 'failed',
              createdAt: startedAt,
            },
            reason: (error as Error).message,
          },
        });
      }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (running?.turnId === ids.turnId) {
        running = null;
      }
      emit({ type: 'runner.state.changed', payload: { runningTurnId: null } });
    }

    return ids;
  }

  return {
    async sendUserMessage(text: string) {
      return executeTurn(`u-${now()}`, text);
    },
    stopGeneration(turnId?: string) {
      if (!running) {
        return;
      }
      if (turnId && running.turnId !== turnId) {
        return;
      }
      running.abortController.abort();
    },
    async retryMessage(messageId: string) {
      const source = completedContent.get(messageId);
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
      completedContent.clear();
      lastModelKnownHash = null;
      omitRuntimeContext = Boolean(options?.omitRuntimeContext);
      emit({ type: 'runner.state.changed', payload: { runningTurnId: null } });
    },
    subscribeToEvents(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
