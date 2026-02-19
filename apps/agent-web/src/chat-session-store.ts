import type { UIMessage } from 'ai';
import { activeMessages, createSessionFromMessages, type ChatBranchSession } from './chat-branches';

const SESSION_KEY = 'chatrave_agent_chat_session_v3';
const LEGACY_KEY = 'chatrave_agent_chat_session_v2';

function readRaw(): unknown {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function normalizeV3(raw: unknown): ChatBranchSession | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as { version?: unknown; activeBranchId?: unknown; branches?: unknown; revisions?: unknown };
  if (value.version !== 3 || typeof value.activeBranchId !== 'string') {
    return null;
  }
  if (!value.branches || typeof value.branches !== 'object') {
    return null;
  }
  if (!value.revisions || typeof value.revisions !== 'object') {
    return null;
  }
  return value as ChatBranchSession;
}

function readLegacyMessages(): UIMessage[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { messages?: unknown };
    return Array.isArray(parsed.messages) ? (parsed.messages as UIMessage[]) : [];
  } catch {
    return [];
  }
}

export function loadChatSessionGraph(): ChatBranchSession {
  const v3 = normalizeV3(readRaw());
  if (v3) return v3;
  const migrated = createSessionFromMessages(readLegacyMessages());
  saveChatSessionGraph(migrated);
  return migrated;
}

export function saveChatSessionGraph(session: ChatBranchSession): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore storage failures
  }
}

export function loadChatSession(): UIMessage[] {
  return activeMessages(loadChatSessionGraph());
}

export function saveChatSession(messages: UIMessage[]): void {
  saveChatSessionGraph(createSessionFromMessages(messages));
}

export function clearChatSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore storage failures
  }
}
