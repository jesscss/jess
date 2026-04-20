#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  codex-auto-worker.sh \
    --task-id <task-id> \
    --task-file <task-file> \
    --worktree <path> \
    --branch <branch> \
    --summary-path <path> \
    --log-file <path>
EOF
}

TASK_ID=""
TASK_FILE=""
WORKTREE=""
BRANCH=""
SUMMARY_PATH=""
LOG_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task-id) TASK_ID="$2"; shift 2 ;;
    --task-file) TASK_FILE="$2"; shift 2 ;;
    --worktree) WORKTREE="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --summary-path) SUMMARY_PATH="$2"; shift 2 ;;
    --log-file) LOG_FILE="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$TASK_ID" && -n "$TASK_FILE" && -n "$WORKTREE" && -n "$BRANCH" && -n "$SUMMARY_PATH" && -n "$LOG_FILE" ]] || {
  echo "Missing required arguments" >&2
  usage >&2
  exit 2
}

mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$(dirname "$SUMMARY_PATH")"
rm -f "$SUMMARY_PATH"

PROMPT=$(
  cat <<EOF
You are working in an isolated Jess automation worktree.

Task id: $TASK_ID
Task description file: $TASK_FILE
Summary path: $SUMMARY_PATH

Requirements:
- Solve exactly one coherent slice.
- Classify the task outcome as one of:
  1. real Jess bug
  2. outdated Less.js 4.x expectation / intentional Jess rebaseline
  3. needs-human
- If it is a real Jess bug, reproduce it in focused lower-level coverage first when appropriate.
- If it is fixture drift, update the linked Less.js alpha expectations and keep relevant Less.js branches aligned.
- Update the handoff/proposal tracking docs as needed.
- Run narrow verification, then broader affected verification.
- Commit your change if and only if the slice is clean.
- Do not push the worker branch yourself; the wrapper will only push after summary validation succeeds.
- At the end, write machine-readable JSON to "$SUMMARY_PATH" using the worker submission schema:
  - task_id
  - classification
  - reason
  - files_changed
  - verification
  - proof_refs
  - candidate_commit
  - candidate_branch
  - unresolved_concerns
- Do not end with freeform bullet text.
- Do not print the final JSON only to stdout; it must be written to "$SUMMARY_PATH".
EOF
)

cd "$WORKTREE"
codex exec --full-auto "$PROMPT" < "$TASK_FILE" | tee "$LOG_FILE"

if [[ ! -f "$SUMMARY_PATH" ]]; then
  echo "Worker did not write summary JSON: $SUMMARY_PATH" >&2
  exit 1
fi

node scripts/task-runtime/validate-submission.mjs "$SUMMARY_PATH"

summary_fields=$(
  node --input-type=module - "$SUMMARY_PATH" <<'EOF'
import { readFileSync } from 'node:fs';

const summary = JSON.parse(readFileSync(process.argv[2], 'utf8'));
process.stdout.write(
  JSON.stringify({
    candidate_commit: summary.candidate_commit,
    candidate_branch: summary.candidate_branch,
  }),
);
EOF
)

candidate_commit=$(
  node --input-type=module - "$summary_fields" <<'EOF'
const payload = JSON.parse(process.argv[2]);
process.stdout.write(payload.candidate_commit ?? '');
EOF
)

candidate_branch=$(
  node --input-type=module - "$summary_fields" <<'EOF'
const payload = JSON.parse(process.argv[2]);
process.stdout.write(payload.candidate_branch ?? '');
EOF
)

if [[ -n "$candidate_commit" ]]; then
  git rev-parse --verify "${candidate_commit}^{commit}" >/dev/null

  head_commit=$(git rev-parse HEAD)
  if [[ "$candidate_commit" != "$head_commit" ]]; then
    echo "Summary candidate_commit does not match HEAD: $candidate_commit != $head_commit" >&2
    exit 1
  fi

  if [[ -n "$candidate_branch" && "$candidate_branch" != "$BRANCH" ]]; then
    echo "Summary candidate_branch does not match worker branch: $candidate_branch != $BRANCH" >&2
    exit 1
  fi

  git push origin "HEAD:$BRANCH"
fi
