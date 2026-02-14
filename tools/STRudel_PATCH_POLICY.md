# Strudel Patch Policy (Phase 1)

Allowed direct submodule edit path for Phase 1 integration only:
- `strudel/website/src/repl/components/panel/Panel.jsx`
- `strudel/pnpm-lock.yaml`

Allowed scope:
- register one `agent` tab label
- render agent host container and call global renderer hook
- submodule lockfile update required by local dependency resolution

Disallowed:
- adding agent runtime, network, or business logic inside `strudel/`
- editing unrelated Strudel panel tabs/behavior
