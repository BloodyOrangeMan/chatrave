// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { loadChatSession, saveChatSession } from '../src/chat-session-store';

describe('chat persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps cooked label after persistence roundtrip', () => {
    const messages = [
      {
        id: 'assistant-1',
        role: 'assistant',
        metadata: { cookedLabel: 'Cooked for 0 m 4 s' },
        parts: [{ type: 'reasoning', text: 'thinking...' }, { type: 'text', text: 'answer' }],
      },
    ];

    saveChatSession(messages as never);
    const loaded = loadChatSession() as Array<{ metadata?: { cookedLabel?: string } }>;
    expect(loaded[0]?.metadata?.cookedLabel).toBe('Cooked for 0 m 4 s');
  });
});
