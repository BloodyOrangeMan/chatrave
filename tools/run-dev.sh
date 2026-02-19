#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STRUDEL_LOG="${ROOT_DIR}/.strudel.dev.log"

cleanup() {
  if [[ -n "${STRUDEL_PID:-}" ]] && kill -0 "${STRUDEL_PID}" 2>/dev/null; then
    kill "${STRUDEL_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

rm -f "${STRUDEL_LOG}"

echo "Building and staging agent bundle for same-origin dev..."
(
  cd "${ROOT_DIR}"
  pnpm --filter @chatrave/agent-web build
  pnpm -C strudel jsdoc-json
  node tools/stage-agent-web.mjs
)

echo "Starting strudel dev server..."
(
  cd "${ROOT_DIR}/strudel"
  pnpm run dev
) >"${STRUDEL_LOG}" 2>&1 &
STRUDEL_PID=$!

wait_for_log_line() {
  local file="$1"
  local pattern="$2"
  local timeout_secs="${3:-30}"
  local start_ts
  start_ts=$(date +%s)

  while true; do
    if grep -qE "${pattern}" "${file}" 2>/dev/null; then
      return 0
    fi

    if ! kill -0 "${STRUDEL_PID}" 2>/dev/null && [[ "${file}" == "${STRUDEL_LOG}" ]]; then
      echo "strudel dev server exited early. Log: ${STRUDEL_LOG}" >&2
      tail -n 60 "${STRUDEL_LOG}" >&2 || true
      return 1
    fi

    if (( $(date +%s) - start_ts > timeout_secs )); then
      echo "Timed out waiting for ${pattern} in ${file}" >&2
      tail -n 80 "${file}" >&2 || true
      return 1
    fi

    sleep 0.2
  done
}

wait_for_log_line "${STRUDEL_LOG}" "(Local|localhost|127\\.0\\.0\\.1)" 60

# Capture actual local URL from Astro log (port can shift if busy).
STRUDEL_URL="$(grep -oE 'http://localhost:[0-9]+/' "${STRUDEL_LOG}" | tail -n 1 || true)"
if [[ -z "${STRUDEL_URL}" ]]; then
  STRUDEL_URL="http://localhost:4321/"
fi

echo
printf '%s\n' "Dev servers are up:"
printf '  - strudel:   %s\n' "${STRUDEL_URL}"
echo
printf '%s\n' "Manual browser check:"
printf '%s\n' "  1) Open ${STRUDEL_URL}"
printf '%s\n' "  2) Open the 'agent' tab"
printf '%s\n' "  3) Agent loads from same-origin /chatrave-agent/agent-tab.js (no extra dev ports)."
echo
printf '%s\n' "Tip: if you change apps/agent-web source, rerun pnpm run dev to rebuild the staged bundle."

echo
echo "Streaming logs (Ctrl+C to stop):"
( tail -n +1 -f "${STRUDEL_LOG}" & )
TAIL_STRUDEL_PID=$!

wait -n "${STRUDEL_PID}" || true

kill "${TAIL_STRUDEL_PID}" 2>/dev/null || true
