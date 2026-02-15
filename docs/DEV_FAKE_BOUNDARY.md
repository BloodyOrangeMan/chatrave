# Dev/Fake vs Production Boundary Tracker

## Purpose
This document is the source of truth for what code is:
- production logic,
- dev/fake-only logic,
- mixed logic containing both.

Use this file when removing mock/dev helpers so production behavior is preserved.

## Definitions
- `production`: required in normal user-facing runtime.
- `dev-only`: local development/testing aid, safe to remove for production hardening.
- `mixed`: file includes both production and dev-only branches.

## Runtime Boundary Map

| Area | File | Classification | Why it exists | Prod dependency | Removal trigger | Removal steps | Risk if removed incorrectly |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Agent UI runtime overrides | `apps/agent-web/src/runtime-overrides.ts` | `dev-only` | Reads local override URL/scenario and injects mock header. | `none` | Production hardening phase (remove local mock controls). | Remove file; remove imports/calls from `apps/agent-web/src/index.ts` and `apps/agent-web/src/worker-client.ts`. | Mock override can leak into prod runtime assumptions. |
| Agent UI dev scenario selector | `apps/agent-web/src/index.ts` | `mixed` | Main UI is production; scenario picker and dev status are mock tooling. | `required` | When removing browser mock scenario switching. | Remove `Mock scenario (dev)` UI block and related runtime-overrides wiring only. Keep message rendering/tool logs and settings UI. | Accidentally removing core send/stop/settings/chat rendering. |
| Worker runtime override bridge | `apps/agent-web/src/worker-client.ts` | `mixed` | Builds runner and passes optional override base URL/headers. | `required` | When OpenRouter base URL/header overrides are no longer allowed in runtime. | Remove `readRuntimeOverrides` usage; keep `createAgentRunner` integration and host tools. | Runner cannot connect to production provider if core setup is altered. |
| Mock LLM HTTP server | `scripts/mock-llm-server.mjs` | `dev-only` | Deterministic local `/api/v1/chat/completions` + scenario list endpoint. | `none` | Remove local fake endpoint strategy. | Delete file and references in `package.json` and `tools/run-dev.sh`. | Dev/E2E fallback workflows break. |
| Fake completion adapter | `packages/jam-core/src/llm/fake-list/adapter.ts` | `dev-only` | Deterministic fake model for tests and controlled scenarios. | `none` | If tests migrate to another fake provider. | Delete file; remove exports/imports/tests using fake adapter. | Loss of deterministic test coverage for runner/tool loops. |
| Fake scenario catalog | `packages/jam-core/src/llm/fake-list/scenario.ts` | `dev-only` | Central scenario steps used by fake adapter/tests. | `none` | Same as fake adapter removal. | Delete file with adapter; remove scenario references from tests. | Tests fail due to missing scenario fixtures. |
| OpenRouter completion adapter | `packages/jam-core/src/llm/openrouter/adapter.ts` | `production` | Production completion client implementation used by runner default path. | `required` | N/A | Do not remove unless replacing production provider adapter with equivalent API. | Production agent cannot call LLM. |
| Runner client selection and tool loop | `packages/jam-core/src/runner/create-agent-runner.ts` | `mixed` | Production runner. Also supports injected fake `completionClient` for tests/dev. | `required` | If dependency injection strategy changes. | Keep default OpenRouter path; only remove injected fake hooks if replaced by another test seam. | Tool loop or turn lifecycle regressions. |
| Dev bootstrap script | `tools/run-dev.sh` | `dev-only` | Starts local app + strudel + alias/mock guidance. | `none` | If replaced by new dev orchestration command. | Delete/replace script and update contributor docs. | Local contributor setup becomes unclear. |
| Agent URL alias utility | `tools/agent-port-alias.mjs` | `dev-only` | Helps stable host/port mapping in local dev. | `none` | If no longer needed for host/WSL workflows. | Delete script and references from `tools/run-dev.sh`. | Local host/browser connectivity friction returns. |
| Root mock script | `package.json` (`mock:llm`) | `dev-only` | Entry command for local fake server. | `none` | Remove fake server strategy. | Remove `mock:llm` script and related docs references. | Dev instructions point to missing command. |
| Jam-core fake exports | `packages/jam-core/src/index.ts` | `mixed` | Exports production APIs and fake adapter/scenarios. | `required` | If fake APIs become internal test-only. | Remove `llm/fake-list/*` exports only; keep runner/tools/prompt exports. | External tests/tools may break on removed exports. |

## Test Boundary Map

| Test file | Covers production behavior | Covers dev/fake behavior | Delete when fake path removed? |
| --- | --- | --- | --- |
| `packages/jam-core/tests/runner.test.ts` | yes | yes | no (rewrite fake setup if needed) |
| `packages/jam-core/tests/fake-list.test.ts` | no | yes | yes |
| `apps/agent-web/tests/runtime-overrides.test.ts` | no | yes | yes |
| `apps/agent-web/tests/tool-log-details.test.ts` | yes | no | no |
| `apps/agent-web/tests/worker-client.test.ts` | yes | partial | no |

## Canonical Production Path
1. User sends text in `apps/agent-web/src/index.ts`.
2. `apps/agent-web/src/worker-client.ts` builds `createAgentRunner(...)`.
3. `packages/jam-core/src/runner/create-agent-runner.ts` uses default `createOpenRouterCompletionClient(...)`.
4. `packages/jam-core/src/llm/openrouter/adapter.ts` calls OpenRouter client.
5. Runner dispatches tools and emits structured events to UI.

## Dev/Fake Runtime Path
1. Browser localStorage may define:
   - `chatraveOpenRouterBaseUrl`
   - `chatraveMockLlmScenario`
2. `apps/agent-web/src/runtime-overrides.ts` injects:
   - base URL override,
   - header `x-chatrave-mock-scenario`.
3. `scripts/mock-llm-server.mjs` serves:
   - `GET /api/v1/scenarios`
   - `POST /api/v1/chat/completions`.

## Removal Playbooks

### Playbook A: Remove local mock server and scenario UI
1. Remove `scripts/mock-llm-server.mjs`.
2. Remove `mock:llm` from root `package.json`.
3. Remove scenario UI and runtime override usage in:
   - `apps/agent-web/src/index.ts`
   - `apps/agent-web/src/worker-client.ts`
   - `apps/agent-web/src/runtime-overrides.ts`
4. Remove dev-only tests:
   - `apps/agent-web/tests/runtime-overrides.test.ts`
5. Update `tools/run-dev.sh` instructions and remove mock references.
6. Run full test + E2E against real OpenRouter.

### Playbook B: Keep fake adapter for tests, remove runtime dev UI
1. Remove runtime override UI/wiring from agent-web files.
2. Keep `packages/jam-core/src/llm/fake-list/*` for deterministic tests.
3. Keep `packages/jam-core/tests/fake-list.test.ts`.
4. Verify no browser/runtime path depends on fake scenario header.

## Decision Log
- 2026-02-15: Added local mock scenario selector and runtime override path for deterministic browser debugging.
- 2026-02-15: Switched fake scenario progression to stateless-by-message selection so each new turn can start from step-1 tool calls.
- 2026-02-15: Added this tracker document and boundary checker to preserve removability memory.

## Exit Criteria Checklist
- [ ] No runtime import of `packages/jam-core/src/llm/fake-list/*`.
- [ ] No `Mock scenario (dev)` control in agent UI.
- [ ] No runtime use of `x-chatrave-mock-scenario`.
- [ ] `mock:llm` script removed if fake server removed.
- [ ] Test suite green after boundary cleanup.
- [ ] This document updated to mark removed components.

