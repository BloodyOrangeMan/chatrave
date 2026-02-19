import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import {
  activeMessages,
  createEditedBranch,
  createSessionFromMessages,
  revisionChoiceForMessage,
  switchRevisionVariant,
  updateActiveBranchMessages,
} from '../src/chat-branches';

function userMessage(id: string, text: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] } as unknown as UIMessage;
}

function assistantMessage(id: string, text: string): UIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text }] } as unknown as UIMessage;
}

describe('chat-branches', () => {
  it('creates a branch from edited user message and switches active branch', () => {
    const session = createSessionFromMessages([
      userMessage('u1', 'hello'),
      assistantMessage('a1', 'yo'),
      userMessage('u2', 'add hat'),
      assistantMessage('a2', 'done'),
    ]);

    const result = createEditedBranch(session, { messageId: 'u2', newText: 'add snare' });
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.promptText).toBe('add snare');
    const active = activeMessages(result.session);
    expect(active).toHaveLength(2);
    expect((active[0] as { id: string }).id).toBe('u1');
    expect((active[1] as { id: string }).id).toBe('a1');
  });

  it('exposes revision choices and switches branch variants', () => {
    const base = createSessionFromMessages([userMessage('u1', 'techno')]);
    const edited = createEditedBranch(base, { messageId: 'u1', newText: 'house' });
    expect(edited).not.toBeNull();
    if (!edited) return;

    const editedSession = updateActiveBranchMessages(edited.session, [
      ...activeMessages(edited.session),
      userMessage('u1b', 'house'),
      assistantMessage('a1b', 'ok'),
    ]);
    const choice = revisionChoiceForMessage(editedSession, activeMessages(editedSession)[0] as UIMessage);
    expect(choice?.variants.length).toBe(2);
    if (!choice) return;

    const switched = switchRevisionVariant(editedSession, {
      revisionKey: choice.revisionKey,
      variantId: choice.variants[0].id,
    });
    expect(activeMessages(switched)[0]?.id).toBe('u1');
  });

  it('anchors branch selector to the edited user turn, not earlier turns', () => {
    const session = createSessionFromMessages([
      userMessage('u1', 'first'),
      assistantMessage('a1', 'ok'),
      userMessage('u2', 'second'),
      assistantMessage('a2', 'ok'),
    ]);
    const edited = createEditedBranch(session, { messageId: 'u2', newText: 'second edited' });
    expect(edited).not.toBeNull();
    if (!edited) return;

    const withNewTurn = updateActiveBranchMessages(edited.session, [
      ...activeMessages(edited.session),
      userMessage('u2b', 'second edited'),
      assistantMessage('a2b', 'done'),
    ]);
    const msgs = activeMessages(withNewTurn);
    const firstUserChoice = revisionChoiceForMessage(withNewTurn, msgs[0] as UIMessage);
    const editedUserChoice = revisionChoiceForMessage(withNewTurn, msgs[2] as UIMessage);

    expect(msgs[0]?.id).toBe('u1');
    expect(msgs[2]?.id).toBe('u2b');
    expect(firstUserChoice).toBeNull();
    expect(editedUserChoice?.variants.length).toBe(2);
  });

  it('returns same session for semantically unchanged message snapshots', () => {
    const session = createSessionFromMessages([
      userMessage('u1', 'hello'),
      assistantMessage('a1', 'world'),
    ]);
    const cloned = activeMessages(session).map((message) => JSON.parse(JSON.stringify(message)) as UIMessage);
    const next = updateActiveBranchMessages(session, cloned);
    expect(next).toBe(session);
  });
});
