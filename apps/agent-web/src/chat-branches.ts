import type { UIMessage } from 'ai';

const ROOT_BRANCH_ID = 'branch-root';

export interface ChatBranch {
  id: string;
  parentBranchId: string | null;
  forkMessageId: string | null;
  forkIndex: number | null;
  pendingRevisionKey: string | null;
  pendingRevisionSlotKey: string | null;
  createdAt: number;
  messages: UIMessage[];
}

export interface MessageRevision {
  id: string;
  branchId: string;
  text: string;
  createdAt: number;
  revisionSlotKey: string;
  anchorMessageId: string | null;
  edited: boolean;
}

export interface ChatBranchSession {
  version: 3;
  activeBranchId: string;
  branches: Record<string, ChatBranch>;
  revisions: Record<string, MessageRevision[]>;
}

export interface RevisionChoice {
  revisionKey: string;
  variants: MessageRevision[];
  currentVariantId: string;
  currentIndex: number;
}

function nowTs(): number {
  return Date.now();
}

function makeId(prefix: string): string {
  return `${prefix}-${nowTs()}-${Math.random().toString(36).slice(2, 8)}`;
}

function withRevisionMeta(message: UIMessage, revisionKey: string, revisionSlotKey: string): UIMessage {
  const metadata = message.metadata && typeof message.metadata === 'object' ? { ...(message.metadata as Record<string, unknown>) } : {};
  metadata.revisionKey = revisionKey;
  metadata.revisionSlotKey = revisionSlotKey;
  return { ...message, metadata };
}

