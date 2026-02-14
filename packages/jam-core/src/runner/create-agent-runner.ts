import type { RunnerEvent } from '@chatrave/shared-types';
import { openRouterStream } from '../llm/openrouter/client';
import { buildSystemPrompt } from '../prompts/loader';
import { parseOpenRouterSse } from '../llm/openrouter/stream';
import { mapModeToEffort } from './model-profile';
import type { AgentRunner, AgentRunnerConfig } from './types';

function createIds(now: () => number): { turnId: string; messageId: string } {
  const id = `${now()}-${Math.random().toString(16).slice(2, 8)}`;
  return { turnId: `turn-${id}`, messageId: `msg-${id}` };
}

export function createAgentRunner(config: AgentRunnerConfig): AgentRunner {
  const listeners = new Set<(event: RunnerEvent) => void>();
  const now = config.now ?? Date.now;
  let running: { turnId: string; abortController: AbortController } | null = null;
  const completedContent = new Map<string, string>();

  const emit = (event: RunnerEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  async function executeTurn(messageId: string, text: string): Promise<{ turnId: string; messageId: string }> {
    const ids = createIds(now);
    const start = now();

    if (running) {
      running.abortController.abort();
    }

    const abortController = new AbortController();
    running = { turnId: ids.turnId, abortController };
    emit({ type: 'runner.state.changed', payload: { runningTurnId: ids.turnId } });

    let fullText = '';

    try {
      const prompt = buildSystemPrompt({
        vars: {
          MAX_REPAIR_ATTEMPTS: String(config.maxRepairAttempts ?? 4),
          GLOBAL_TOOL_BUDGET: String(config.globalToolBudget ?? 20),
        },
      });
      if (prompt.unresolvedPlaceholders.length > 0) {
        throw new Error(`Unresolved prompt placeholders: ${prompt.unresolvedPlaceholders.join(', ')}`);
      }

      const response = await openRouterStream(
        {
          apiKey: config.settings.apiKey,
          model: config.settings.model,
          temperature: config.settings.temperature,
          reasoningEnabled: config.settings.reasoningEnabled,
          reasoningEffort: mapModeToEffort(config.settings.reasoningMode),
        },
        { userText: text, systemPrompt: prompt.prompt, signal: abortController.signal },
      );

      for await (const chunk of parseOpenRouterSse(response.body!)) {
        if (chunk.done) {
          break;
        }

        fullText += chunk.delta;
        emit({
          type: 'assistant.stream.delta',
          payload: { turnId: ids.turnId, messageId: ids.messageId, delta: chunk.delta },
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
          content: fullText,
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
    subscribeToEvents(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
