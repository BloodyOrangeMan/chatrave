#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "${ROOT_DIR}/strudel/website/package.json" ]]; then
  echo "Strudel source is not available at strudel/website." >&2
  echo "Ensure strudel/ is present in the repository checkout." >&2
  exit 1
fi

cd "${ROOT_DIR}"
pnpm run build:agent-web
node tools/stage-agent-web.mjs
pnpm -C strudel jsdoc-json

if [[ ! -f "${ROOT_DIR}/strudel/doc.json" ]]; then
  echo "Missing strudel/doc.json after jsdoc-json generation." >&2
  echo "Check strudel jsdoc tooling and dependencies." >&2
  exit 1
fi

pnpm -C strudel/website build
