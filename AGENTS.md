# CLAUDE.md - Strudel Jam Agent (Merged Master Spec)

## Goal
Build an offline-first, in-browser Strudel REPL experience with a side-tab Jam Agent for real-time music jamming.

Reference docs:
- `ARCHITECTURE.md`
- `STRUDEL_KNOWLEDGE_TOOL_SPEC.md`
- `SYSTEM_PROMT.md`
- `UIUX.md`
- `docs/DEV_FAKE_BOUNDARY.md` (dev/fake vs production boundary tracker and removal playbooks)

Hard constraints:
- Keep `strudel/` as an intact, read-only git submodule.
- Reuse original Strudel code; do not reimplement Strudel.
- Only online dependency is LLM API calls (user-provided key).
- Everything else runs locally in browser (engine, validation, storage, skills, history).

---

## Product Requirements

### Side-Tab Agent in Original Strudel UI
- Agent must live inside Strudel side panel/tab system.
- Keep editor/transport/audio controls as primary surface.
- Reuse existing panel open/close/resize behavior.

### Real-Time Jamming
- Music loops continuously.
- User interacts by text (and optionally voice in later phase).
- Agent proposes code changes safely without breaking groove.

### Safety and Apply Model
- Never apply generated code directly to active playback.
- Use shadow buffer + DRY RUN validation first.
- On success: quantized swap at musical boundary.
- On failure: keep current audio, return structured diagnostics, repair and retry.

### Chat + Tool Transparency
- ChatGPT-quality core chat behaviors:
  - streaming responses
  - stop generation
  - regenerate
  - retry failed send
  - markdown/code rendering + copy
- Show explicit tool activity per assistant message.
- Tool logs appear only after completion, collapsed by default.

### Per-Message Thinking Time
- Every assistant message must include:
  - `Cooked for X m X s`
- Derived from turn start/end timestamps.

### LLM Settings
Settings panel must support:
- provider selection (OpenRouter first)
- model selection
- reasoning mode option (fast/balanced/deep)
- temperature
- API key input (stored locally only)

---

## UX Rules (Authoritative)

### Tool Log UX
- No pending/running tool rows in UI.
- Only terminal tool states are shown (`succeeded|failed|canceled`).
- Expanded log shows sanitized input/output JSON.
- Redact secrets (`apiKey`, tokens, credentials) in view and copy output.

### Composer UX
- Enter sends.
- Shift+Enter newline.
- IME-safe send behavior.
- During stream: send button becomes stop.

### Autoscroll UX
- Pin to bottom only when user is near bottom.
- Preserve scroll when user scrolled up.
- Show jump-to-latest affordance when unpinned.

---

## Architecture and Structure

### Workspace Layout
```text
.
├─ strudel/                     # upstream submodule (read-only)
├─ apps/
│  └─ agent-web/                # UI app (side-tab chat)
├─ packages/
│  ├─ shared-types/             # contracts and schemas
│  ├─ strudel-adapter/          # only Strudel integration boundary
│  ├─ jam-core/                 # agent loop, llm, tools, prompt system
│  └─ storage-local/            # IndexedDB/OPFS/local settings wrappers
└─ tools/                       # CI guardrails and maintenance scripts
```

### Boundaries
- `strudel/`: vendor boundary, no feature edits.
- `packages/strudel-adapter`: only place touching Strudel internals.
- `packages/jam-core`: domain logic, tools, orchestration, prompt composition.
- `apps/agent-web`: presentation layer only.

### Small-File Rule
- Prefer < 250 LOC per file.
- Split by concern (types, validation, side effects, formatting).
- Avoid monolithic service/tool files.

---

## Tooling Contract

### `read_code(path|query)`
Read-only inspection tool for code/context discovery before edits.

Use cases:
- locate/edit-target discovery
- structure inspection before patching
- ambiguity reduction when apply target is unclear

### `apply_strudel_change(change, policy)`
Single apply tool that:
1. updates shadow (patch/full),
2. runs DRY RUN validation,
3. schedules quantized apply on success,
4. returns structured rejection on failure.

Success example:
- `{ status: "scheduled"|"applied", applyAt, activeUnchangedUntilApply: true }`

Failure example:
- `{ status: "rejected", phase, diagnostics, unknownSymbols, suggestedNext? }`

### `strudel_knowledge(query)`
Single consolidated knowledge tool:
- free-form query input
- exact + synonym + fuzzy matching
- sources: Strudel reference + sounds data
- reference results must include description and examples (when available)

Preferred tool loop (aligned with runtime prompt):
1. If unsure where/how to edit -> `read_code(...)`
2. Attempt change via `apply_strudel_change(...)`
3. If unknown symbol/uncertainty -> `strudel_knowledge(...)`
4. Retry apply once with repaired change

---

## Tool Module Structure (Required)
Inside `packages/jam-core/src/tools/`:
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

## Prompt System (Externalized)

Do not hardcode system prompt in runtime TS files.

