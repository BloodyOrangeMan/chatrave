// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildScenariosUrl,
  clearMockRuntimeOverrides,
  DEFAULT_MOCK_BASE_URL,
  DEV_FAKE_UI_KEY,
  enableMockRuntimeDefaults,
  isDevFakeUiEnabled,
  isLocalDevBaseUrl,
  readRuntimeOverrides,
  readRuntimeScenario,
  writeRuntimeScenario,
} from '../src/runtime-overrides';

describe('runtime overrides', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('returns empty overrides when no base url configured', () => {
    expect(readRuntimeOverrides()).toEqual({ mockEnabled: false });
  });

  it('returns default mock base url when dev mode is enabled', () => {
    localStorage.setItem(DEV_FAKE_UI_KEY, 'true');
    expect(readRuntimeOverrides()).toEqual({
      mockEnabled: true,
      mockScenario: undefined,
      openRouterBaseUrl: DEFAULT_MOCK_BASE_URL,
      openRouterExtraHeaders: undefined,
    });
  });

  it('returns scenario header when configured', () => {
    localStorage.setItem('chatraveMockLlmScenario', 'early_finish_read_only');
    localStorage.setItem(DEV_FAKE_UI_KEY, 'true');
    expect(readRuntimeOverrides()).toEqual({
      mockEnabled: true,
      mockScenario: 'early_finish_read_only',
      openRouterBaseUrl: DEFAULT_MOCK_BASE_URL,
      openRouterExtraHeaders: { 'x-chatrave-mock-scenario': 'early_finish_read_only' },
    });
  });

  it('does not attach scenario header when dev fake ui gate is disabled', () => {
    localStorage.setItem('chatraveMockLlmScenario', 'early_finish_read_only');
    expect(readRuntimeOverrides()).toEqual({ mockEnabled: false });
  });

  it('reads dev fake ui enable flag from localStorage', () => {
    expect(isDevFakeUiEnabled()).toBe(false);
    localStorage.setItem(DEV_FAKE_UI_KEY, '1');
    expect(isDevFakeUiEnabled()).toBe(true);
    localStorage.setItem(DEV_FAKE_UI_KEY, 'true');
    expect(isDevFakeUiEnabled()).toBe(true);
  });

  it('reads and writes runtime scenario values', () => {
    expect(readRuntimeScenario()).toBeUndefined();
    writeRuntimeScenario('successful_jam_apply');
    expect(readRuntimeScenario()).toBe('successful_jam_apply');
    writeRuntimeScenario(undefined);
    expect(readRuntimeScenario()).toBeUndefined();
  });

  it('detects local dev base urls', () => {
    expect(isLocalDevBaseUrl('http://localhost:8787/api/v1')).toBe(true);
    expect(isLocalDevBaseUrl('http://127.0.0.1:8787/api/v1')).toBe(true);
    expect(isLocalDevBaseUrl('https://openrouter.ai/api/v1')).toBe(false);
    expect(isLocalDevBaseUrl(undefined)).toBe(false);
  });

  it('builds scenarios url from base url', () => {
    expect(buildScenariosUrl('http://localhost:8787/api/v1')).toBe('local://mock-scenarios');
    expect(buildScenariosUrl('http://localhost:8787/api/v1/')).toBe('local://mock-scenarios');
  });

  it('clears stored mock keys', () => {
    localStorage.setItem('chatraveMockLlmScenario', 'read_then_apply_success');
    clearMockRuntimeOverrides();
    expect(localStorage.getItem('chatraveMockLlmScenario')).toBeNull();
  });

  it('keeps base-url storage untouched when enabling defaults', () => {
    localStorage.setItem('chatraveOpenRouterBaseUrl', 'http://localhost:9999/api/v1');
    enableMockRuntimeDefaults();
    expect(localStorage.getItem('chatraveOpenRouterBaseUrl')).toBe('http://localhost:9999/api/v1');
  });
});
