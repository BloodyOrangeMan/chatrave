#!/usr/bin/env bash
set -euo pipefail

if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "Refusing committed .env file"
  exit 1
fi

if git grep -nE '(sk-[A-Za-z0-9_-]{20,}|OPENROUTER_LLM_API_KEY|QWEN_API_KEY)' -- . ':!strudel/**' ':!tools/check-secrets.sh' >/dev/null; then
  echo "Potential secret detected in tracked files."
  git grep -nE '(sk-[A-Za-z0-9_-]{20,}|OPENROUTER_LLM_API_KEY|QWEN_API_KEY)' -- . ':!strudel/**' ':!tools/check-secrets.sh' || true
  exit 1
fi
