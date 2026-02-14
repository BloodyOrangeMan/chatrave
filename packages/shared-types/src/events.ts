import type { AssistantTurnState, ChatMessage } from './chat';

export type RunnerEvent =
  | {
      type: 'apply.status.changed';
      payload: { status: 'scheduled' | 'applied' | 'rejected'; applyAt?: string; reason?: string };
    }
  | {
      type: 'tool.call.started';
      payload: { id: string; name: string };
    }
  | {
      type: 'tool.call.completed';
      payload: { id: string; name: string; status: 'succeeded' | 'failed'; durationMs: number };
    }
  | {
      type: 'assistant.stream.delta';
      payload: { turnId: string; messageId: string; delta: string };
    }
  | {
      type: 'assistant.turn.completed';
      payload: AssistantTurnState & { content: string };
    }
  | {
      type: 'assistant.turn.canceled';
      payload: AssistantTurnState;
    }
  | {
      type: 'chat.message.failed';
      payload: { message: ChatMessage; reason: string };
    }
  | {
      type: 'runner.state.changed';
      payload: { runningTurnId: string | null };
    };
