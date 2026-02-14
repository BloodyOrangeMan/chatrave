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
