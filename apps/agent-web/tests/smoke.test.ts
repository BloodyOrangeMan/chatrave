// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

const registerAgentTabRenderer = vi.fn();
const injectAgentThemeColors = vi.fn();

vi.mock('@chatrave/strudel-adapter', () => ({
  registerAgentTabRenderer,
  injectAgentThemeColors,
}));

vi.mock('../src/App', () => ({
  AgentApp: () => null,
}));

describe('agent-web bootstrap', () => {
  it('registers tab renderer on import', async () => {
    await import('../src/index');
    expect(registerAgentTabRenderer).toHaveBeenCalledTimes(1);
    expect(injectAgentThemeColors).toHaveBeenCalledTimes(1);
  });
});
