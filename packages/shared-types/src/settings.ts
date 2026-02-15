export type Provider = 'openrouter';
export type VoiceProvider = 'web_speech' | 'openai';

export type ReasoningMode = 'fast' | 'balanced' | 'deep';

export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface AgentSettings {
  schemaVersion: 2;
  provider: Provider;
  model: string;
  reasoningEnabled: boolean;
  reasoningMode: ReasoningMode;
  temperature: number;
  apiKey: string;
  voice: {
    provider: VoiceProvider;
    language: string;
    openaiApiKey: string;
    openaiBaseUrl: string;
    openaiModel: string;
  };
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  schemaVersion: 2,
  provider: 'openrouter',
  model: 'moonshotai/kimi-k2.5',
  reasoningEnabled: true,
  reasoningMode: 'balanced',
  temperature: 0.3,
  apiKey: '',
  voice: {
    provider: 'web_speech',
    language: '',
    openaiApiKey: '',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiModel: 'gpt-4o-mini-transcribe',
  },
};
