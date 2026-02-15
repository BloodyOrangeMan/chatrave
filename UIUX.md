# Strudel Agent Side-Tab UI/UX Spec (Final)

## Summary
Build a ChatGPT-quality chat experience inside Strudel’s existing side panel system, while keeping Strudel REPL/editor/transport primary.

This is **core parity** (not full ChatGPT product parity):
- streaming responses
- progressive disclosure thinking window (collapsible, per assistant message)
- stop generation
- regenerate
- retry failed send
- markdown/code rendering + copy
- stable autoscroll behavior

Tool logs are per assistant message, **collapsed by default**, and **only shown after tool completion**.

---

## Integration Constraints

### Side-Tab Placement
- Agent UI must live in the original Strudel side panel/tab system.
- Reuse existing Strudel panel behavior for open/close/resize/persistence.
- Do not introduce a separate custom drawer system.

### Product Boundary
- Do not redesign Strudel editor/transport.
- Agent lives as an integrated assistant tab only.

---

## Locked UX Decisions

1. Chat parity scope: **Core parity only**.
2. Composer behavior: **ChatGPT-like strict**.
3. Tool logs default: **Collapsed by default**.
4. Tool log timing: **Show only after finished** (no pending/running rows).
5. Running tool feedback: **No explicit running indicator**.
6. Expanded log detail: **Full sanitized input + output JSON**.
7. Panel mechanics: **Reuse existing Strudel panel behavior**.

---

## Chat Experience

### Message List
- Roles: `user`, `assistant`.
- Assistant supports:
  - streamed thinking window
  - streaming text
  - copy response
  - regenerate
  - per-message thinking-time indicator: `Cooked for X m X s`
  - optional feedback (thumbs up/down)
- User supports:
  - retry if send fails
- Rendering:
  - markdown
  - code blocks (language label + copy)
  - links open safely (`rel=noopener`)

### Autoscroll
- Pin to bottom only when user is near bottom.
- If user scrolls up, preserve position.
- Show “Jump to latest” when unpinned.
- Prevent large reflows during streaming and toggle actions.

### Composer
- Multiline input with max growth height.
- `Enter` sends.
- `Shift+Enter` inserts newline.
- IME-safe send behavior.
- Disable send for empty/trimmed text.
- While assistant is streaming:
  - send button becomes stop
  - user can keep drafting next message

---

## Tool Call Logs (Per Assistant Message)

### Placement
- Tool log block is attached to each assistant message group, above assistant content.

### Visibility Lifecycle
- While tool is queued/running: **do not show tool row/panel**.
- On terminal state (`succeeded`/`failed`/`canceled`): show collapsed log card.

### Default State
- Always collapsed by default.
- Expand/collapse is manual per message.

### Expanded Details
When expanded, show:
- tool name
- final status
- duration/timestamp
- sanitized input JSON (full)
- sanitized output JSON (full)
- failure object/details if failed
- retry tool action for failed calls

### Redaction Rules
- Always redact API keys/tokens/credentials.
- Redact sensitive fields as `•••`.
- Redaction applies to both view and copy actions.

---

## Streaming + Tools Concurrency
- Assistant has two live channels:
  - thinking stream (collapsible window)
  - final answer stream (assistant content)
- Thinking window behavior:
  - expanded while generation is active
  - auto-collapses on completion
  - remains available for manual expand after completion
- Tool execution is hidden until completion.
- Completed tool logs appear once terminal state is reached.
- No “working…” badge, no tool pending indicator, no elapsed timer during run.

### Thinking-Time Indicator
- Every assistant message must display a thinking-time label after generation completes:
  - `Cooked for X m X s`
- `X m X s` is derived from generation start/end timestamps for that assistant turn.
- During active generation, the label may be hidden or show a placeholder, but final persisted text must use the exact format above.

---

## Accessibility
- Keyboard focus order for message actions and log toggles.
- Visible focus states.
- `aria-expanded` and labels for collapsible log regions.
- Respect `prefers-reduced-motion`.

---

## Data Model

### Message
```ts
{
  id: string,
  role: "user" | "assistant",
  content: string,
  thinkingContent?: string,
  thinkingExpanded?: boolean,
  status?: "sending" | "sent" | "failed",
  createdAt?: number,
  streaming?: boolean
}
```

### ToolCall
```ts
{
  id: string,
  messageId: string,
  toolName: string,
  status: "queued" | "running" | "succeeded" | "failed" | "canceled",
  startedAt?: number,
  endedAt?: number,
  durationMs?: number,
  input: any,
  output?: any,
  error?: { message: string, stack?: string }
}
```

Rendering rule:
- UI should render tool logs only when status is terminal (`succeeded|failed|canceled`).

---

## Callback Interfaces

### Chat
- `onSend(text: string)`
- `onStop()`
- `onRegenerate(messageId: string)`
- `onRetryMessage(messageId: string)`
- `onFeedback(messageId: string, value: "up" | "down")`

### Tooling
- `onToolRetry(toolCallId: string)`
- `onCopyToolInput(toolCallId: string)`
- `onCopyToolOutput(toolCallId: string)`

### Strudel Integration
- `onRevertLastChange()` (optional)
- `onApplyNow(messageId: string)` (optional)
- `onInsertIntoEditor(code: string)` (optional)
- `onSelectQuantize(mode: "next_bar" | "next_cycle" | "bars")` (optional)
- `onSelectModel(mode: "fast" | "balanced" | "deep")`

---

## States and Failure UX

### Send Failure
- User message marked failed with retry action.

### Tool Failure
- Show completed failed log row/card.
- Expanded view includes error summary/details and retry action.

### Offline
- Show offline banner at top of chat list:
  - "Offline — agent can’t call the model. You can still jam manually."

---

## Performance Requirements
- Stream updates only patch the last assistant node.
- Expanding/collapsing one tool log should not re-render the full list.
- Long JSON payloads must remain responsive (chunk/virtualize if needed).

---

## Acceptance Checklist
1. Agent tab mounts in existing Strudel panel with native panel behavior.
2. Core ChatGPT-like message/composer interactions work as defined.
3. Tool logs are invisible while running and appear only after finish.
4. Tool logs are collapsed by default.
5. Expanded logs show full sanitized input/output JSON.
6. Failed tool logs include retry.
7. Autoscroll pin/unpin + jump-to-latest works correctly.
8. No regressions in existing Strudel tabs and panel interactions.
9. Thinking window streams live and auto-collapses after turn completion.
10. Thinking window can be expanded after completion and persists across remount.