Use markdown templates under:
- `packages/jam-core/src/prompts/templates/system.base.md`
- `packages/jam-core/src/prompts/templates/system.safety.md`
- `packages/jam-core/src/prompts/templates/system.tools.md`
- `packages/jam-core/src/prompts/templates/system.music.md`
- `packages/jam-core/src/prompts/templates/system.style.md`

Runtime flow:
1. load template segments,
2. render placeholders,
3. build final system prompt per request.

`SYSTEM_PROMT.md` can remain as legacy reference, but runtime source of truth must be templates above.

---

## LLM REPL Awareness Policy (Hybrid, Mandatory)

Use a hybrid context strategy for every LLM call:
- Always include a compact runtime context envelope:
  - `activeCodeHash`, `shadowCodeHash?`
  - playback state (`started`, `cps/cpm`)
  - quantize mode
  - last apply/validation summary
  - tool budget + repair budget remaining
- Do **not** include full REPL code by default in every request.
- Full code/context must be retrieved via `read_code(...)` when needed.

Apply safety requirements:
- `apply_strudel_change` requests must carry `baseHash`.
- If `baseHash` is stale, tool must reject with `STALE_BASE_HASH`.
- On `STALE_BASE_HASH`, runtime refreshes and retries once.
- On unknown symbol rejection, runtime calls `strudel_knowledge(...)` and retries once.

---

## Agent Behavior Rules
1. If edit target is unclear, call `read_code` first.
2. First attempt: generate conservative valid Strudel code.
3. Call `apply_strudel_change`.
4. If rejected:
   - read diagnostics + unknownSymbols
   - call `strudel_knowledge` (targeted)
   - retry apply with bounded attempts
5. Never claim success unless apply tool returns success.
6. Response must mention:
   - what changed
   - apply timing (quantized boundary)
   - preserved constraints (tempo/groove/layer stability)

## LIMITS
- `MAX_REPAIR_ATTEMPTS`: default `4` (or runtime override via settings).
- `GLOBAL_TOOL_BUDGET`: default from runtime config.

Enforcement rules:
- The agent must stop retrying after `MAX_REPAIR_ATTEMPTS` and return the smallest safe fallback.
- The agent must not exceed `GLOBAL_TOOL_BUDGET`; if budget is near exhaustion, prioritize one final high-probability attempt.

---

## Sprint 1 Kickoff Plan (OpenRouter-First Vertical Slice)

### Objective
Deliver one usable end-to-end slice quickly:
- side-tab chat in Strudel panel
- OpenRouter integration
- agent loop with two tools
- post-completion tool logs
- thinking-time label

### Phase 0 - Foundation Guardrails
- scaffold `apps/agent-web` + `packages/*`
- add CI rule blocking tracked edits under `strudel/**`
- define shared contracts in `shared-types`

### Phase 1 - OpenRouter + Streaming Core
- implement OpenRouter provider client + stream parser
- implement runner loop and turn timing
- persist provider/model/temp/api key locally

### Phase 2 - Prompt Externalization
- create markdown templates
- implement prompt loader/renderer
- switch runtime to template-built prompt

### Phase 3 - Tools Vertical Slice
- implement dispatcher/contracts
- implement `apply_strudel_change` split pipeline
- implement `strudel_knowledge` with fuzzy search and source-backed outputs

### Phase 4 - Side-Tab UI and Logs
- implement chat UI core interactions
- implement completed-only tool log behavior
- render per-message `Cooked for X m X s`

### Phase 5 - Persistence and Hardening
- chat history + settings persistence
- offline/error states
- smoke tests + contract tests

---

## Public APIs (High-Level)

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

### Event Types (examples)
- `assistant.stream.delta`
- `assistant.turn.completed`
- `tool.call.started`
- `tool.call.completed`
- `apply.status.changed`
- `chat.message.failed`

---

## Testing and Guardrails

### Mandatory E2E Verification Policy
- After every completed implementation task, the agent must run E2E verification before claiming completion.
- If E2E fails:
  - do not mark task complete
  - report failure details clearly
  - fix and rerun E2E until passing or blocked by a stated external constraint
- Every completion report must include:
  - E2E suite/scenario executed
  - pass/fail result
  - key evidence (critical assertions or outcome summary)

### Required Tests
- tool unit tests (`apply_strudel_change`, `strudel_knowledge`)
- prompt loader/renderer tests
- redaction tests
- adapter contract tests
- side-tab integration smoke tests
- end-to-end flow verification after each implementation completion

### Required CI Checks
- fail if tracked files under `strudel/**` are changed
- fail if prompt placeholders are unresolved
- run tool/adapter contract tests

---

## Deliverables
- side-tab Jam Agent in original Strudel UI
- OpenRouter-first agent runtime
- modular tool architecture
- externalized prompt templates
- completed-only per-message tool logs
- thinking-time indicator per assistant message
- read-only submodule guardrails in CI

---

## Non-Goals (MVP)
- backend infrastructure
- multi-user collaboration
- full multi-provider parity in Sprint 1
- modifying Strudel vendor code for product features
