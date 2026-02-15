// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearChatSession, loadChatSession, saveChatSession } from '../src/chat-session-store';

describe('chat-session-store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and loads ui messages', () => {
    const messages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }];
    saveChatSession(messages as never);
    expect(loadChatSession()).toEqual(messages);
  });

  it('preserves assistant metadata such as cookedLabel', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        metadata: { cookedLabel: 'Cooked for 0 m 6 s' },
        parts: [{ type: 'text', text: 'done' }],
      },
    ];
    saveChatSession(messages as never);
    expect(loadChatSession()).toEqual(messages);
  });

  it('clears session', () => {
    saveChatSession([{ id: 'm1', role: 'user', parts: [] }] as never);
    clearChatSession();
    expect(loadChatSession()).toEqual([]);
  });
});