function readMessageText(message: UIMessage): string {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts
    .filter((part): part is { type: 'text'; text: string } => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
}

function ensureRevisionMetadata(
  session: ChatBranchSession,
  branchId: string,
  messages: UIMessage[],
): { messages: UIMessage[]; usedPending: boolean } {
  const branch = session.branches[branchId];
  const pendingRevisionKey = branch?.pendingRevisionKey ?? null;
  const pendingRevisionSlotKey = branch?.pendingRevisionSlotKey ?? null;
  const pendingPlaceholder = Object.entries(session.revisions).find(([, variants]) =>
    variants.some((variant) => variant.branchId === branchId && variant.anchorMessageId == null && variant.edited),
  );
  const placeholderRevisionKey = pendingPlaceholder?.[0] ?? null;
  const placeholderRevisionSlotKey =
    pendingPlaceholder?.[1].find((variant) => variant.branchId === branchId && variant.anchorMessageId == null && variant.edited)
      ?.revisionSlotKey ?? null;
  let usedPending = false;
  let usedPlaceholder = false;
  const normalized = messages.map((message) => {
    if (message.role !== 'user') return message;
    const metadata = message.metadata && typeof message.metadata === 'object' ? (message.metadata as Record<string, unknown>) : {};
    const existingRevision = typeof metadata.revisionKey === 'string' && metadata.revisionKey.trim() ? metadata.revisionKey : null;
    const existingSlot = typeof metadata.revisionSlotKey === 'string' && metadata.revisionSlotKey.trim() ? metadata.revisionSlotKey : null;
    const revisionKey = existingRevision
      ? existingRevision
      : placeholderRevisionKey && !usedPlaceholder
        ? placeholderRevisionKey
        : pendingRevisionKey && !usedPending
          ? pendingRevisionKey
          : message.id;
    const revisionSlotKey = existingSlot
      ? existingSlot
      : placeholderRevisionSlotKey && !usedPlaceholder
        ? placeholderRevisionSlotKey
        : pendingRevisionSlotKey && !usedPending
          ? pendingRevisionSlotKey
          : revisionKey;
    if (placeholderRevisionKey && !usedPlaceholder && revisionKey === placeholderRevisionKey) {
      usedPlaceholder = true;
    }
    if (pendingRevisionKey && !usedPending && revisionKey === pendingRevisionKey) {
      usedPending = true;
    }
    const variants = session.revisions[revisionKey] ?? [];
    const existingVariantIndex = variants.findIndex((item) => item.branchId === branchId);
    if (existingVariantIndex < 0) {
      variants.push({
        id: message.id,
        branchId,
        text: readMessageText(message),
        createdAt: nowTs(),
        revisionSlotKey,
        anchorMessageId: message.id,
        edited: false,
      });
      session.revisions[revisionKey] = variants;
    } else {
      const current = variants[existingVariantIndex];
      variants[existingVariantIndex] = {
        ...current,
        text: readMessageText(message),
        revisionSlotKey: current.revisionSlotKey || revisionSlotKey,
        anchorMessageId: current.anchorMessageId ?? message.id,
        edited: current.edited ?? false,
      };
      session.revisions[revisionKey] = variants;
    }
    return withRevisionMeta(message, revisionKey, revisionSlotKey);
  });
  return { messages: normalized, usedPending };
}

export function createSessionFromMessages(messages: UIMessage[]): ChatBranchSession {
  const base: ChatBranchSession = {
    version: 3,
    activeBranchId: ROOT_BRANCH_ID,
    branches: {
      [ROOT_BRANCH_ID]: {
        id: ROOT_BRANCH_ID,
        parentBranchId: null,
        forkMessageId: null,
        forkIndex: null,
        pendingRevisionKey: null,
        pendingRevisionSlotKey: null,
        createdAt: nowTs(),
        messages: [],
      },
    },
    revisions: {},
  };
  const normalized = ensureRevisionMetadata(base, ROOT_BRANCH_ID, messages);
  base.branches[ROOT_BRANCH_ID] = { ...base.branches[ROOT_BRANCH_ID], messages: normalized.messages };
  return base;
}

export function activeMessages(session: ChatBranchSession): UIMessage[] {
  return session.branches[session.activeBranchId]?.messages ?? [];
}

function messageSnapshot(message: UIMessage): string {
  return JSON.stringify({
    id: message.id,
    role: message.role,
    metadata: message.metadata ?? null,
    parts: message.parts ?? null,
  });
}

function messageListEquivalent(left: UIMessage[], right: UIMessage[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (messageSnapshot(left[index] as UIMessage) !== messageSnapshot(right[index] as UIMessage)) {
      return false;
    }
  }
  return true;
}

export function updateActiveBranchMessages(session: ChatBranchSession, messages: UIMessage[]): ChatBranchSession {
  const active = session.branches[session.activeBranchId];
  if (!active) return session;
  if (messageListEquivalent(active.messages, messages)) {
    return session;
  }

  const next: ChatBranchSession = {
    ...session,
    branches: { ...session.branches },
    revisions: { ...session.revisions },
  };
  const branch = next.branches[next.activeBranchId];
  if (!branch) return session;
  const normalized = ensureRevisionMetadata(next, branch.id, messages);
  next.branches[branch.id] = {
    ...branch,
    messages: normalized.messages,
    pendingRevisionKey: normalized.usedPending ? null : branch.pendingRevisionKey,
    pendingRevisionSlotKey: normalized.usedPending ? null : branch.pendingRevisionSlotKey,
  };
  return next;
}

export function setActiveBranch(session: ChatBranchSession, branchId: string): ChatBranchSession {
  if (!session.branches[branchId]) return session;
  if (session.activeBranchId === branchId) return session;
  return { ...session, activeBranchId: branchId };
}

export function createEditedBranch(
  session: ChatBranchSession,
  params: { messageId: string; newText: string },
): { session: ChatBranchSession; promptText: string } | null {
  const active = session.branches[session.activeBranchId];
  if (!active) return null;
  const idx = active.messages.findIndex((message) => message.id === params.messageId);
  if (idx < 0) return null;
  const source = active.messages[idx];
  if (source.role !== 'user') return null;

  const metadata = source.metadata && typeof source.metadata === 'object' ? (source.metadata as Record<string, unknown>) : {};
  const revisionKey = typeof metadata.revisionKey === 'string' && metadata.revisionKey.trim() ? metadata.revisionKey : source.id;
  const revisionSlotKey =
    typeof metadata.revisionSlotKey === 'string' && metadata.revisionSlotKey.trim() ? metadata.revisionSlotKey : revisionKey;

  const newBranchId = makeId('branch');
  const variants = [...(session.revisions[revisionKey] ?? [])];
  const variantId = makeId('variant');
  variants.push({
    id: variantId,
    branchId: newBranchId,
    text: params.newText.trim(),
    createdAt: nowTs(),
    revisionSlotKey,
    anchorMessageId: null,
    edited: true,
  });

  const prefix = active.messages.slice(0, idx);
  const next: ChatBranchSession = {
    ...session,
    activeBranchId: newBranchId,
    branches: {
      ...session.branches,
      [newBranchId]: {
        id: newBranchId,
        parentBranchId: active.id,
        forkMessageId: source.id,
        forkIndex: idx,
        pendingRevisionKey: revisionKey,
        pendingRevisionSlotKey: revisionSlotKey,
        createdAt: nowTs(),
        messages: prefix,
      },
    },
    revisions: {
      ...session.revisions,
      [revisionKey]: variants,
    },
  };
  return { session: next, promptText: params.newText.trim() };
}

function branchDepthMap(session: ChatBranchSession): Record<string, number> {
  const out: Record<string, number> = {};
  const visit = (id: string): number => {
    if (out[id] !== undefined) return out[id];
    const branch = session.branches[id];
    if (!branch) return 0;
    if (!branch.parentBranchId) {
      out[id] = 0;
      return 0;
    }
    const depth = visit(branch.parentBranchId) + 1;
    out[id] = depth;
    return depth;
  };
  Object.keys(session.branches).forEach((id) => visit(id));
  return out;
}

function activeLineage(session: ChatBranchSession): Set<string> {
  const ids = new Set<string>();
  let cursor: string | null = session.activeBranchId;
  while (cursor) {
    ids.add(cursor);
    cursor = session.branches[cursor]?.parentBranchId ?? null;
  }
  return ids;
}

export function revisionChoiceForMessage(
  session: ChatBranchSession,
  message: UIMessage,
): RevisionChoice | null {
  if (message.role !== 'user') return null;
  const lineage = activeLineage(session);
  const depthById = branchDepthMap(session);

  for (const [revisionKey, rawVariants] of Object.entries(session.revisions)) {
    const hasEditedVariant = rawVariants.some((variant) => variant.edited || variant.id.startsWith('variant-'));
    if (!hasEditedVariant || rawVariants.length < 2) continue;

    let currentIndex = 0;
    let bestDepth = -1;
    rawVariants.forEach((variant, index) => {
      if (!lineage.has(variant.branchId)) return;
      const depth = depthById[variant.branchId] ?? 0;
      if (depth > bestDepth) {
        bestDepth = depth;
        currentIndex = index;
      }
    });

    const activeVariant = rawVariants[currentIndex];
    if (activeVariant?.anchorMessageId !== message.id) continue;
    return {
      revisionKey,
      variants: rawVariants,
      currentVariantId: rawVariants[currentIndex]?.id ?? rawVariants[0].id,
      currentIndex,
    };
  }
  return null;
}

export function switchRevisionVariant(
  session: ChatBranchSession,
  params: { revisionKey: string; variantId: string },
): ChatBranchSession {
  const variants = session.revisions[params.revisionKey] ?? [];
  const next = variants.find((item) => item.id === params.variantId);
  if (!next) return session;
  return setActiveBranch(session, next.branchId);
}
