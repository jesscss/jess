#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/state/agent-loop"
MAX_ITERATIONS="${MAX_ITERATIONS:-0}"
RUN_SECONDS="${RUN_SECONDS:-}"
DEADLINE_EPOCH=""

usage() {
  cat <<'EOF'
Usage:
  bash scripts/agent-task-loop.sh [--max <count>] [--hours <hours>] [--minutes <minutes>]

Environment:
  MAX_ITERATIONS=0 means run until no ready tasks remain.
  Leave RUN_SECONDS unset for no wall-clock budget.
EOF
}

duration_to_seconds() {
  node --input-type=module - "$1" "$2" <<'EOF'
const value = Number(process.argv[2]);
const multiplier = Number(process.argv[3]);

if (!Number.isFinite(value) || value < 0) {
  console.error('Duration must be a non-negative number.');
  process.exit(1);
}

process.stdout.write(String(Math.ceil(value * multiplier)));
EOF
}

time_budget_expired() {
  if [[ -z "$RUN_SECONDS" ]]; then
    return 1
  fi

  [[ "$(date +%s)" -ge "$DEADLINE_EPOCH" ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --max) MAX_ITERATIONS="$2"; shift 2 ;;
    --hours) RUN_SECONDS="$(duration_to_seconds "$2" 3600)"; shift 2 ;;
    --minutes) RUN_SECONDS="$(duration_to_seconds "$2" 60)"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

mkdir -p "$STATE_DIR"

if [[ -n "$RUN_SECONDS" ]]; then
  DEADLINE_EPOCH="$(($(date +%s) + RUN_SECONDS))"
  echo "Task loop time budget: ${RUN_SECONDS}s."
fi

iteration=0
while true; do
  if time_budget_expired; then
    echo "Time budget reached; no new task will be started."
    node "$ROOT_DIR/scripts/task-loop.mjs" status
    exit 0
  fi

  if [[ "$MAX_ITERATIONS" != "0" && "$iteration" -ge "$MAX_ITERATIONS" ]]; then
    echo "Reached MAX_ITERATIONS=$MAX_ITERATIONS."
    exit 0
  fi

  node "$ROOT_DIR/scripts/task-loop.mjs" rebuild >/dev/null

  if ! task_json="$(node "$ROOT_DIR/scripts/task-loop.mjs" next --json 2>/dev/null)"; then
    node "$ROOT_DIR/scripts/task-loop.mjs" status
    echo "No ready tasks remain."
    exit 0
  fi

  task_id="$(
    node --input-type=module - "$task_json" <<'EOF'
const task = JSON.parse(process.argv[2]);
process.stdout.write(task.id);
EOF
  )"

  prompt_file="$STATE_DIR/current-prompt.md"
  node "$ROOT_DIR/scripts/task-loop.mjs" prompt "$task_id" > "$prompt_file"

  before_status="$(
    node --input-type=module - "$task_json" <<'EOF'
const task = JSON.parse(process.argv[2]);
process.stdout.write(task.status);
EOF
  )"

  echo "Starting task: $task_id"
  (
    cd "$ROOT_DIR"
    codex \
      --cd "$ROOT_DIR" \
      --sandbox danger-full-access \
      --ask-for-approval never \
      exec \
      "$(cat "$prompt_file")"
  )

  after_status="$(
    node --input-type=module - "$ROOT_DIR/scripts/task-loop.mjs" "$task_id" <<'EOF'
import { execFileSync } from 'node:child_process';

const scriptPath = process.argv[2];
const taskId = process.argv[3];
const task = JSON.parse(execFileSync(process.execPath, [scriptPath, 'get', taskId, '--json'], { encoding: 'utf8' }));
process.stdout.write(task.status);
EOF
  )"

  if [[ "$after_status" == "$before_status" ]]; then
    echo "Task $task_id did not transition out of $before_status; stopping for inspection." >&2
    exit 1
  fi

  iteration=$((iteration + 1))
done
