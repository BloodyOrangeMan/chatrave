#!/usr/bin/env bash
set -euo pipefail

if [[ ! -e strudel/.git ]]; then
  exit 0
fi

changed_files=$(git -C strudel diff --name-only || true)

if [[ -z "${changed_files}" ]]; then
  exit 0
fi

while IFS= read -r file; do
  [[ -z "${file}" ]] && continue
  if [[ "${file}" == "website/src/repl/components/panel/Panel.jsx" || "${file}" == "pnpm-lock.yaml" ]]; then
    continue
  else
    echo "Boundary violation: disallowed tracked change under strudel/: ${file}"
    echo "Allowed in Phase 1:"
    echo "  - strudel/website/src/repl/components/panel/Panel.jsx"
    echo "  - strudel/pnpm-lock.yaml"
    exit 1
  fi
done <<< "${changed_files}"
