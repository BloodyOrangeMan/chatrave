// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { getReferenceSnapshot, getSoundsSnapshot, mountAgentTab, registerAgentTabRenderer, unmountAgentTab } from '../src';

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

  it('reads sounds snapshot from window soundMap', () => {
    const get = vi.fn().mockReturnValue({
      bd: { data: { type: 'sample', tag: 'drum-machines', prebake: true } },
    });
    (window as Window & { soundMap?: { get: () => unknown } }).soundMap = { get };
    const sounds = getSoundsSnapshot();
    expect(sounds).toHaveLength(1);
    expect(sounds[0].key).toBe('bd');
  });

  it('loads reference snapshot from doc.json payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          docs: [{ name: 'room', description: 'Room amount', examples: ['s("bd").room(0.5)'] }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const reference = await getReferenceSnapshot();
    expect(reference.length).toBeGreaterThan(0);
    expect(reference[0].name).toBe('room');
  });
});
