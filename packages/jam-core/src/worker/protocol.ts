import type { AgentSettings, RunnerEvent } from '@chatrave/shared-types';

export type WorkerRequest =
  | { type: 'init'; payload: { settings: AgentSettings } }
  | { type: 'send'; payload: { text: string } }
  | { type: 'stop'; payload?: { turnId?: string } }
  | { type: 'retry'; payload: { messageId: string } };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'event'; payload: RunnerEvent }
  | { type: 'error'; payload: { message: string } };
