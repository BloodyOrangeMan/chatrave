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
        policy: { quantize: 'next_cycle' },
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
        policy: { quantize: 'next_cycle' },
      },
    });

    const output = result.output as { status: string; phase?: string };
    expect(output.status).toBe('rejected');
    expect(output.phase).toBe('STALE_BASE_HASH');
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
});
