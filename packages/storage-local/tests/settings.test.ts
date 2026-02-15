import { describe, expect, it } from 'vitest';
import { mapReasoningModeToEffort, validateSettings } from '../src/settings';
import { redactSecrets } from '../src/redaction';

describe('settings validation', () => {
  it('maps reasoning modes to effort levels', () => {
    expect(mapReasoningModeToEffort('fast')).toBe('low');
    expect(mapReasoningModeToEffort('balanced')).toBe('medium');
    expect(mapReasoningModeToEffort('deep')).toBe('high');
  });

  it('clamps temperature', () => {
    const settings = validateSettings({ temperature: 9 });
    expect(settings.temperature).toBe(2);
  });

  it('fills voice defaults for legacy settings payloads', () => {
    const settings = validateSettings({ apiKey: 'abc' } as never);
    expect(settings.schemaVersion).toBe(2);
    expect(settings.skillsEnabled).toBe(true);
    expect(settings.voice.provider).toBe('web_speech');
  });

  it('validates voice provider and URLs', () => {
    const settings = validateSettings({
      voice: {
        provider: 'invalid' as never,
        openaiBaseUrl: 'https://api.openai.com/v1/',
      } as never,
    });
    expect(settings.voice.provider).toBe('web_speech');
    expect(settings.voice.openaiBaseUrl).toBe('https://api.openai.com/v1');
  });

  it('falls back invalid skillsEnabled to default', () => {
    const settings = validateSettings({ skillsEnabled: 'yes' as never });
    expect(settings.skillsEnabled).toBe(true);
  });
});

describe('redaction', () => {
  it('redacts sensitive fields recursively', () => {
    const input = {
      apiKey: 'secret',
      nested: {
        authToken: 'token',
        plain: 'ok',
      },
    };

    const output = redactSecrets(input);
    expect(output.apiKey).toBe('•••');
    expect(output.nested.authToken).toBe('•••');
    expect(output.nested.plain).toBe('ok');
  });
});
