#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -x "${ROOT_DIR}/tools/apply-strudel-patches.sh" ]]; then
  "${ROOT_DIR}/tools/apply-strudel-patches.sh"
fi

cd "${ROOT_DIR}"
pnpm run build:agent-web
node tools/stage-agent-web.mjs
pnpm -C strudel/website build
