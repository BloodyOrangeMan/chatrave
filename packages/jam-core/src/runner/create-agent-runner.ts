import type { RunnerContextEnvelope, RunnerEvent } from '@chatrave/shared-types';
import type { CompletionClient } from '../llm/contracts';
import { createOpenRouterCompletionClient } from '../llm/openrouter/adapter';
import { buildSystemPrompt } from '../prompts/loader';
import { dispatchToolCall } from '../tools/dispatcher';
import { mapModeToEffort } from './model-profile';
import { parsePseudoFunctionCalls } from './tool-call-parser';
import type { AgentRunner, AgentRunnerConfig } from './types';
import type { ToolResult } from '../tools/contracts';

function createIds(now: () => number): { turnId: string; messageId: string } {
  const id = `${now()}-${Math.random().toString(16).slice(2, 8)}`;
  return { turnId: `turn-${id}`, messageId: `msg-${id}` };
}

function makeContextEnvelope(config: AgentRunnerConfig): RunnerContextEnvelope {
  const fallbackSnapshot = {
    activeCodeHash: 'unknown',
    started: false,
    recentUserIntent: '',
  };

  return {
    snapshot: config.getReplSnapshot?.() ?? fallbackSnapshot,
    toolBudgetRemaining: config.globalToolBudget ?? 20,
    repairAttemptsRemaining: config.maxRepairAttempts ?? 4,
  };
}

function formatToolResults(results: unknown[]): string {
  return JSON.stringify(results, null, 2);
}

function isPlanningOnlyReply(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  return /^(i('| a)m|i will|i('|’)ll)\s+(check|inspect|look at|review)\b/i.test(trimmed) && trimmed.length < 260;
}

function isSufficientPostToolResponse(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const looksLikePlanningOnly = isPlanningOnlyReply(trimmed);
  if (looksLikePlanningOnly && trimmed.length < 200) {
    return false;
  }

  return true;
}

function summarizeToolResultsForFallback(results: unknown[]): string {
  if (!Array.isArray(results) || results.length === 0) {
    return 'No tool output was available.';
  }

  for (const result of results) {
    if (!result || typeof result !== 'object') {
      continue;
    }
    const maybe = result as {
      name?: unknown;
      status?: unknown;
      output?: unknown;
      error?: { message?: unknown };
    };
    if (maybe.name === 'apply_strudel_change') {
      if (maybe.status === 'failed') {
        const reason = typeof maybe.error?.message === 'string' ? maybe.error.message : 'apply failed';
        return `Apply failed: ${reason}.`;
      }
      if (maybe.output && typeof maybe.output === 'object') {
        const apply = maybe.output as {
          status?: unknown;
          diagnostics?: unknown;
          applyAt?: unknown;
        };
        if (apply.status === 'rejected') {
          const diagnostics = Array.isArray(apply.diagnostics)
            ? apply.diagnostics.filter((item): item is string => typeof item === 'string')
            : [];
          if (diagnostics.length > 0) {
            return `Apply rejected: ${diagnostics.join('; ')}.`;
          }
          return 'Apply rejected by validation.';
        }
        if (apply.status === 'scheduled') {
          return typeof apply.applyAt === 'string'
            ? `Apply scheduled at ${apply.applyAt}.`
            : 'Apply scheduled on next quantized boundary.';
        }
        if (apply.status === 'applied') {
          return 'Apply completed successfully.';
        }
      }
    }
  }

  return 'Tools completed, but final model response was empty.';
}

function extractApplyToolOutput(result: ToolResult): { status?: string; applyAt?: string; diagnostics?: string[] } {
  if (!result.output || typeof result.output !== 'object') {
    return {};
  }
  const maybe = result.output as { status?: unknown; applyAt?: unknown; diagnostics?: unknown };
  return {
    status: typeof maybe.status === 'string' ? maybe.status : undefined,
    applyAt: typeof maybe.applyAt === 'string' ? maybe.applyAt : undefined,
    diagnostics: Array.isArray(maybe.diagnostics)
      ? maybe.diagnostics.filter((item): item is string => typeof item === 'string')
      : undefined,
  };
}

