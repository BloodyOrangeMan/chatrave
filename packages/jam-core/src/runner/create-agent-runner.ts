import type { RunnerContextEnvelope, RunnerEvent } from '@chatrave/shared-types';
import { openRouterComplete } from '../llm/openrouter/client';
import { buildSystemPrompt } from '../prompts/loader';
import { dispatchToolCall } from '../tools/dispatcher';
import { mapModeToEffort } from './model-profile';
import { parsePseudoFunctionCalls } from './tool-call-parser';
import type { AgentRunner, AgentRunnerConfig } from './types';

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

function extractPrimaryCodeBlock(text: string): string | null {
  const codeBlockRegex = /```(?:javascript|js|strudel)?\s*([\s\S]*?)```/gi;
  const match = codeBlockRegex.exec(text);
  if (!match) {
    return null;
  }
  const code = match[1].trim();
  return code || null;
}

function isJamIntent(text: string): boolean {
  return /\b(beat|techno|house|drum|groove|bass|pattern|jam|music|kick|snare|hihat|hh|bd)\b/i.test(text);
}

function extractReadCodeResult(data: unknown): { code: string; hash?: string } {
  if (!data || typeof data !== 'object') {
    return { code: '' };
  }
  const maybe = data as { code?: unknown; hash?: unknown };
  return {
    code: typeof maybe.code === 'string' ? maybe.code : '',
    hash: typeof maybe.hash === 'string' ? maybe.hash : undefined,
  };
}

