# Strudel Jam Agent Architecture (Simplified)

## Goal
Keep the codebase decoupled and easy to maintain:
- `strudel/` stays an intact submodule.
- Product code is outside `strudel/`.
- Tool logic is modular.
- System prompt is in separate editable files.
- Files stay small and focused.

---

## 1) Core Boundaries

### `strudel/` (Vendor)
- Read-only submodule.
- No feature edits.
- Only submodule pointer updates.

### `packages/strudel-adapter`
- Only place that integrates with Strudel internals.
- Exposes stable APIs to the app/core.

### `packages/jam-core`
- Agent loop, LLM client, tool orchestration, prompt building.
- No UI code.

### `apps/agent-web`
- Side-tab UI, chat experience, settings, tool log rendering.
- Uses `jam-core` APIs.

---

## 2) Minimal Project Structure

```text
.
├─ strudel/                     # upstream submodule (read-only)
├─ apps/
│  └─ agent-web/                # UI app
├─ packages/
│  ├─ shared-types/             # shared contracts
│  ├─ strudel-adapter/          # Strudel integration boundary
│  ├─ jam-core/                 # agent + tools + prompts + llm
│  └─ storage-local/            # IndexedDB/OPFS/local settings
└─ tools/                       # guardrails and maintenance scripts
```

---

## 3) Tool Logic Structure

Inside `packages/jam-core/src/tools/`:
- `dispatcher.ts` (routes tool calls)
- `contracts.ts` (tool request/response schemas)
- `apply-strudel-change/` (validate/schedule/execute/result)
- `strudel-knowledge/` (query/index/rank/format/result)
- `common/` (shared helpers only)

Rules:
- One folder per tool.
- One concern per file.
- No monolithic tool files.

---

## 4) Prompt System (Separated)

Prompt text must be markdown files, not hardcoded strings.

Suggested location:
- `packages/jam-core/src/prompts/templates/system.base.md`
- `packages/jam-core/src/prompts/templates/system.safety.md`
- `packages/jam-core/src/prompts/templates/system.tools.md`
- `packages/jam-core/src/prompts/templates/system.music.md`

Runtime flow:
1. Load templates
2. Render placeholders
3. Build final system prompt per request

This keeps prompt editing easy without touching runtime logic.

---

## 5) Coding Rules (Decoupling + Small Files)
- Prefer files under ~250 LOC.
- Split files when they mix concerns.
- Keep types/validation/side-effects/formatting separate.
- Dependency direction:
  - `apps/* -> packages/*`
  - `jam-core -> shared-types/strudel-adapter/storage-local`
  - never `strudel-adapter -> apps/*`

---

## 6) Public APIs (High Level)

### `strudel-adapter`
- `initStrudelHost(...)`
- `getCurrentCode()`
- `dryRunValidate(...)`
- `applyChange(...)`
- `getReferenceSnapshot()`
- `getSoundsSnapshot()`

### `jam-core`
- `createAgentRunner(...)`
- `sendUserMessage(...)`
- `stopGeneration(...)`
- `retryMessage(...)`
- `subscribeToEvents(...)`

---

## 7) Guardrails
- CI should fail if tracked files under `strudel/**` are changed.
- CI should validate prompt template placeholders.
- CI should run adapter + tool contract tests.

---

## 8) Success Criteria
- `strudel/` remains intact.
- System prompt comes from separate files.
- Tools are modular and testable.
- UI/core/adapter/storage remain decoupled.
- New contributors can find logic quickly.
