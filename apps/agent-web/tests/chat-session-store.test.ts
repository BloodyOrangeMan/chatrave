// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { clearChatSession, loadChatSession, saveChatSession } from '../src/chat-session-store';

describe('chat-session-store', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('loads empty session by default', () => {
    expect(loadChatSession()).toEqual({ messages: [] });
  });

  it('saves and loads chat session messages', () => {
    const session = {
      messages: [
        {
          id: 'm1',
          role: 'assistant' as const,
          content: 'hello',
          createdAt: 1,
          toolLogs: [],
        },
      ],
    };
    saveChatSession(session);
    expect(loadChatSession()).toEqual(session);
  });

  it('clears persisted session', () => {
    saveChatSession({
      messages: [{ id: 'm1', role: 'user', content: 'x', createdAt: 1, toolLogs: [] }],
    });
    clearChatSession();
    expect(loadChatSession()).toEqual({ messages: [] });
  });
});
