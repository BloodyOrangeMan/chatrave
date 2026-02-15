# Strudel Patch Policy (Public Repo)

Strudel is kept as an upstream git submodule.
We do not commit direct feature changes under `strudel/**` from this repository.

## Customization Model
- Store customizations as patch files under `patches/strudel/*.patch`.
- Apply them locally via `tools/apply-strudel-patches.sh`.
- Keep patch scope minimal and integration-only.

## Current Overlay Scope
- `website/src/repl/components/panel/Panel.jsx`:
  - make `agent` the visible panel tab,
  - host/load the agent UI module,
  - keep Strudel runtime logic outside submodule.

## Disallowed
- adding agent runtime, networking, or business logic inside `strudel/`
- broad refactors unrelated to panel integration
