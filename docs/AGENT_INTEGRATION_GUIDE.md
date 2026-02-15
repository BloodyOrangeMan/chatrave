# Agent Integration Guide

As-of date: 2026-02-15

## Purpose and Audience
This guide is for contributors maintaining or extending the Jam Agent integration in the Strudel UI.

It explains:
- how the `agent` tab is mounted into upstream Strudel,
- what is allowed to change in the `strudel/` submodule,
- what dependency modifications were introduced and why,
- and how to evolve or remove dev/fake paths safely in the future.

This document is implementation-focused and should be read with:
- `AGENTS.md`
- `CLAUDE.md`
- `docs/DEV_FAKE_BOUNDARY.md`
- `tools/STRudel_PATCH_POLICY.md`

## Repository and Boundary Topology
| Area | Path | Role | Change policy |
| --- | --- | --- | --- |
| Upstream vendor | `strudel/` | Original Strudel product code | Read-only boundary except approved integration patch points |
| Strudel bridge | `packages/strudel-adapter/` | Agent tab registration and Strudel snapshot adapters | Primary boundary for Strudel-facing code |
| Agent UI | `apps/agent-web/` | Agent chat UI, controls, rendering, worker client wiring | Feature/UI changes belong here |
| Agent runtime | `packages/jam-core/` | Runner loop, LLM transport, tool orchestration, prompts | Core behavior/tooling changes belong here |
| Local tooling | `tools/`, `scripts/` | Guardrails, mock server, dev bootstrap helpers | Dev and CI support |

Boundary rules:
- Do not add agent runtime/network/business logic inside `strudel/`.
- Keep Strudel integration logic in `packages/strudel-adapter/` and `apps/agent-web/`.
- Treat `docs/DEV_FAKE_BOUNDARY.md` as the source of truth for fake/dev removability.

## Agent Tab Boot and Lifecycle
### 1. Tab registration in Strudel panel
- `strudel/website/src/repl/components/panel/Panel.jsx` adds `agent` to `tabNames` and routes to `AgentTabHost` in `PanelContent`.

### 2. Host mount flow
- `AgentTabHost` attempts to render via global renderer `window.__CHATRAVE_AGENT_TAB_RENDERER__`.
- If unavailable, it bootstraps by dynamic import using:
  1. `localStorage.chatraveAgentModuleUrl` (preferred)
  2. `http://localhost:4174/src/index.ts`
  3. `http://localhost:4175/src/index.ts`
- After successful import, it calls `window.__CHATRAVE_INIT_AGENT_TAB__?.()` to register renderer and then renders.

### 3. Agent renderer contract
- `packages/strudel-adapter/src/tab-hook.ts` defines:
  - `registerAgentTabRenderer(renderer)`
  - `mountAgentTab(container, context)`
  - `unmountAgentTab()`
- Global contract:
  - `window.__CHATRAVE_AGENT_TAB_RENDERER__` with `render(container, context)` and optional `unmount(container)`.

### 4. Agent UI mount entry
- `apps/agent-web/src/index.ts` defines `initAgentTab()` and writes:
  - `window.__CHATRAVE_INIT_AGENT_TAB__ = initAgentTab`
- On standalone mount (when `#app` exists), it mounts directly for local development.

### 5. Failure behavior
- If module load fails from all URLs, `AgentTabHost` shows boot error text in the tab.
- This is expected and non-fatal for Strudel playback/editor.

## Submodule Modification Policy
The project’s hard rule is that `strudel/` remains upstream-like, with narrow exceptions.

Allowed tracked edits (Phase 1 policy):
- `strudel/website/src/repl/components/panel/Panel.jsx`
- `strudel/pnpm-lock.yaml`

Policy source:
- `tools/STRudel_PATCH_POLICY.md`

CI/local enforcement:
- `tools/check-strudel-boundary.sh` allows only the two files above.
- Root CI command includes `pnpm run check:strudel-boundary`.

Current observed state (as of 2026-02-15):
- Modified in submodule: `strudel/website/src/repl/components/panel/Panel.jsx`
- Not modified currently: `strudel/pnpm-lock.yaml`

When requesting new allowed files:
- Update `tools/STRudel_PATCH_POLICY.md` with rationale.
- Update `tools/check-strudel-boundary.sh` allowlist.
- Mention the change in this guide and `AGENTS.md`/`CLAUDE.md` if policy-level.

