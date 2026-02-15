export const BASE_URL_KEY = 'chatraveOpenRouterBaseUrl';
export const SCENARIO_KEY = 'chatraveMockLlmScenario';
export const DEV_FAKE_UI_KEY = 'chatraveDevFakeUiEnabled';

export interface RuntimeOverrides {
  openRouterBaseUrl?: string;
  openRouterExtraHeaders?: Record<string, string>;
}

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
    // Ignore storage write failures.
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

export function isLocalDevBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl) {
    return false;
  }
  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function buildScenariosUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalized}/scenarios`;
}

export function readRuntimeOverrides(): RuntimeOverrides {
  const baseUrl = readLocalStorageValue(BASE_URL_KEY);
  const scenario = readLocalStorageValue(SCENARIO_KEY);
  if (!baseUrl) {
    return {};
  }
  return {
    openRouterBaseUrl: baseUrl,
    openRouterExtraHeaders: isDevFakeUiEnabled() && scenario ? { 'x-chatrave-mock-scenario': scenario } : undefined,
  };
}
