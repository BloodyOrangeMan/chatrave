export type MessageRole = 'user' | 'assistant';

export type SendStatus = 'sending' | 'sent' | 'failed';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  status?: SendStatus;
  createdAt: number;
  streaming?: boolean;
}

export interface TurnTiming {
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
}

export interface AssistantTurnState {
  turnId: string;
  messageId: string;
  status: 'running' | 'completed' | 'canceled' | 'failed';
  timing: TurnTiming;
}
