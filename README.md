# Chatrave

Offline-first Strudel jam assistant that runs in-browser as a side tab in the original Strudel UI.

- Audio/editor/runtime stay local in browser.
- Only external dependency is LLM API calls (OpenRouter) when real mode is enabled.
- Agent tools (`read_code`, `apply_strudel_change`, `strudel_knowledge`, `skill`) run locally.

## Current Status

Active development. APIs and internal structure may change.

## Prerequisites

- `node >= 20`
- `pnpm 10.4.1`
- `git` with submodule support
- Linux/macOS shell (Windows: use WSL2 recommended)

## Quick Start (Recommended)

```bash
git clone <your-repo-url>
cd chatrave
git submodule update --init --recursive
pnpm install
pnpm -C strudel install
pnpm run dev
```

`pnpm run dev` starts:
- `@chatrave/agent-web` dev server
- Strudel dev server (`strudel/`)
- local alias proxy for agent module URL compatibility

## Mock LLM Mode

In Agent tab UI:
1. Open `Dev`
2. Toggle `Mock LLM` to `ON`
3. Pick a scenario

Available scenarios are defined in `packages/agent-core/src/mock-scenarios.ts`.

## Strudel Submodule Policy (Important)

`strudel/` is an upstream submodule boundary.

We keep integration changes as patch overlays:
- Patch files: `patches/strudel/*.patch`
- Apply script: `tools/apply-strudel-patches.sh`
- Dev bootstrap applies overlays automatically via `tools/run-dev.sh`

If overlay apply fails (upstream drift), sync submodule and refresh the patch.

## Project Structure

```text
apps/agent-web            # Agent UI (React + @ai-sdk/react)
packages/agent-core       # Agent runtime/orchestration (AI SDK ToolLoopAgent)
packages/agent-tools      # Tool contracts + implementations
packages/strudel-bridge   # Browser bridge to Strudel runtime/editor
packages/strudel-adapter  # Adapter hooks into Strudel tab/theme/reference/sounds
packages/shared-types     # Shared contracts
packages/storage-local    # localStorage settings persistence
strudel/                  # upstream Strudel submodule
patches/strudel/          # local overlay patches for submodule integration
tools/                    # scripts and CI checks
```

## Configuration

- OpenRouter API key is set in Agent UI `Settings` and stored in browser localStorage.
- Voice provider keys (if used) are also set in UI settings.
- `.env` is local-only and ignored.

## Development Commands

```bash
pnpm run dev              # start full local dev (agent + strudel + alias)
pnpm run build:agent-web  # build agent app
pnpm run build:strudel    # build strudel website
pnpm run build:all        # build both
pnpm run typecheck
pnpm run test
pnpm run ci               # boundary + secrets + typecheck + tests
```

## Deployment (Static-First)

Chatrave is deployable as a static app with no backend required.

- Agent and Strudel runtime logic run in browser.
- Users provide their own OpenRouter API key in Settings (stored locally in browser).
- Skills are bundled at build time, not loaded from runtime filesystem.

For Vercel single-project deployment:

1. Import the repo.
2. Build command: `pnpm run build:strudel`
3. Output directory: `strudel/website/dist`
4. Install command: `pnpm install && pnpm -C strudel install`

`vercel.json` includes these defaults.

See `docs/DEPLOYMENT.md` for full deployment steps and production smoke checklist.

## Testing and CI

CI workflow: `.github/workflows/ci.yml`

Checks include:
- submodule boundary guard
- secret scan guard
- dev/fake boundary doc guard
- prompt placeholder guard
- workspace typecheck + tests

## Troubleshooting

### Agent tab not loading

- Ensure `pnpm run dev` is running.
- In browser console:

```js
localStorage.setItem('chatraveAgentModuleUrl', 'http://localhost:4175/src/index.ts');
location.reload();
```

Production default is same-origin `/chatrave-agent/agent-tab.js`.

### `http://localhost:4175/src/index.ts` refused

- Agent dev server may be on another port; check `tools/run-dev.sh` output.
- Set `chatraveAgentModuleUrl` to the printed agent-web URL + `/src/index.ts`.

### Submodule missing

```bash
git submodule update --init --recursive
```

### Overlay patch apply failure

- Re-sync submodule and retry:

```bash
git submodule update --init --recursive --remote
bash tools/apply-strudel-patches.sh
```

## Documentation Index

- `AGENTS.md`
- `docs/DEPLOYMENT.md`
- `docs/UIUX.md`
- `docs/STRUDEL_KNOWLEDGE_TOOL_SPEC.md`
- `docs/AGENT_INTEGRATION_GUIDE.md`
- `docs/DEV_FAKE_BOUNDARY.md`
- `docs/STRUDEL_PATCH_POLICY.md`

## Contributing

- Keep files small and modular under `apps/` and `packages/`.
- Do not place agent business logic inside `strudel/`.
- For Strudel integration tweaks, update patch overlays under `patches/strudel/`.
- Run `pnpm run ci` before opening PRs.

## License

Project license currently follows repository policy. Upstream Strudel submodule license is in `strudel/LICENSE`.
