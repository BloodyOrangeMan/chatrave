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
        currentCode,
        baseHash: hashString(currentCode),
        change: { kind: 'patch', content: 's("hh")' },
      },
    });

    expect(result.status).toBe('succeeded');
    expect((result.output as { status: string }).status).toBe('scheduled');
  });

  it('rejects apply on stale base hash', async () => {
    const result = await dispatchToolCall({
      id: '1b',
      name: 'apply_strudel_change',
      input: {
        currentCode: 's("bd")',
        baseHash: 'fnv1a-deadbeef',
        change: { kind: 'patch', content: 's("hh")' },
      },
    });

    const output = result.output as { status: string; phase?: string; errorCode?: string };
    expect(output.status).toBe('rejected');
    expect(output.phase).toBe('STALE_BASE_HASH');
    expect(output.errorCode).toBe('STALE_BASE_HASH');
  });

  it('preserves rejected host apply diagnostics', async () => {
    const currentCode = 's("bd")';
    const result = await dispatchToolCall(
      {
        id: '1c',
        name: 'apply_strudel_change',
        input: {
          currentCode,
          baseHash: hashString(currentCode),
          change: { kind: 'full_code', content: 'stack(s("bd"), s("hh"))' },
        },
      },
      {
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
          currentCode,
          baseHash: hashString(currentCode),
          change: { kind: 'full_code', content: 'stack(s("bd"), s("not_loaded"))' },
        },
      },
      {
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

  it('returns not_found for unknown queries', async () => {
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

    const output = result.output as { ok: boolean; reason?: string };
    expect(output.ok).toBe(false);
    expect(output.reason).toBe('not_found');
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
