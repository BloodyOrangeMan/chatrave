# Agent Integration Guide (Post Cleanup)

## Active Packages
- `@chatrave/agent-core`: AI SDK runner/session
- `@chatrave/agent-tools`: tool contracts + implementations
- `@chatrave/strudel-bridge`: browser Strudel host integration
- `@chatrave/agent-web`: UI and event rendering

## Current Runtime Flow
1. User sends a prompt in `apps/agent-web/src/index.ts`.
2. `apps/agent-web/src/App.tsx` runs chat via `useChat(...)`.
3. `apps/agent-web/src/worker-client.ts` provides `DirectChatTransport(...)` backed by an agent.
4. `packages/agent-core/src/create-jam-agent.ts` runs OpenRouter with AI SDK `ToolLoopAgent`.
5. Tool calls are executed through `packages/agent-tools/src/dispatcher.ts`.
6. Apply/read operations run through `packages/strudel-bridge/src/index.ts`.

## Dev Mock Mode
- Controlled by `apps/agent-web/src/runtime-overrides.ts`.
- Uses in-process mock scenarios from `packages/agent-core/src/mock-scenarios.ts`.
- No HTTP mock server is required.

## Removed Legacy Surface
- `packages/jam-core/**` removed.
- `scripts/mock-llm-server.mjs` removed.
- Root `mock:llm` script removed.
- LangChain-based fake model path removed.
