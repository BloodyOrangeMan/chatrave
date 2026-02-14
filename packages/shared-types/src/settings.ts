export type Provider = 'openrouter';

export type ReasoningMode = 'fast' | 'balanced' | 'deep';

export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface AgentSettings {
  schemaVersion: 1;
  provider: Provider;
  model: string;
  reasoningEnabled: boolean;
  reasoningMode: ReasoningMode;
  temperature: number;
  apiKey: string;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  schemaVersion: 1,
  provider: 'openrouter',
  model: 'moonshotai/kimi-2.5',
  reasoningEnabled: true,
  reasoningMode: 'balanced',
  temperature: 0.3,
  apiKey: '',
};