## Dependency Modification Ledger
| Dependency or tool | Location | Classification | Why it exists | Removal/rollback risk |
| --- | --- | --- | --- | --- |
| `@strudel/transpiler` | `apps/agent-web/package.json` | production | Local dry-run code validation in agent apply path | Removing breaks local validation and structured rejection behavior |
| `@langchain/core` | `packages/jam-core/package.json` | dev/fake-mixed | Powers `FakeListChatModel` in fake completion adapter used by tests/dev scenarios | Removing without replacing test seam breaks deterministic fake model tests and mock server behavior |
| `@langchain/core` | root `package.json` devDependencies | dev-only | Supports `scripts/mock-llm-server.mjs` execution in workspace root | Mock server fails if removed while script remains |
| Agent port alias proxy | `tools/agent-port-alias.mjs` | dev-only | Stable host/browser URL (`4175 -> 4174`) for local/WSL flows | Removing can reintroduce host/WSL accessibility issues |
| Mock server runtime | `scripts/mock-llm-server.mjs` | dev-only | Deterministic `/api/v1/chat/completions` for browser debugging and fake scenarios | Removing without UI/runtime cleanup causes broken dev override path |

Lockfile impact:
- `pnpm-lock.yaml` includes transitive graph additions from `@langchain/core` and related packages.
- If fake infrastructure is removed later, prune dependency entries by removing package references and regenerating lockfile.

## Production vs Dev/Fake Runtime Paths
### Canonical production path
1. User sends message in `apps/agent-web/src/index.ts`.
2. `apps/agent-web/src/worker-client.ts` creates runner via `createAgentRunner(...)`.
3. `packages/jam-core/src/runner/create-agent-runner.ts` defaults to OpenRouter completion client.
4. `packages/jam-core/src/llm/openrouter/adapter.ts` calls `openRouterComplete(...)`.
5. Tool dispatch runs through `packages/jam-core/src/tools/dispatcher.ts`.

### Dev/fake override path
1. Runtime overrides read from localStorage in `apps/agent-web/src/runtime-overrides.ts`.
2. Optional `openRouterBaseUrl` and header `x-chatrave-mock-scenario` are injected.
3. `scripts/mock-llm-server.mjs` responds with scenario-driven fake completions.
4. Optional in-UI dev controls are available in `apps/agent-web/src/index.ts`.

Cross-reference:
- Full removability map and playbooks live in `docs/DEV_FAKE_BOUNDARY.md`.

## Public Contracts and Interfaces (Current)
### Browser-global contracts
- `window.__CHATRAVE_INIT_AGENT_TAB__`: bootstrap hook loaded by Strudel panel.
- `window.__CHATRAVE_AGENT_TAB_RENDERER__`: tab renderer instance with `render` and optional `unmount`.

### Runner/LLM contracts
- `CompletionClient` and `CompletionRequest` are exported from `packages/jam-core/src/llm/contracts.ts`.
- `createAgentRunner` supports transport overrides via:
  - `openRouterBaseUrl`
  - `openRouterExtraHeaders`
  - `modelTimeoutMs`

### Tool-facing contracts
- `read_code`, `apply_strudel_change`, `strudel_knowledge` remain core tool interfaces from `packages/jam-core/src/tools/contracts.ts`.

Stability note:
- Global browser hooks should be treated as integration-stable unless a migration plan is documented.
- Fake-list exports from `packages/jam-core/src/index.ts` are mixed-scope and should be considered removable with a dedicated migration.

## Known Risks and Operational Pitfalls
- Host/WSL port mismatch can cause `ERR_CONNECTION_REFUSED` for agent module URL.
- If `4174` is inaccessible from host, alias `4175` path can still work depending on env.
- Submodule drift risk: edits outside allowlist under `strudel/` will violate boundary policy.
- Dev/fake controls can leak assumptions into production if not kept explicitly behind runtime override checks.
- Dynamic import fallback order can mask stale `chatraveAgentModuleUrl` values in localStorage.

## Future Development Checklist
Before coding:
- Confirm whether change belongs in `strudel/`, adapter, agent-web, or jam-core.
- If touching `strudel/`, verify file is in allowlist.
- Classify dependency as `production`, `dev-only`, or `mixed`.

Before merge:
- Run `pnpm run check:strudel-boundary`.
- Run `pnpm run check:dev-fake-boundary`.
- Run typecheck/tests across workspace.
- Update this guide if:
  - integration flow changed,
  - dependency set changed,
  - public contracts changed,
  - boundary rules changed.

## Appendix: Verification Commands
- Boundary guard:
```bash
pnpm run check:strudel-boundary
```

- Dev/fake boundary document consistency:
```bash
pnpm run check:dev-fake-boundary
```

- Workspace typecheck:
```bash
pnpm run typecheck
```

- Workspace tests:
```bash
pnpm run test
```

- Full CI-equivalent local run:
```bash
pnpm run ci
```

- Dev bootstrap (agent + strudel + alias):
```bash
tools/run-dev.sh
```
