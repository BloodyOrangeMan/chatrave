import { getAvailableMockScenarios } from '@chatrave/agent-core';

export const SCENARIO_KEY = 'chatraveMockLlmScenario';
export const DEV_FAKE_UI_KEY = 'chatraveDevFakeUiEnabled';

function readLocalStorageValue(key: string): string | undefined {
  try {
    const value = window.localStorage.getItem(key)?.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function writeLocalStorageValue(key: string, value?: string): void {
  try {
    if (value && value.trim()) {
      window.localStorage.setItem(key, value.trim());
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore storage write failures
  }
}

export function readRuntimeScenario(): string | undefined {
  return readLocalStorageValue(SCENARIO_KEY);
}

export function writeRuntimeScenario(value?: string): void {
  writeLocalStorageValue(SCENARIO_KEY, value);
}

export function isDevFakeUiEnabled(): boolean {
  const value = readLocalStorageValue(DEV_FAKE_UI_KEY);
  return value === '1' || value?.toLowerCase() === 'true';
}

export function writeDevFakeUiEnabled(enabled: boolean): void {
  writeLocalStorageValue(DEV_FAKE_UI_KEY, enabled ? 'true' : undefined);
}

export function clearMockRuntimeOverrides(): void {
  writeRuntimeScenario(undefined);
}

export function enableMockRuntimeDefaults(): void {
  if (!readRuntimeScenario()) {
    writeRuntimeScenario(getAvailableMockScenarios()[0]);
  }
}

export function getRuntimeScenarios(): string[] {
  return getAvailableMockScenarios();
}
