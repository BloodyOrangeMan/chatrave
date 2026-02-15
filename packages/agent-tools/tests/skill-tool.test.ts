import { describe, expect, it } from 'vitest';
import { dispatchToolCall } from '../src/dispatcher';

describe('skill tool', () => {
  const skills = [
    {
      id: 'jazz',
      name: 'Jazz',
      description: 'Jazz style guidance',
      tags: ['jazz', 'swing'],
      content: 'Use extended chords.',
    },
    {
      id: 'techno',
      name: 'Techno',
      description: 'Techno style guidance',
      tags: ['techno'],
      content: 'Keep it hypnotic.',
    },
  ];

  it('lists available skills', async () => {
    const result = await dispatchToolCall(
      { id: '1', name: 'skill', input: { action: 'list' } },
      {
        skills: {
          list: () => skills,
          get: (id) => skills.find((skill) => skill.id === id) ?? null,
        },
      },
    );

    expect(result.status).toBe('succeeded');
    expect((result.output as { ok?: boolean }).ok).toBe(true);
  });

  it('gets one skill by id', async () => {
    const result = await dispatchToolCall(
      { id: '2', name: 'skill', input: { action: 'get', id: 'jazz' } },
      {
        skills: {
          list: () => skills,
          get: (id) => skills.find((skill) => skill.id === id) ?? null,
        },
      },
    );

    expect(result.status).toBe('succeeded');
    expect((result.output as { ok?: boolean }).ok).toBe(true);
    expect((result.output as { skill?: { id?: string } }).skill?.id).toBe('jazz');
  });

  it('returns not_found for unknown skill id', async () => {
    const result = await dispatchToolCall(
      { id: '3', name: 'skill', input: { action: 'get', id: 'unknown' } },
      {
        skills: {
          list: () => skills,
          get: (id) => skills.find((skill) => skill.id === id) ?? null,
        },
      },
    );

    expect(result.status).toBe('succeeded');
    expect((result.output as { ok?: boolean }).ok).toBe(false);
    expect((result.output as { reason?: string }).reason).toBe('not_found');
  });
});