export function createAgentRunner(config: AgentRunnerConfig): AgentRunner {
  const listeners = new Set<(event: RunnerEvent) => void>();
  const now = config.now ?? Date.now;
  let running: { turnId: string; abortController: AbortController } | null = null;
  const completedContent = new Map<string, string>();
  let omitRuntimeContext = false;

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
      return await openRouterComplete(
        {
          apiKey: config.settings.apiKey,
          model: config.settings.model,
          temperature: config.settings.temperature,
          reasoningEnabled: config.settings.reasoningEnabled,
          reasoningEffort: mapModeToEffort(config.settings.reasoningMode),
        },
        {
          userText: messages[messages.length - 1]?.content ?? '',
          messages,
          signal: timeoutController.signal,
        },
      );
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

      const initialResponse = await callModel(abortController.signal, [
        { role: 'system', content: prompt.prompt },
        { role: 'user', content: contextualUserText },
      ]);

      const parsedInitial = parsePseudoFunctionCalls(initialResponse);
      let finalContent = parsedInitial.cleanedText;
      let applyAttempted = false;
      const jamRequest = isJamIntent(text);
      let applyOutcome: 'scheduled' | 'applied' | 'rejected' | 'missing_apply' | null = null;

      if (parsedInitial.calls.length > 0) {
        const toolResults: unknown[] = [];
        for (const call of parsedInitial.calls) {
          emit({ type: 'tool.call.started', payload: { id: call.id, name: call.name } });
          if (call.name === 'apply_strudel_change') {
            applyAttempted = true;
          }
          const result = await dispatchToolCall(call, {
            now,
            readCode: config.readCode,
            applyStrudelChange: config.applyStrudelChange,
            knowledgeSources: config.knowledgeSources,
          });
          emit({
            type: 'tool.call.completed',
            payload: { id: result.id, name: result.name, status: result.status, durationMs: result.durationMs },
          });
          toolResults.push(result);
        }

        let followUpCleaned = '';
        try {
          const followUpResponse = await callModel(abortController.signal, [
            { role: 'system', content: prompt.prompt },
            { role: 'user', content: contextualUserText },
            {
              role: 'assistant',
              content: parsedInitial.cleanedText || 'I used tools to inspect and prepare a response.',
            },
            {
              role: 'user',
              content:
                `Tool results:\n${formatToolResults(toolResults)}\n\n` +
                'Provide the final user-facing response. Do not output <function_calls> tags.',
            },
          ]);

          const followUpParsed = parsePseudoFunctionCalls(followUpResponse);
          followUpCleaned = followUpParsed.cleanedText.trim();

          if (!isSufficientPostToolResponse(followUpCleaned)) {
            const forcedFinalResponse = await callModel(abortController.signal, [
              { role: 'system', content: prompt.prompt },
              { role: 'user', content: contextualUserText },
              {
                role: 'assistant',
                content: parsedInitial.cleanedText || 'I used tools to inspect and prepare a response.',
              },
              {
                role: 'user',
                content:
                  `Tool results:\n${formatToolResults(toolResults)}\n\n` +
                  'Your previous answer was empty. Respond now with final user-facing Strudel guidance only. No tool tags.',
              },
            ]);
            followUpCleaned = parsePseudoFunctionCalls(forcedFinalResponse).cleanedText.trim();
          }
        } catch {
          followUpCleaned = '';
        }

        finalContent =
          (isSufficientPostToolResponse(followUpCleaned) ? followUpCleaned : '') ||
          `I inspected the current code and ran required tools. I'm applying a stable default techno groove now.`;
      } else if (isPlanningOnlyReply(parsedInitial.cleanedText) && config.readCode) {
        const callId = `tool-${now()}-auto-read`;
        emit({ type: 'tool.call.started', payload: { id: callId, name: 'read_code' } });
        const autoReadResult = await dispatchToolCall(
          {
            id: callId,
            name: 'read_code',
            input: { path: 'active' },
          },
          {
            now,
            readCode: config.readCode,
            applyStrudelChange: config.applyStrudelChange,
            knowledgeSources: config.knowledgeSources,
          },
        );
        emit({
          type: 'tool.call.completed',
          payload: {
            id: autoReadResult.id,
            name: autoReadResult.name,
            status: autoReadResult.status,
            durationMs: autoReadResult.durationMs,
          },
        });

        let followUpCleaned = '';
        try {
          const followUpResponse = await callModel(abortController.signal, [
            { role: 'system', content: prompt.prompt },
            { role: 'user', content: contextualUserText },
            { role: 'assistant', content: parsedInitial.cleanedText },
            {
              role: 'user',
              content:
                `Tool results:\n${formatToolResults([autoReadResult])}\n\n` +
                'Complete the user request now with concrete Strudel guidance and code. Do not output tool tags.',
            },
          ]);
          followUpCleaned = parsePseudoFunctionCalls(followUpResponse).cleanedText.trim();
        } catch {
          followUpCleaned = '';
        }
        finalContent =
          (isSufficientPostToolResponse(followUpCleaned) ? followUpCleaned : '') ||
          "I inspected the active code and I'm applying a stable default techno groove now.";
      }

      if (!applyAttempted && isJamIntent(text) && config.readCode && config.applyStrudelChange) {
        let generatedCode = extractPrimaryCodeBlock(finalContent);
        if (!generatedCode) {
          try {
            const forcedCodeResponse = await callModel(abortController.signal, [
              { role: 'system', content: prompt.prompt },
              { role: 'user', content: contextualUserText },
              {
                role: 'assistant',
                content: finalContent,
              },
              {
                role: 'user',
                content:
                  'Return only one executable Strudel code block now. Use ```javascript``` fences and no extra explanation.',
              },
            ]);
            generatedCode = extractPrimaryCodeBlock(parsePseudoFunctionCalls(forcedCodeResponse).cleanedText);
          } catch {
            generatedCode = null;
          }
        }

        const currentRead = await config.readCode({ path: 'active' });
        if (generatedCode) {
          const current = extractReadCodeResult(currentRead);
          const applyCallId = `tool-${now()}-auto-apply`;
          emit({ type: 'tool.call.started', payload: { id: applyCallId, name: 'apply_strudel_change' } });
          const applyResult = await dispatchToolCall(
            {
              id: applyCallId,
              name: 'apply_strudel_change',
              input: {
                currentCode: current.code,
                baseHash: current.hash,
                change: { kind: 'full_code', content: generatedCode },
              },
            },
            {
              now,
              readCode: config.readCode,
              applyStrudelChange: config.applyStrudelChange,
              knowledgeSources: config.knowledgeSources,
            },
          );
          emit({
            type: 'tool.call.completed',
            payload: {
              id: applyResult.id,
              name: applyResult.name,
              status: applyResult.status,
              durationMs: applyResult.durationMs,
            },
          });

          const output = (applyResult.output ?? {}) as { status?: string; applyAt?: string; diagnostics?: string[] };
          if (output.status === 'scheduled' || output.status === 'applied') {
            emit({
              type: 'apply.status.changed',
              payload: { status: output.status as 'scheduled' | 'applied', applyAt: output.applyAt },
            });
            applyOutcome = output.status as 'scheduled' | 'applied';
            finalContent += `\n\nApply status: ${output.status}${output.applyAt ? ` at ${output.applyAt}` : ''}.`;
            applyAttempted = true;
          } else {
            emit({
              type: 'apply.status.changed',
              payload: { status: 'rejected', reason: output.diagnostics?.join('; ') || 'apply failed' },
            });
            applyOutcome = 'rejected';
            finalContent += `\n\nApply status: rejected (${output.diagnostics?.join('; ') || 'apply failed'}).`;
            applyAttempted = true;
          }
        } else {
          emit({
            type: 'apply.status.changed',
            payload: { status: 'rejected', reason: 'No code block found for auto-apply' },
          });
          applyOutcome = 'rejected';
          finalContent += '\n\nApply status: rejected (No code block found for auto-apply).';
        }
      }

      if (jamRequest && !applyOutcome) {
        const reason = applyAttempted ? 'missing_apply_outcome' : 'apply_not_attempted';
        emit({
          type: 'apply.status.changed',
          payload: { status: 'missing_apply', reason },
        });
        finalContent = `${finalContent ? `${finalContent}\n\n` : ''}Apply status: missing_apply (${reason}).`;
      }

      if (!finalContent.trim()) {
        finalContent = jamRequest
          ? 'Apply status: missing_apply (missing_apply_outcome).'
          : 'No response content generated.';
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
