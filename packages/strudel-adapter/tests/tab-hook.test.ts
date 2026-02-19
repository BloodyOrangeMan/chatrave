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
    expect(fetchMock).toHaveBeenCalled();
    const firstCallUrl = String(fetchMock.mock.calls[0]?.[0] ?? '');
    expect(firstCallUrl).toContain('/chatrave-agent/reference-doc.json');
  });

  it('falls back to legacy doc path when staged reference endpoint fails', async () => {
    const fetchMock = vi.fn(async () => {
      const callIndex = fetchMock.mock.calls.length;
      if (callIndex === 1) {
        return new Response('not-found', { status: 404 });
      }
      return new Response(
        JSON.stringify({
          docs: [{ name: 'roomsize', description: 'Reverb room size', examples: ['s("bd").roomsize(0.5)'] }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const reference = await getReferenceSnapshot();
    expect(reference.length).toBeGreaterThan(0);
    expect(reference[0].name).toBe('roomsize');
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('warns when reference snapshot cannot be loaded from any candidate', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('not-found', { status: 404 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);
    const reference = await getReferenceSnapshot();
    expect(reference).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      '[chatrave][knowledge] reference snapshot unavailable',
      expect.objectContaining({
        candidates: expect.arrayContaining(['/chatrave-agent/reference-doc.json']),
      }),
    );
    warn.mockRestore();
  });
});
