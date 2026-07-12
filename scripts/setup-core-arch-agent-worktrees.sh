#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_DIR="${JESS_AGENT_WORKTREE_BASE:-$HOME/git/worktrees/jess}"

agents=(
  "agent-a|feature/core-arch-agent-a|$BASE_DIR/core-arch-agent-a"
  "agent-b|feature/core-arch-agent-b|$BASE_DIR/core-arch-agent-b"
  "agent-c|feature/core-arch-agent-c|$BASE_DIR/core-arch-agent-c"
)

mkdir -p "$BASE_DIR"
git -C "$ROOT_DIR" fetch origin

worktree_exists() {
  local path="$1"
  git -C "$ROOT_DIR" worktree list --porcelain | grep -Fqx "worktree $path"
}

is_dirty() {
  local path="$1"
  ! git -C "$path" diff --quiet || ! git -C "$path" diff --cached --quiet
}

for spec in "${agents[@]}"; do
  IFS='|' read -r name branch path <<<"$spec"

  if ! worktree_exists "$path"; then
    if git -C "$ROOT_DIR" show-ref --verify --quiet "refs/heads/$branch"; then
      git -C "$ROOT_DIR" worktree add "$path" "$branch"
    else
      git -C "$ROOT_DIR" worktree add -b "$branch" "$path" origin/dev
    fi
  fi

  git -C "$path" fetch origin

  if is_dirty "$path"; then
    echo "skip refresh for $name ($path): worktree is dirty"
    continue
  fi

  git -C "$path" checkout "$branch"
  git -C "$path" merge --no-edit origin/dev
done

git -C "$ROOT_DIR" worktree list
