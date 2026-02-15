# Agent Integration Guide (Post Cleanup)

## Active Packages
- `@chatrave/agent-core`: AI SDK runner/session
- `@chatrave/agent-tools`: tool contracts + implementations
- `@chatrave/strudel-bridge`: browser Strudel host integration
- `@chatrave/agent-web`: UI and event rendering

## Current Runtime Flow
1. User sends a prompt in `apps/agent-web/src/index.ts`.
2. `apps/agent-web/src/worker-client.ts` creates an `agent-core` session.
3. `packages/agent-core/src/create-agent-session.ts` calls OpenRouter with AI SDK `streamText`.
4. Tool calls are executed through `packages/agent-tools/src/dispatcher.ts`.
5. Apply/read operations run through `packages/strudel-bridge/src/index.ts`.

## Dev Mock Mode
- Controlled by `apps/agent-web/src/runtime-overrides.ts`.
- Uses in-process mock scenarios from `packages/agent-core/src/mock-scenarios.ts`.
- No HTTP mock server is required.

## Removed Legacy Surface
- `packages/jam-core/**` removed.
- `scripts/mock-llm-server.mjs` removed.
- Root `mock:llm` script removed.
- LangChain-based fake model path removed.
