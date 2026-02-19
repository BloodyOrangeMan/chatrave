# Strudel Source Policy

Strudel is tracked directly in this repository under `strudel/`.
We do not use a submodule + patch overlay model anymore.

## Customization Model
- Edit Strudel integration points directly in `strudel/website/...`.
- Keep scope focused on Chatrave integration (panel host/loading, build/runtime wiring).
- Keep agent business logic in `apps/` and `packages/`, not inside Strudel sources.

## Current Integration Scope
- `strudel/website/src/repl/components/panel/Panel.jsx`
  - agent tab host and module bootstrap
  - production-safe same-origin loading
  - localhost fallbacks for local dev only

## Disallowed
- broad Strudel refactors unrelated to integration
- moving tool orchestration/business logic into Strudel runtime
