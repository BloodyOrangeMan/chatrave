#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STR_DIR="${ROOT_DIR}/strudel"
PATCH_DIR="${ROOT_DIR}/patches/strudel"

if [[ ! -d "${STR_DIR}" ]]; then
  echo "Missing strudel/ directory. Did you clone with submodules?" >&2
  exit 1
fi

if [[ ! -e "${STR_DIR}/.git" ]]; then
  echo "strudel/ submodule is not initialized." >&2
  echo "Run: git submodule update --init --recursive" >&2
  exit 1
fi

if [[ ! -d "${PATCH_DIR}" ]]; then
  echo "No patch directory found at ${PATCH_DIR}; nothing to apply."
  exit 0
fi

shopt -s nullglob
patches=("${PATCH_DIR}"/*.patch)
shopt -u nullglob

if (( ${#patches[@]} == 0 )); then
  echo "No strudel patches found; nothing to apply."
  exit 0
fi

echo "Applying Strudel overlay patches..."
for patch in "${patches[@]}"; do
  rel="${patch#${ROOT_DIR}/}"

  if git -C "${STR_DIR}" apply --reverse --check "${patch}" >/dev/null 2>&1; then
    echo "  - ${rel}: already applied"
    continue
  fi

  if git -C "${STR_DIR}" apply --check "${patch}" >/dev/null 2>&1; then
    git -C "${STR_DIR}" apply "${patch}"
    echo "  - ${rel}: applied"
    continue
  fi

  echo "  - ${rel}: cannot apply cleanly (submodule drift or manual edits)." >&2
  echo "    Resolve by syncing submodule and/or refreshing patch." >&2
  exit 1
done

echo "Strudel overlay patches are ready."
