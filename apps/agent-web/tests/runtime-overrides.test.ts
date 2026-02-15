// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@chatrave/agent-core', () => ({
  getAvailableMockScenarios: () => ['a', 'b'],
}));

import {
  clearMockRuntimeOverrides,
  enableMockRuntimeDefaults,
  getRuntimeScenarios,
  isDevFakeUiEnabled,
  readRuntimeScenario,
  writeDevFakeUiEnabled,
  writeRuntimeScenario,
} from '../src/runtime-overrides';

describe('runtime-overrides', () => {
  beforeEach(() => localStorage.clear());

  it('reads scenarios from agent-core', () => {
    expect(getRuntimeScenarios()).toEqual(['a', 'b']);
  });

  it('persists dev fake toggle', () => {
    writeDevFakeUiEnabled(true);
    expect(isDevFakeUiEnabled()).toBe(true);
    writeDevFakeUiEnabled(false);
    expect(isDevFakeUiEnabled()).toBe(false);
  });

  it('sets and clears scenario', () => {
    writeRuntimeScenario('b');
    expect(readRuntimeScenario()).toBe('b');
    clearMockRuntimeOverrides();
    expect(readRuntimeScenario()).toBeUndefined();
  });

  it('enables defaults', () => {
    enableMockRuntimeDefaults();
    expect(readRuntimeScenario()).toBe('a');
  });
});
