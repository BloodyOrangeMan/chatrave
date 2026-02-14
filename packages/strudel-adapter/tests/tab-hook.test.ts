// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mountAgentTab, registerAgentTabRenderer, unmountAgentTab } from '../src';

describe('tab hook', () => {
  it('renders using registered renderer', () => {
    const render = vi.fn();
    const unmount = vi.fn();
    registerAgentTabRenderer({ render, unmount });

    const host = document.createElement('div');
    mountAgentTab(host, {});

    expect(render).toHaveBeenCalled();
    unmountAgentTab();
    expect(unmount).toHaveBeenCalled();
  });
});
