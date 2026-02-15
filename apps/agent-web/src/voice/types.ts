import type { AgentSettings } from '@chatrave/shared-types';

export type VoiceStatus = 'idle' | 'listening' | 'transcribing' | 'error';

export type VoiceProviderId = AgentSettings['voice']['provider'];

export interface VoiceResult {
  text: string;
}

export interface VoiceAdapter {
  start(): Promise<void>;
  stop(): Promise<VoiceResult>;
}

export interface VoiceContext {
  settings: AgentSettings['voice'];
}
