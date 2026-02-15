import {
  DEFAULT_AGENT_SETTINGS,
  type AgentSettings,
  type ReasoningMode,
  type ReasoningEffort,
  type VoiceProvider,
} from '@chatrave/shared-types';

const STORAGE_KEY = 'chatrave.agent.settings.v1';

function clampTemperature(value: number): number {
  if (Number.isNaN(value)) {
    return DEFAULT_AGENT_SETTINGS.temperature;
  }
  return Math.max(0, Math.min(2, value));
}

function isReasoningMode(value: unknown): value is ReasoningMode {
  return value === 'fast' || value === 'balanced' || value === 'deep';
}

function isVoiceProvider(value: unknown): value is VoiceProvider {
  return value === 'web_speech' || value === 'openai';
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeUrlString(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.trim().replace(/\/+$/, '');
}

export function mapReasoningModeToEffort(mode: ReasoningMode): ReasoningEffort {
  if (mode === 'fast') return 'low';
  if (mode === 'deep') return 'high';
  return 'medium';
}

export function validateSettings(input: Partial<AgentSettings> | undefined): AgentSettings {
  const base = DEFAULT_AGENT_SETTINGS;
  if (!input) {
    return base;
  }

  const inputVoice = input.voice && typeof input.voice === 'object' ? input.voice : undefined;

  return {
    schemaVersion: 2,
    provider: input.provider === 'openrouter' ? 'openrouter' : base.provider,
    model: typeof input.model === 'string' && input.model.trim() ? input.model : base.model,
    reasoningEnabled: typeof input.reasoningEnabled === 'boolean' ? input.reasoningEnabled : base.reasoningEnabled,
    reasoningMode: isReasoningMode(input.reasoningMode) ? input.reasoningMode : base.reasoningMode,
    temperature: clampTemperature(typeof input.temperature === 'number' ? input.temperature : base.temperature),
    apiKey: typeof input.apiKey === 'string' ? input.apiKey : base.apiKey,
    voice: {
      provider: isVoiceProvider(inputVoice?.provider) ? inputVoice.provider : base.voice.provider,
      language: normalizeString(inputVoice?.language, base.voice.language),
      openaiApiKey: normalizeString(inputVoice?.openaiApiKey, base.voice.openaiApiKey),
      openaiBaseUrl: normalizeUrlString(inputVoice?.openaiBaseUrl, base.voice.openaiBaseUrl),
      openaiModel: normalizeString(inputVoice?.openaiModel, base.voice.openaiModel),
    },
  };
}

export function loadSettings(storage: Storage = localStorage): AgentSettings {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    return DEFAULT_AGENT_SETTINGS;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AgentSettings>;
    return validateSettings(parsed);
  } catch {
    return DEFAULT_AGENT_SETTINGS;
  }
}

export function saveSettings(
  patch: Partial<AgentSettings>,
  storage: Storage = localStorage,
): AgentSettings {
  const current = loadSettings(storage);
  const merged = validateSettings({ ...current, ...patch });
  storage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

export function resetSettings(storage: Storage = localStorage): void {
  storage.removeItem(STORAGE_KEY);
}