export function createAgentRunner(config: AgentRunnerConfig): AgentRunner {
  const listeners = new Set<(event: RunnerEvent) => void>();
  const now = config.now ?? Date.now;
  let running: { turnId: string; abortController: AbortController } | null = null;
  const completedContent = new Map<string, string>();
  let omitRuntimeContext = false;
  const completionClient: CompletionClient =
    config.completionClient ??
    createOpenRouterCompletionClient({
      baseUrl: config.openRouterBaseUrl,
      extraHeaders: config.openRouterExtraHeaders,
    });

  const emit = (event: RunnerEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  async function callModel(
    signal: AbortSignal,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  ): Promise<string> {
    const timeoutMs = config.modelTimeoutMs ?? 120_000;
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);
    const abortOnParent = () => timeoutController.abort();
    signal.addEventListener('abort', abortOnParent, { once: true });

    try {
      return await completionClient.complete({
        apiKey: config.settings.apiKey,
        model: config.settings.model,
        temperature: config.settings.temperature,
        reasoningEnabled: config.settings.reasoningEnabled,
        reasoningEffort: mapModeToEffort(config.settings.reasoningMode),
        messages,
        signal: timeoutController.signal,
      });
    } catch (error) {
      if (timeoutController.signal.aborted && !signal.aborted) {
        throw new Error(`Model timeout after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
      signal.removeEventListener('abort', abortOnParent);
    }
  }

  async function executeTurn(messageId: string, text: string): Promise<{ turnId: string; messageId: string }> {
    const ids = createIds(now);
    const start = now();

    if (running) {
      running.abortController.abort();
    }

    const abortController = new AbortController();
    running = { turnId: ids.turnId, abortController };
    emit({ type: 'runner.state.changed', payload: { runningTurnId: ids.turnId } });

    try {
      const prompt = await buildSystemPrompt({
        vars: {
          MAX_REPAIR_ATTEMPTS: String(config.maxRepairAttempts ?? 4),
          GLOBAL_TOOL_BUDGET: String(config.globalToolBudget ?? 20),
        },
      });
      if (prompt.unresolvedPlaceholders.length > 0) {
        throw new Error(`Unresolved prompt placeholders: ${prompt.unresolvedPlaceholders.join(', ')}`);
      }

      const skipRuntimeContextThisTurn = omitRuntimeContext;
      omitRuntimeContext = false;
      const contextualUserText = skipRuntimeContextThisTurn
        ? `User request:\n${text}`
        : `[runtime_context]\n${JSON.stringify(makeContextEnvelope(config))}\n[/runtime_context]\n\nUser request:\n${text}`;

      const maxToolRoundsPerTurn = 4;
      let remainingToolBudget = config.globalToolBudget ?? 20;
      let toolRounds = 0;
      let applyOutcome: 'scheduled' | 'applied' | 'rejected' | null = null;
      let forcedFinalAttempted = false;
      let completionReason: 'normal' | 'forced_final' | 'fallback_final' = 'normal';
      let finalContent = '';
      let lastToolResults: unknown[] = [];

      let response = await callModel(abortController.signal, [
        { role: 'system', content: prompt.prompt },
        { role: 'user', content: contextualUserText },
      ]);

      while (true) {
        const parsed = parsePseudoFunctionCalls(response);
        const cleaned = parsed.cleanedText.trim();

        if (parsed.calls.length === 0) {
          if (toolRounds > 0 && !isSufficientPostToolResponse(cleaned) && !forcedFinalAttempted) {
            forcedFinalAttempted = true;
            completionReason = 'forced_final';
            response = await callModel(abortController.signal, [
              { role: 'system', content: prompt.prompt },
              { role: 'user', content: contextualUserText },
              {
                role: 'assistant',
                content: cleaned || 'I used tools to inspect and prepare a response.',
              },
              {
                role: 'user',
                content:
                  `Tool results:\n${formatToolResults(lastToolResults)}\n\n` +
                  'Your previous answer was empty. Respond now with final user-facing Strudel guidance only. No tool tags.',
              },
            ]);
            continue;
          }

          finalContent = cleaned;
          break;
        }

        if (toolRounds >= maxToolRoundsPerTurn) {
          finalContent = 'Stopped after maximum tool rounds. Try a narrower request.';
          break;
        }
        toolRounds += 1;

        const toolResults: unknown[] = [];
        for (const call of parsed.calls) {
          if (remainingToolBudget <= 0) {
            finalContent = 'Stopped after exhausting tool budget. Try a narrower request.';
            break;
          }
          remainingToolBudget -= 1;

          emit({ type: 'tool.call.started', payload: { id: call.id, name: call.name } });
          const result = await dispatchToolCall(call, {
            now,
            readCode: config.readCode,
            applyStrudelChange: config.applyStrudelChange,
            knowledgeSources: config.knowledgeSources,
          });
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

          if (call.name === 'apply_strudel_change' && !applyOutcome) {
            if (result.status === 'failed') {
              emit({
                type: 'apply.status.changed',
                payload: { status: 'rejected', reason: result.error?.message || 'apply failed' },
              });
              applyOutcome = 'rejected';
            } else {
              const output = extractApplyToolOutput(result);
              if (output.status === 'scheduled' || output.status === 'applied') {
                emit({
                  type: 'apply.status.changed',
                  payload: { status: output.status, applyAt: output.applyAt },
                });
                applyOutcome = output.status;
              } else {
                emit({
                  type: 'apply.status.changed',
                  payload: { status: 'rejected', reason: output.diagnostics?.join('; ') || 'apply failed' },
                });
                applyOutcome = 'rejected';
              }
            }
          }

          toolResults.push(result);
        }

        if (finalContent) {
          break;
        }
        lastToolResults = toolResults;

        response = await callModel(abortController.signal, [
          { role: 'system', content: prompt.prompt },
          { role: 'user', content: contextualUserText },
          {
            role: 'assistant',
            content: cleaned || 'I used tools to inspect and prepare a response.',
          },
          {
            role: 'user',
            content:
              `Tool results:\n${formatToolResults(toolResults)}\n\n` +
              'Provide the final user-facing response. Do not output <function_calls> tags.',
          },
        ]);
      }

      if (!finalContent.trim()) {
        completionReason = 'fallback_final';
        finalContent = [
          'I could not generate a complete final response this turn.',
          summarizeToolResultsForFallback(lastToolResults),
          'Please retry and I will continue from the latest state.',
        ].join(' ');
      }

      if (finalContent) {
        emit({
          type: 'assistant.stream.delta',
          payload: { turnId: ids.turnId, messageId: ids.messageId, delta: finalContent },
        });
      }

      const end = now();
      completedContent.set(messageId, text);
      emit({
        type: 'assistant.turn.completed',
        payload: {
          turnId: ids.turnId,
          messageId: ids.messageId,
          status: 'completed',
          timing: { startedAt: start, endedAt: end, durationMs: end - start },
          content: finalContent,
          completedReason: completionReason,
        },
      });
    } catch (error) {
      const aborted = abortController.signal.aborted;
      const end = now();

      if (aborted) {
        emit({
          type: 'assistant.turn.canceled',
          payload: {
            turnId: ids.turnId,
            messageId: ids.messageId,
            status: 'canceled',
            timing: { startedAt: start, endedAt: end, durationMs: end - start },
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
              createdAt: start,
            },
            reason: (error as Error).message,
          },
        });
      }
    } finally {
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
