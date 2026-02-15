#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_LOG="${ROOT_DIR}/.agent-web.dev.log"
STRUDEL_LOG="${ROOT_DIR}/.strudel.dev.log"
ALIAS_LOG="${ROOT_DIR}/.agent-alias.dev.log"

cleanup() {
  if [[ -n "${ALIAS_PID:-}" ]] && kill -0 "${ALIAS_PID}" 2>/dev/null; then
    kill "${ALIAS_PID}" 2>/dev/null || true
  fi
  if [[ -n "${AGENT_PID:-}" ]] && kill -0 "${AGENT_PID}" 2>/dev/null; then
    kill "${AGENT_PID}" 2>/dev/null || true
  fi
  if [[ -n "${STRUDEL_PID:-}" ]] && kill -0 "${STRUDEL_PID}" 2>/dev/null; then
    kill "${STRUDEL_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

rm -f "${AGENT_LOG}" "${STRUDEL_LOG}" "${ALIAS_LOG}"

echo "Starting agent-web dev server..."
(
  cd "${ROOT_DIR}"
  pnpm --filter @chatrave/agent-web dev
) >"${AGENT_LOG}" 2>&1 &
AGENT_PID=$!

echo "Starting strudel dev server..."
(
  cd "${ROOT_DIR}/strudel"
  pnpm run dev
) >"${STRUDEL_LOG}" 2>&1 &
STRUDEL_PID=$!

echo "Starting agent port alias (4175 -> 4174)..."
(
  cd "${ROOT_DIR}"
  node tools/agent-port-alias.mjs
) >"${ALIAS_LOG}" 2>&1 &
ALIAS_PID=$!

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

    if ! kill -0 "${AGENT_PID}" 2>/dev/null && [[ "${file}" == "${AGENT_LOG}" ]]; then
      echo "agent-web exited early. Log: ${AGENT_LOG}" >&2
      tail -n 60 "${AGENT_LOG}" >&2 || true
      return 1
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

wait_for_log_line "${AGENT_LOG}" "Local:\\s+http://localhost:[0-9]+/" 45
wait_for_log_line "${STRUDEL_LOG}" "(Local|localhost|127\\.0\\.0\\.1)" 60
wait_for_log_line "${ALIAS_LOG}" "\\[chatrave\\]\\[agent-alias\\] listening" 15

AGENT_URL=$(grep -Eo 'http://localhost:[0-9]+/' "${AGENT_LOG}" | head -n1 || true)
if [[ -z "${AGENT_URL}" ]]; then
  AGENT_URL="http://localhost:4174/"
fi

# Strudel Astro typically runs on 4321; keep a sane default and print hint.
STRUDEL_URL="http://localhost:4321/"
OPENROUTER_BASE_URL="${CHATRAVE_OPENROUTER_BASE_URL:-http://127.0.0.1:8787/api/v1}"
MOCK_SCENARIO="${CHATRAVE_MOCK_SCENARIO:-successful_jam_apply}"

echo
printf '%s\n' "Dev servers are up:"
printf '  - agent-web: %s\n' "${AGENT_URL}"
printf '%s\n' "  - agent alias: http://localhost:4175/ (proxy to agent-web)"
printf '  - strudel:   %s\n' "${STRUDEL_URL}"
echo
printf '%s\n' "Manual browser check:"
printf '%s\n' "  1) Open ${STRUDEL_URL}"
printf '%s\n' "  2) Open the 'agent' tab"
printf '%s\n' "  3) If agent does not auto-load or mock LLM is wrong, run once in browser console:"
printf '     localStorage.setItem("chatraveAgentModuleUrl", "%ssrc/index.ts"); localStorage.setItem("chatraveOpenRouterBaseUrl", "%s"); localStorage.setItem("chatraveMockLlmScenario", "%s"); location.reload();\n' "${AGENT_URL}" "${OPENROUTER_BASE_URL}" "${MOCK_SCENARIO}"
echo
printf '%s\n' "Tip: override defaults at launch:"
printf '%s\n' "  CHATRAVE_OPENROUTER_BASE_URL=http://localhost:8787/api/v1 CHATRAVE_MOCK_SCENARIO=read_then_apply_success tools/run-dev.sh"

echo
echo "Streaming logs (Ctrl+C to stop both):"
( tail -n +1 -f "${AGENT_LOG}" & )
TAIL_AGENT_PID=$!
( tail -n +1 -f "${STRUDEL_LOG}" & )
TAIL_STRUDEL_PID=$!
( tail -n +1 -f "${ALIAS_LOG}" & )
TAIL_ALIAS_PID=$!

wait -n "${AGENT_PID}" "${STRUDEL_PID}" "${ALIAS_PID}" || true

kill "${TAIL_AGENT_PID}" "${TAIL_STRUDEL_PID}" "${TAIL_ALIAS_PID}" 2>/dev/null || true
