# AGENTS.md - Strudel Jam Agent (Current Architecture)

## Goal
Build an offline-first, in-browser Strudel REPL experience with a side-tab Jam Agent for real-time music jamming.

Reference docs:
- `docs/UIUX.md`
- `docs/STRUDEL_KNOWLEDGE_TOOL_SPEC.md`
- `docs/DEV_FAKE_BOUNDARY.md`
- `docs/AGENT_INTEGRATION_GUIDE.md`

Hard constraints:
- Keep `strudel/` as an intact, read-only git submodule.
- Reuse original Strudel code; do not reimplement Strudel.
- Only online dependency is LLM API calls (user-provided key).
- Everything else runs locally in browser (validation, tool orchestration, storage, chat state).

---

## Product Requirements

### Side-Tab Agent in Original Strudel UI
- Agent lives in Strudel side panel/tab system.
- Editor/transport/audio controls remain the primary surface.
- Reuse panel open/close/resize behavior from Strudel UI.

### Real-Time Jamming
- Music loops continuously.
- User interacts by text.
- Agent proposes and applies safe code changes without breaking groove continuity.

### Safety and Apply Model
- Never apply generated code directly to active playback.
- Use dry-run validation first.
- On success: quantized apply at musical boundary.
- On failure: keep current audio unchanged and return structured diagnostics.

### Chat + Tool Transparency
- Streaming responses.
- Stop generation.
- Regenerate/retry behavior.
- Markdown/code rendering + copy.
- Tool logs shown per assistant message.
- Tool logs are shown only for terminal states and collapsed by default.

### Per-Message Thinking Time
- Every assistant response includes `Cooked for X m X s`.

### LLM Settings
- OpenRouter model setting.
- Reasoning mode (`fast|balanced|deep`).
- Temperature.
- API key (local storage only).

---

## UX Rules (Authoritative)

### Tool Log UX
- No pending/running tool rows.
- Show terminal states only (`succeeded|failed|canceled`).
- Expanded log includes sanitized input/output JSON.
- Redact secrets (`apiKey`, tokens, credentials) in UI and copy output.

### Composer UX
- Enter sends.
- Shift+Enter inserts newline.
- IME-safe send behavior.
- During stream: send button becomes stop.

### Autoscroll UX
- Pin-to-bottom only when user is near bottom.
- Preserve scroll when user scrolled up.
- Show jump-to-latest affordance when unpinned.

---

## Architecture and Structure

### Workspace Layout
```text
.
├─ strudel/                       # upstream submodule (read-only)
├─ apps/
│  └─ agent-web/                  # side-tab UI
├─ packages/
│  ├─ agent-core/                 # AI SDK session/runner
│  ├─ agent-tools/                # tool contracts + implementations
│  ├─ strudel-bridge/             # browser Strudel host integration
│  ├─ shared-types/               # contracts/events/settings types
│  ├─ storage-local/              # local persistence wrappers
│  └─ strudel-adapter/            # reference/sounds snapshots + tab hook
└─ tools/                         # checks/dev helpers
```

### Boundaries
- `strudel/`: vendor boundary, no feature edits.
- `packages/strudel-bridge`: only place applying/reading runtime Strudel editor state.
- `packages/agent-tools`: tool logic and validation contracts.
- `packages/agent-core`: AI SDK orchestration + tool wiring.
- `apps/agent-web`: presentation layer and UI state.

### Small-File Rule
- Prefer files under 250 LOC where practical.
- Split by concern.
- Avoid monolithic service files.

---

## Tooling Contract

### `read_code(path|query)`
Read-only context inspection before edits.

### `apply_strudel_change`
Input:
- `baseHash`
- `change.kind`: `full_code | search_replace`

Behavior:
1. validate input,
2. verify stale base hash against current active hash,
3. dry-run validate generated code,
4. verify sound availability,
5. quantize schedule apply if valid.

Success example:
- `{ status: "scheduled"|"applied", applyAt }`

Failure example:
- `{ status: "rejected", phase, diagnostics, unknownSymbols?, latestCode?, latestHash? }`

### `strudel_knowledge(query)`
Single consolidated knowledge tool:
- exact + synonym + fuzzy ranking,
- sources: Strudel reference + sound data,
- top-k results and formatted answer.

Preferred loop:
1. uncertain target -> `read_code`
2. attempt `apply_strudel_change`
3. unknown symbol/sound -> `strudel_knowledge`
4. retry apply once with repaired change

---

## Tool Module Structure (Required)
Inside `packages/agent-tools/src/`:
- `dispatcher.ts`
- `contracts.ts`
- `apply-strudel-change/`
  - `validate.ts`
  - `schedule.ts`
  - `execute.ts`
  - `result.ts`
- `strudel-knowledge/`
  - `query-parser.ts`
  - `reference-index.ts`
  - `sounds-index.ts`
  - `ranker.ts`
  - `formatter.ts`
  - `result.ts`
- `common/`

Rules:
- one tool per folder
- one concern per file
- no cross-tool private coupling

---

## Prompt and Runtime Policy

### System Prompt Source
- Runtime system prompt source is `packages/agent-core/src/system-prompt.ts`.
- Keep prompt text contiguous and explicit.

### LLM REPL Awareness Policy (Hybrid)
For each LLM turn:
- include compact runtime envelope (`activeCodeHash`, playback state, quantize mode, budgets),
- include full active code only when hash changed since model-known hash,
- omit full code when hash unchanged.

Apply safety:
- `apply_strudel_change` must include `baseHash`.
- stale hash returns `STALE_BASE_HASH` + latest code/hash.
- unknown sound returns diagnostics + symbols.

---

## Agent Behavior Rules
1. If edit target is unclear, call `read_code`.
2. Generate conservative valid Strudel changes.
3. Call `apply_strudel_change`.
4. On rejection:
   - read diagnostics,
   - query `strudel_knowledge` when needed,
   - retry within limits.
5. Never claim success unless apply tool reports scheduled/applied.
6. Response should mention what changed, apply timing, and preserved groove/tempo constraints.

## Limits
- `MAX_REPAIR_ATTEMPTS`: default 4.
- `GLOBAL_TOOL_BUDGET`: runtime-configured.

---

## Public APIs (High-Level)

### `agent-core`
- `createJamAgent(...)`
- `createMockJamAgent(...)`

### `strudel-bridge`
- `getReplSnapshot()`
- `readCode(...)`
- `applyStrudelChange(...)`
- `getKnowledgeSources()`

### UI Runtime
- `apps/agent-web` uses `@ai-sdk/react` `useChat(...)`
- transport is `DirectChatTransport(...)` with in-browser `ToolLoopAgent`
- tool + reasoning visibility comes from `UIMessage.parts`

---

## Testing and Guardrails

### Mandatory E2E Verification Policy
- After each completed implementation task, run E2E verification before claiming completion.
- If E2E fails: report, fix, rerun until pass or external blocker.
- Completion report must include scenario, pass/fail, and evidence.

### Required Tests
- tool unit tests (`apply_strudel_change`, `strudel_knowledge`)
- adapter/bridge behavior tests
- side-tab smoke tests
- UI tool-log and streaming behavior tests

### Required CI Checks
- fail if tracked files under `strudel/**` are changed
- typecheck + tests must pass

---

## Deliverables
- side-tab Jam Agent in original Strudel UI
- OpenRouter-first AI SDK runtime
- modular tool architecture (`agent-tools`)
- completed-only per-message tool logs
- thinking-time indicator per assistant message
- read-only submodule guardrails in CI

---

## Non-Goals (Current)
- backend infrastructure
- multi-user collaboration
- modifying Strudel vendor code for product features
