// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearChatSession, loadChatSession, loadChatSessionGraph, saveChatSession } from '../src/chat-session-store';

describe('chat-session-store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and loads ui messages', () => {
    const messages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }];
    saveChatSession(messages as never);
    const loaded = loadChatSession() as Array<{ id: string; metadata?: { revisionKey?: string } }>;
    expect(loaded[0]?.id).toBe('m1');
    expect(loaded[0]?.metadata?.revisionKey).toBe('m1');
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

  it('migrates legacy v2 session into graph session', () => {
    localStorage.setItem(
      'chatrave_agent_chat_session_v2',
      JSON.stringify({ messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'legacy' }] }] }),
    );
    const graph = loadChatSessionGraph();
    expect(graph.version).toBe(3);
    expect(loadChatSession()[0]?.id).toBe('u1');
    expect(localStorage.getItem('chatrave_agent_chat_session_v3')).toBeTruthy();
  });
});
