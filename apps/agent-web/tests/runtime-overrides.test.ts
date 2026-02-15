// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildScenariosUrl,
  DEV_FAKE_UI_KEY,
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
    expect(readRuntimeOverrides()).toEqual({});
  });

  it('returns base url override without scenario header', () => {
    localStorage.setItem('chatraveOpenRouterBaseUrl', 'http://localhost:8787/api/v1');
    expect(readRuntimeOverrides()).toEqual({
      openRouterBaseUrl: 'http://localhost:8787/api/v1',
      openRouterExtraHeaders: undefined,
    });
  });

  it('returns scenario header when configured', () => {
    localStorage.setItem('chatraveOpenRouterBaseUrl', 'http://localhost:8787/api/v1');
    localStorage.setItem('chatraveMockLlmScenario', 'early_finish_read_only');
    localStorage.setItem(DEV_FAKE_UI_KEY, 'true');
    expect(readRuntimeOverrides()).toEqual({
      openRouterBaseUrl: 'http://localhost:8787/api/v1',
      openRouterExtraHeaders: { 'x-chatrave-mock-scenario': 'early_finish_read_only' },
    });
  });

  it('does not attach scenario header when dev fake ui gate is disabled', () => {
    localStorage.setItem('chatraveOpenRouterBaseUrl', 'http://localhost:8787/api/v1');
    localStorage.setItem('chatraveMockLlmScenario', 'early_finish_read_only');
    expect(readRuntimeOverrides()).toEqual({
      openRouterBaseUrl: 'http://localhost:8787/api/v1',
      openRouterExtraHeaders: undefined,
    });
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
    expect(buildScenariosUrl('http://localhost:8787/api/v1')).toBe('http://localhost:8787/api/v1/scenarios');
    expect(buildScenariosUrl('http://localhost:8787/api/v1/')).toBe('http://localhost:8787/api/v1/scenarios');
  });
});
