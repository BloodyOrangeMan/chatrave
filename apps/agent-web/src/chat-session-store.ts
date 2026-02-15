import type { UIMessage } from 'ai';

const SESSION_KEY = 'chatrave_agent_chat_session_v2';

interface PersistedSession {
  messages: UIMessage[];
}

function readRaw(): unknown {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function normalize(raw: unknown): PersistedSession {
  if (!raw || typeof raw !== 'object') {
    return { messages: [] };
  }
  const value = raw as { messages?: unknown };
  if (!Array.isArray(value.messages)) {
    return { messages: [] };
  }
  return { messages: value.messages as UIMessage[] };
}

export function loadChatSession(): UIMessage[] {
  return normalize(readRaw()).messages;
}

export function saveChatSession(messages: UIMessage[]): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ messages }));
  } catch {
    // ignore storage failures
  }
}

export function clearChatSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore storage failures
  }
}
