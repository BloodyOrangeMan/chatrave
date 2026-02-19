#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "${ROOT_DIR}/strudel/website/package.json" ]]; then
  echo "Strudel submodule is not available at strudel/website." >&2
  echo "Ensure git submodules are fetched in CI/deploy (git submodule update --init --recursive)." >&2
  exit 1
fi

if [[ -x "${ROOT_DIR}/tools/apply-strudel-patches.sh" ]]; then
  "${ROOT_DIR}/tools/apply-strudel-patches.sh"
fi

cd "${ROOT_DIR}"
pnpm run build:agent-web
node tools/stage-agent-web.mjs
pnpm -C strudel/website build
