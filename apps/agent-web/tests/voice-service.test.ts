// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_SETTINGS } from '@chatrave/shared-types';
import { createVoiceAdapter } from '../src/voice/create-voice-service';

describe('voice service', () => {
  it('throws when Web Speech API is unavailable', () => {
    const settings = { ...DEFAULT_AGENT_SETTINGS, voice: { ...DEFAULT_AGENT_SETTINGS.voice, provider: 'web_speech' as const } };
    expect(() => createVoiceAdapter(settings)).toThrow(/Web Speech/);
  });

  it('requires API key for OpenAI provider', () => {
    const settings = {
      ...DEFAULT_AGENT_SETTINGS,
      voice: { ...DEFAULT_AGENT_SETTINGS.voice, provider: 'openai' as const, openaiApiKey: '' },
    };
    expect(() => createVoiceAdapter(settings)).toThrow(/OpenAI API key is required/);
  });
});
