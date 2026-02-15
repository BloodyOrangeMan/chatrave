# Dev/Fake vs Production Boundary Tracker

## Purpose
Track what is production runtime vs dev-only behavior after the AI SDK clean-slate rewrite.

## Runtime Boundary Map

| Area | File | Classification | Notes |
| --- | --- | --- | --- |
| Agent runtime factory | `packages/agent-core/src/create-jam-agent.ts` | `production` | AI SDK `ToolLoopAgent` + OpenRouter provider + tool orchestration. |
| Tool implementations | `packages/agent-tools/src/**` | `production` | `read_code`, `apply_strudel_change`, `strudel_knowledge`. |
| Strudel host bridge | `packages/strudel-bridge/src/index.ts` | `production` | REPL snapshot, dry-run validate, quantized apply. |
| Agent UI | `apps/agent-web/src/index.ts` | `mixed` | Production chat UI + dev controls surface. |
| Runtime overrides | `apps/agent-web/src/runtime-overrides.ts` | `dev-only` | LocalStorage toggle for mock mode/scenario. |
| Worker/client wiring | `apps/agent-web/src/worker-client.ts` | `mixed` | Production runtime plus dev mock switch wiring. |
| Dev bootstrap script | `tools/run-dev.sh` | `dev-only` | Starts Strudel, agent-web and alias process. |
| Agent URL alias utility | `tools/agent-port-alias.mjs` | `dev-only` | Local port alias for host/browser convenience. |

## Removed Deprecated Components (2026-02-15)
- `packages/jam-core/**`
- `scripts/mock-llm-server.mjs`
- root `mock:llm` script
- LangChain fake-model dependency path

## Canonical Production Path
1. `apps/agent-web/src/index.ts` sends user text.
2. `apps/agent-web/src/App.tsx` uses `useChat(...)`.
3. `apps/agent-web/src/worker-client.ts` provides `DirectChatTransport(...)` with `createJamAgent(...)`.
4. `packages/agent-core/src/create-jam-agent.ts` runs tool loop via AI SDK.
5. `packages/agent-tools/src/dispatcher.ts` dispatches tool calls.
6. `packages/strudel-bridge/src/index.ts` performs read/apply against in-browser Strudel host.

## Dev/Fake Runtime Path
1. Enable mock LLM in Dev UI toggle.
2. `runtime-overrides.ts` provides mock scenario config.
3. `agent-core` mock scenario runner emits deterministic thinking/tool/text streams.

## Exit Criteria Checklist
- [x] No runtime import from `packages/jam-core/**`
- [x] No runtime dependency on HTTP mock server
- [x] Root `mock:llm` script removed
- [x] Tests green after cleanup
