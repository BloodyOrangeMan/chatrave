const SESSION_KEY = 'chatrave_agent_chat_session_v1';

export interface PersistedToolLog {
  id: string;
  name: string;
  status: 'succeeded' | 'failed';
  durationMs: number;
  request?: unknown;
  response?: unknown;
  errorMessage?: string;
  expanded?: boolean;
}

export interface PersistedChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  streaming?: boolean;
  failedReason?: string;
  cookedLabel?: string;
  sourceUserText?: string;
  toolLogs: PersistedToolLog[];
}

export interface PersistedChatSession {
  messages: PersistedChatMessage[];
}

function readRawSession(): unknown {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function normalizeSession(raw: unknown): PersistedChatSession {
  if (!raw || typeof raw !== 'object') {
    return { messages: [] };
  }
  const maybe = raw as { messages?: unknown };
  if (!Array.isArray(maybe.messages)) {
    return { messages: [] };
  }
  const messages = maybe.messages.filter((item): item is PersistedChatMessage => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const msg = item as Partial<PersistedChatMessage>;
    return (
      (msg.role === 'user' || msg.role === 'assistant') &&
      typeof msg.id === 'string' &&
      typeof msg.content === 'string' &&
      typeof msg.createdAt === 'number' &&
      Array.isArray(msg.toolLogs)
    );
  });
  return { messages };
}

export function loadChatSession(): PersistedChatSession {
  return normalizeSession(readRawSession());
}

export function saveChatSession(session: PersistedChatSession): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage write failures.
  }
}

export function clearChatSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore storage write failures.
  }
}
