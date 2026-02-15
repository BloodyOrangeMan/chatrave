import { describe, expect, it } from 'vitest';
import { dispatchToolCall } from '../src/tools/dispatcher';
import { hashString } from '../src/tools/common/hash';

describe('tool dispatcher', () => {
  it('returns scheduled apply result', async () => {
    const currentCode = 's("bd")';
    const result = await dispatchToolCall({
      id: '1',
      name: 'apply_strudel_change',
      input: {
        baseHash: hashString(currentCode),
        change: { kind: 'patch', content: 's("hh")' },
      },
    }, {
      readCode: async () => ({ path: 'active', code: currentCode, hash: hashString(currentCode), lineCount: 1 }),
    });

    expect(result.status).toBe('succeeded');
    expect((result.output as { status: string }).status).toBe('scheduled');
  });

  it('rejects apply on stale base hash', async () => {
    const liveCode = 's("bd")';
    const result = await dispatchToolCall({
      id: '1b',
      name: 'apply_strudel_change',
      input: {
        baseHash: 'fnv1a-deadbeef',
        change: { kind: 'patch', content: 's("hh")' },
      },
    }, {
      readCode: async () => ({ path: 'active', code: liveCode, hash: hashString(liveCode), lineCount: 1 }),
    });

    const output = result.output as {
      status: string;
      phase?: string;
      errorCode?: string;
      latestCode?: string;
      latestHash?: string;
    };
    expect(output.status).toBe('rejected');
    expect(output.phase).toBe('STALE_BASE_HASH');
    expect(output.errorCode).toBe('STALE_BASE_HASH');
    expect(output.latestCode).toBe(liveCode);
    expect(output.latestHash).toBe(hashString(liveCode));
  });

  it('preserves rejected host apply diagnostics', async () => {
    const currentCode = 's("bd")';
    const result = await dispatchToolCall(
      {
        id: '1c',
        name: 'apply_strudel_change',
        input: {
          baseHash: hashString(currentCode),
          change: { kind: 'full_code', content: 'stack(s("bd"), s("hh"))' },
        },
      },
      {
        readCode: async () => ({ path: 'active', code: currentCode, hash: hashString(currentCode), lineCount: 1 }),
        applyStrudelChange: async () => ({
          status: 'rejected',
          phase: 'validate',
          diagnostics: ['DRY_RUN_VALIDATE_FAILED: Unexpected token'],
          unknownSymbols: [],
        }),
      },
    );

    const output = result.output as { status: string; phase?: string; diagnostics?: string[]; errorCode?: string };
    expect(output.status).toBe('rejected');
    expect(output.phase).toBe('validate');
    expect(output.errorCode).toBe('VALIDATION_ERROR');
    expect(output.diagnostics?.[0]).toContain('DRY_RUN_VALIDATE_FAILED');
  });

  it('labels unknown symbols as UNKNOWN_SOUND with suggested repair', async () => {
    const currentCode = 's("bd")';
    const result = await dispatchToolCall(
      {
        id: '1d',
        name: 'apply_strudel_change',
        input: {
          baseHash: hashString(currentCode),
          change: { kind: 'full_code', content: 'stack(s("bd"), s("not_loaded"))' },
        },
      },
      {
        readCode: async () => ({ path: 'active', code: currentCode, hash: hashString(currentCode), lineCount: 1 }),
        applyStrudelChange: async () => ({
          status: 'rejected',
          phase: 'validate',
          diagnostics: ['Unknown sound(s): not_loaded'],
          unknownSymbols: ['not_loaded'],
        }),
      },
    );

    const output = result.output as {
      status: string;
      errorCode?: string;
      unknownSymbols?: string[];
      suggestedNext?: string;
    };
    expect(output.status).toBe('rejected');
    expect(output.errorCode).toBe('UNKNOWN_SOUND');
    expect(output.unknownSymbols).toEqual(['not_loaded']);
    expect(output.suggestedNext).toContain('strudel_knowledge');
  });

  it('finds reference knowledge by exact match', async () => {
    const result = await dispatchToolCall(
      {
        id: '2',
        name: 'strudel_knowledge',
        input: { query: 'room' },
      },
      {
        knowledgeSources: {
          reference: [
            {
              name: 'room',
              description: 'Room reverb amount',
              examples: ['s("bd").room(0.5)'],
              synonyms: ['reverb'],
              tags: ['effects'],
            },
          ],
          sounds: [{ key: 'bd', data: { type: 'sample', tag: 'drum-machines', prebake: true } }],
        },
      },
    );

    expect(result.status).toBe('succeeded');
    const output = result.output as { ok: boolean; items: Array<{ name: string }> };
    expect(output.ok).toBe(true);
    expect(output.items[0].name).toBe('room');
  });

  it('returns fuzzy match for previously unknown query', async () => {
    const result = await dispatchToolCall(
      {
        id: '3',
        name: 'strudel_knowledge',
        input: { query: 'trancegate' },
      },
      {
        knowledgeSources: {
          reference: [{ name: 'room', description: 'Room', examples: [] }],
          sounds: [{ key: 'bd', data: { type: 'sample' } }],
        },
      },
    );

    const output = result.output as { ok: boolean; items?: Array<{ name: string }> };
    expect(output.ok).toBe(true);
    expect(output.items?.[0]?.name).toBe('room');
  });

  it('matches typo query to closest reference function', async () => {
    const result = await dispatchToolCall(
      {
        id: '3b',
        name: 'strudel_knowledge',
        input: { query: 'setcmp' },
      },
      {
        knowledgeSources: {
          reference: [
            { name: 'setcpm', description: 'tempo', examples: ['setcpm(120/4)'] },
            { name: 'set', description: 'set helper', examples: [] },
          ],
          sounds: [{ key: 'bd', data: { type: 'sample' } }],
        },
      },
    );

    const output = result.output as { ok: boolean; items?: Array<{ name: string }> };
    expect(output.ok).toBe(true);
    expect(output.items?.[0]?.name).toBe('setcpm');
  });

  it('respects top-k limit for ranked knowledge results', async () => {
    const result = await dispatchToolCall(
      {
        id: '3c',
        name: 'strudel_knowledge',
        input: { query: { q: 'room', limit: 2 } },
      },
      {
        knowledgeSources: {
          reference: [
            { name: 'room', description: 'room', examples: [] },
            { name: 'roomsize', description: 'room size', examples: [] },
            { name: 'roomfade', description: 'room fade', examples: [] },
          ],
          sounds: [{ key: 'bd', data: { type: 'sample' } }],
        },
      },
    );

    const output = result.output as { ok: boolean; items?: Array<{ name: string }> };
    expect(output.ok).toBe(true);
    expect(output.items?.length).toBe(2);
  });

  it('returns relevance-ranked suggestions when there is no viable match', async () => {
    const result = await dispatchToolCall(
      {
        id: '3d',
        name: 'strudel_knowledge',
        input: { query: { q: 'rooom', domain: 'sounds' } },
      },
      {
        knowledgeSources: {
          reference: [
            { name: 'room', description: 'room', examples: [] },
            { name: 'reverb', description: 'reverb', examples: [] },
          ],
          sounds: [{ key: 'bd', data: { type: 'sample' } }],
        },
      },
    );

    const output = result.output as { ok: boolean; suggestions?: string[]; reason?: string };
    expect(output.ok).toBe(false);
    expect(output.reason).toBe('not_found');
    expect(output.suggestions?.[0]).toBe('room');
  });

  it('returns structured unavailable result when knowledge sources are missing', async () => {
    const result = await dispatchToolCall({
      id: '4',
      name: 'strudel_knowledge',
      input: { query: 'room' },
    });

    const output = result.output as { ok: boolean; reason?: string };
    expect(result.status).toBe('succeeded');
    expect(output.ok).toBe(false);
    expect(output.reason).toBe('knowledge_sources_unavailable');
  });
});
