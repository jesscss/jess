#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_POLICY_FILE="$ROOT_DIR/config/codex-auto-policy.json"

usage() {
  cat <<'EOF'
Usage:
  codex-auto-loop.sh [options]

Options:
  --policy-file <path>   Policy file to use
  --once                 Run one iteration only
  --task-id <task-id>    Force a specific task id for this iteration
  --max-iterations <n>   Cap the number of loop iterations
  --status               Print queue/status summary and exit
  --help                 Show this help
EOF
}

log() {
  printf '[loop] %s\n' "$*"
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 127
  }
}

expand_path() {
  if [[ "$1" == "~" ]]; then
    printf '%s\n' "$HOME"
  elif [[ "${1:0:2}" == "~/" ]]; then
    printf '%s/%s\n' "$HOME" "${1:2}"
  else
    printf '%s\n' "$1"
  fi
}

slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-'
}

json_escape() {
  jq -Rn --arg v "$1" '$v'
}

file_contains_fixed() {
  local needle="$1"
  local file="$2"
  if have_cmd rg; then
    rg -F "$needle" "$file" >/dev/null 2>&1
  else
    grep -F "$needle" "$file" >/dev/null 2>&1
  fi
}

verification_entry_matches_log() {
  local entry="$1"
  local file="$2"

  python3 - "$entry" "$file" <<'PY'
import pathlib
import sys

entry = sys.argv[1]
log = pathlib.Path(sys.argv[2]).read_text()

variants = []

def add_variant(value):
    if value and value not in variants:
        variants.append(value)

def normalize(value):
    previous = None
    while value != previous:
        previous = value
        value = (
            value
            .replace('\\"', '"')
            .replace("\\'", "'")
            .replace('\\\\', '\\')
        )
    return value

add_variant(entry)

if " (" in entry:
    add_variant(entry.split(" (", 1)[0])

normalized_log = normalize(log)

for candidate in list(variants):
    add_variant(normalize(candidate))

for candidate in variants:
    if candidate in log or candidate in normalized_log:
        sys.exit(0)

sys.exit(1)
PY
}

file_contains_regex() {
  local pattern="$1"
  local file="$2"
  if have_cmd rg; then
    rg -E "$pattern" "$file" >/dev/null 2>&1
  else
    grep -E "$pattern" "$file" >/dev/null 2>&1
  fi
}

extract_regex_matches() {
  local pattern="$1"
  local file="$2"
  if have_cmd rg; then
    rg -o "$pattern" "$file" || true
  else
    grep -Eo "$pattern" "$file" || true
  fi
}

numbered_matches() {
  local pattern="$1"
  local file="$2"
  if have_cmd rg; then
    rg -n "$pattern" "$file" || true
  else
    grep -En "$pattern" "$file" || true
  fi
}

POLICY_FILE="$DEFAULT_POLICY_FILE"
RUN_ONCE=0
FORCED_TASK_ID=""
MAX_ITERATIONS=0
STATUS_ONLY=0
ATTEMPTED_TASK_IDS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --policy-file) POLICY_FILE="$2"; shift 2 ;;
    --once) RUN_ONCE=1; shift ;;
    --task-id) FORCED_TASK_ID="$2"; shift 2 ;;
    --max-iterations) MAX_ITERATIONS="$2"; shift 2 ;;
    --status) STATUS_ONLY=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown arg: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

require_cmd git
require_cmd jq
require_cmd codex

[[ -f "$POLICY_FILE" ]] || {
  printf 'Missing policy file: %s\n' "$POLICY_FILE" >&2
  exit 1
}

STABLE_BRANCH="$(jq -r '.stable_branch' "$POLICY_FILE")"
AUTOMATION_BRANCH="$(jq -r '.automation_branch' "$POLICY_FILE")"
AUTOMATION_BASE_REF_RAW="$(jq -r '.automation_base_ref // empty' "$POLICY_FILE")"
WORKER_BRANCH_PREFIX="$(jq -r '.worker_branch_prefix' "$POLICY_FILE")"
WORKTREE_ROOT="$(expand_path "$(jq -r '.worktree_root' "$POLICY_FILE")")"
STATE_ROOT="$ROOT_DIR/$(jq -r '.state_root' "$POLICY_FILE")"
RUNTIME_DB="$ROOT_DIR/$(jq -r '.runtime_db' "$POLICY_FILE")"
TASK_INDEX_FILE="$ROOT_DIR/$(jq -r '.task_index_file' "$POLICY_FILE")"
MAX_FAILURES="$(jq -r '.max_failures' "$POLICY_FILE")"
MANUAL_OVERRIDE_FILE="$ROOT_DIR/$(jq -r '.manual_override_file' "$POLICY_FILE")"
ALL_LESS_CMD="$(jq -r '.commands.all_less' "$POLICY_FILE")"
CORE_BUILD_CMD="$(jq -r '.commands.core_build' "$POLICY_FILE")"
JESS_BUILD_CMD="$(jq -r '.commands.jess_build' "$POLICY_FILE")"

GOVERNING_DOCS=()
while IFS= read -r line; do
  GOVERNING_DOCS+=("$line")
done < <(jq -r '.governing_docs[]?' "$POLICY_FILE")

LEASES_DIR="$STATE_ROOT/leases"
LOGS_DIR="$STATE_ROOT/logs"
RESULTS_DIR="$STATE_ROOT/results"
RUNS_DIR="$STATE_ROOT/runs"
TASKS_DIR="$STATE_ROOT/tasks"
LAST_ALL_LESS_FILE="$RESULTS_DIR/all-less.latest.log"
DISCOVERED_TASKS_FILE="$RESULTS_DIR/discovered-tasks.json"
CURRENT_STATE_VERSION=2

if [[ -n "$AUTOMATION_BASE_REF_RAW" ]]; then
  AUTOMATION_BASE_REF="$AUTOMATION_BASE_REF_RAW"
else
  AUTOMATION_BASE_REF="origin/$AUTOMATION_BRANCH"
fi

runtime_state_exec() {
  local action="$1"
  local payload_json="${2-}"
  if [[ -z "$payload_json" ]]; then
    payload_json='{}'
  fi
  ACTION="$action" \
    PAYLOAD_JSON="$payload_json" \
    RUNTIME_DB="$RUNTIME_DB" \
    TASK_INDEX_FILE="$TASK_INDEX_FILE" \
    node --input-type=module - <<EOF
import { createRuntimeState } from '${ROOT_DIR}/scripts/task-runtime/runtime-state.mjs';
import { listTaskSnapshots } from '${ROOT_DIR}/scripts/task-runtime/lib/task-files.mjs';

const action = process.env.ACTION;
const payload = process.env.PAYLOAD_JSON ? JSON.parse(process.env.PAYLOAD_JSON) : {};
const state = createRuntimeState(process.env.RUNTIME_DB);

try {
  switch (action) {
    case 'init':
      break;
    case 'task-status':
      process.stdout.write(state.getTaskStatus(payload.task_id));
      break;
    case 'count-status': {
      const tasks = listTaskSnapshots({ indexPath: process.env.TASK_INDEX_FILE }).map((entry) => entry.task);
      let count = 0;
      for (const task of tasks) {
        const runtimeStatus = state.getTaskStatus(task.id);
        const effectiveStatus =
          task.status === 'open' && runtimeStatus === 'leased'
            ? 'leased'
            : task.status;
        if (effectiveStatus === payload.status) {
          count++;
        }
      }
      process.stdout.write(String(count));
      break;
    }
    case 'create-run':
      state.createRun(payload);
      break;
    case 'start-run':
      state.startRun(payload.run, payload.event);
      break;
    case 'finish-run':
      state.finishRun(payload.run_id, payload.status, payload.finished_at);
      break;
    case 'fail-run':
      state.failRun(payload);
      break;
    case 'record-submission':
      state.recordSubmission(payload);
      break;
    case 'record-result':
      state.recordResult(payload);
      break;
    case 'insert-event':
      state.insertEvent(payload);
      break;
    case 'lease-task':
      state.leaseTask(payload.task_id, payload);
      break;
    default:
      throw new Error('Unknown runtime-state action: ' + action);
  }
} finally {
  state.close();
}
EOF
}

runtime_init() {
  mkdir -p "$(dirname "$RUNTIME_DB")"
  runtime_state_exec init
}

runtime_task_status() {
  local task_id="$1"
  runtime_state_exec task-status "$(jq -nc --arg task_id "$task_id" '{task_id:$task_id}')"
}

runtime_count_status() {
  local status="$1"
  runtime_state_exec count-status "$(jq -nc --arg status "$status" '{status:$status}')"
}

runtime_create_run() {
  local payload_json="$1"
  runtime_state_exec create-run "$payload_json"
}

runtime_start_run() {
  local payload_json="$1"
  runtime_state_exec start-run "$payload_json"
}

runtime_finish_run() {
  local payload_json="$1"
  runtime_state_exec finish-run "$payload_json"
}

runtime_fail_run() {
  local payload_json="$1"
  runtime_state_exec fail-run "$payload_json"
}

runtime_record_submission() {
  local payload_json="$1"
  runtime_state_exec record-submission "$payload_json"
}

runtime_record_result() {
  local payload_json="$1"
  runtime_state_exec record-result "$payload_json"
}

runtime_insert_event() {
  local payload_json="$1"
  runtime_state_exec insert-event "$payload_json"
}

apply_task_transition() {
  local task_id="$1"
  local status="$2"
  local event_type="$3"
  local run_id="${4:-}"
  local commit_sha="${5:-}"
  local summary_file="${6:-}"
  local payload_json event_id

  event_id="${run_id:-$(slugify "$task_id")}:task-transition:${status}:$(date +%s)"
  payload_json="$(jq -nc \
    --arg summary_file "$summary_file" \
    --argjson summary "$(if [[ -n "$summary_file" && -f "$summary_file" ]]; then jq -c '.' "$summary_file"; else printf 'null'; fi)" \
    '{summary_file:(if $summary_file == "" then null else $summary_file end), summary:$summary}')"

  cmd=(
    node "$ROOT_DIR/scripts/task-runtime/apply-transition.mjs"
    --task-id "$task_id"
    --status "$status"
    --event-id "$event_id"
    --event-type "$event_type"
    --actor coordinator
    --payload-json "$payload_json"
  )

  if [[ -n "$run_id" ]]; then
    cmd+=(--run-id "$run_id")
  fi

  if [[ "$status" == "completed" && -n "$run_id" ]]; then
    cmd+=(--accepted-run-id "$run_id")
  fi

  if [[ -n "$commit_sha" ]]; then
    cmd+=(--accepted-commit "$commit_sha")
  fi

  "${cmd[@]}"
}

init_state() {
  mkdir -p "$LEASES_DIR" "$LOGS_DIR" "$RESULTS_DIR" "$RUNS_DIR" "$TASKS_DIR" "$WORKTREE_ROOT"
  runtime_init
  if [[ ! -f "$MANUAL_OVERRIDE_FILE" ]]; then
    printf '{\"queue\":[],\"skip\":[],\"pin\":null}\n' > "$MANUAL_OVERRIDE_FILE"
  fi
}

sync_remote() {
  log "fetching origin branches"
  if [[ "$AUTOMATION_BASE_REF" == origin/* ]]; then
    git -C "$ROOT_DIR" fetch origin "$STABLE_BRANCH" "$AUTOMATION_BRANCH" >/dev/null 2>&1 || true
  else
    git -C "$ROOT_DIR" fetch origin "$STABLE_BRANCH" >/dev/null 2>&1 || true
  fi
}

ensure_automation_branch() {
  if ! git -C "$ROOT_DIR" ls-remote --exit-code --heads origin "$AUTOMATION_BRANCH" >/dev/null 2>&1; then
    log "creating automation branch from ${AUTOMATION_BASE_REF}"
    git -C "$ROOT_DIR" push --no-verify origin "${AUTOMATION_BASE_REF}:refs/heads/$AUTOMATION_BRANCH"
  fi
}

run_all_less_snapshot() {
  log "running all-less snapshot"
  if eval "cd \"$ROOT_DIR\" && $ALL_LESS_CMD" >"$LAST_ALL_LESS_FILE" 2>&1; then
    log "all-less is green"
    return 0
  fi
  if file_contains_fixed 'Command "vitest" not found' "$LAST_ALL_LESS_FILE"; then
    log "all-less unavailable in this environment; continuing"
    return 0
  fi
  log "all-less still red"
  return 1
}

task_registry_exec() {
  local action="$1"
  local payload_json="${2-}"
  if [[ -z "$payload_json" ]]; then
    payload_json='{}'
  fi
  ACTION="$action" \
    PAYLOAD_JSON="$payload_json" \
    TASK_INDEX_FILE="$TASK_INDEX_FILE" \
    node --input-type=module - <<EOF
import { findTaskFileById, listTaskSnapshots } from '${ROOT_DIR}/scripts/task-runtime/lib/task-files.mjs';

const action = process.env.ACTION;
const payload = process.env.PAYLOAD_JSON ? JSON.parse(process.env.PAYLOAD_JSON) : {};

switch (action) {
  case 'list': {
    const tasks = listTaskSnapshots({ indexPath: process.env.TASK_INDEX_FILE }).map(({ task, taskPath }) => ({
      id: task.id,
      kind: task.bucket,
      source: 'task-registry',
      summary: task.title,
      track: task.track,
      bucket: task.bucket,
      priority: task.priority,
      status: task.status,
      task_path: taskPath,
      definition_of_done: task.definition_of_done,
      proof_expectations: task.proof_expectations,
      source_refs: task.source_refs,
      goal_refs: task.goal_refs,
      depends_on: task.depends_on,
      blocked_by: task.blocked_by,
      accepted_commit: task.accepted_commit,
      accepted_run_id: task.accepted_run_id,
      last_transition_event_id: task.last_transition_event_id,
    }));
    process.stdout.write(JSON.stringify(tasks));
    break;
  }
  case 'get': {
    const { task, taskPath } = findTaskFileById(payload.task_id, { indexPath: process.env.TASK_INDEX_FILE });
    process.stdout.write(JSON.stringify({
      id: task.id,
      kind: task.bucket,
      source: 'task-registry',
      summary: task.title,
      track: task.track,
      bucket: task.bucket,
      priority: task.priority,
      status: task.status,
      task_path: taskPath,
      definition_of_done: task.definition_of_done,
      proof_expectations: task.proof_expectations,
      source_refs: task.source_refs,
      goal_refs: task.goal_refs,
      depends_on: task.depends_on,
      blocked_by: task.blocked_by,
      accepted_commit: task.accepted_commit,
      accepted_run_id: task.accepted_run_id,
      last_transition_event_id: task.last_transition_event_id,
    }));
    break;
  }
  default:
    throw new Error('Unknown task registry action: ' + action);
}
EOF
}

discover_tasks() {
  local tmp_file
  tmp_file="$(mktemp "$RESULTS_DIR/discovered-tasks.XXXXXX")"
  task_registry_exec list | jq '.' > "$tmp_file"
  mv "$tmp_file" "$DISCOVERED_TASKS_FILE"
}

effective_task_status() {
  local task_json="$1"
  local snapshot_status runtime_status
  snapshot_status="$(jq -r '.status' <<<"$task_json")"
  runtime_status="$(runtime_task_status "$(jq -r '.id' <<<"$task_json")")"

  if [[ "$snapshot_status" == "open" && "$runtime_status" == "leased" ]]; then
    printf 'leased\n'
  else
    printf '%s\n' "$snapshot_status"
  fi
}

count_terminal_records() {
  local status="$1"
  runtime_count_status "$status"
}

was_attempted_this_run() {
  local id="$1"
  local attempted
  for attempted in "${ATTEMPTED_TASK_IDS[@]-}"; do
    if [[ "$attempted" == "$id" ]]; then
      return 0
    fi
  done
  return 1
}

is_auto_selectable_task() {
  local task_json="$1"
  local kind
  kind="$(jq -r '.kind // ""' <<<"$task_json")"

  case "$kind" in
    less-fixture|runtime|operator-added)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

pending_task_stats() {
  local item id total=0 auto_selectable=0 deferred_broad=0 attempted=0
  while read -r item; do
    id="$(jq -r '.id' <<<"$item")"
    case "$(effective_task_status "$item")" in
      completed|needs_human|rejected|superseded)
      continue
        ;;
    esac
    if jq -e --arg id "$id" '.skip[]? == $id' "$MANUAL_OVERRIDE_FILE" >/dev/null 2>&1; then
      continue
    fi
    if was_attempted_this_run "$id"; then
      attempted=$((attempted + 1))
      continue
    fi

    total=$((total + 1))
    if is_auto_selectable_task "$item"; then
      auto_selectable=$((auto_selectable + 1))
    else
      deferred_broad=$((deferred_broad + 1))
    fi
  done < <(jq -c '.[]' "$DISCOVERED_TASKS_FILE")

  jq -nc \
    --argjson total "$total" \
    --argjson auto_selectable "$auto_selectable" \
    --argjson deferred_broad "$deferred_broad" \
    --argjson attempted "$attempted" \
    '{total:$total, auto_selectable:$auto_selectable, deferred_broad:$deferred_broad, attempted:$attempted}'
}

select_next_task() {
  local pin queue_item id
  if [[ -n "$FORCED_TASK_ID" ]]; then
    task_registry_exec get "$(jq -nc --arg task_id "$FORCED_TASK_ID" '{task_id:$task_id}')"
    return 0
  fi

  pin="$(jq -r '.pin // empty' "$MANUAL_OVERRIDE_FILE")"
  if [[ -n "$pin" ]]; then
    task_registry_exec get "$(jq -nc --arg task_id "$pin" '{task_id:$task_id}')"
    return 0
  fi

  queue_item="$(jq -r '.queue[0] // empty' "$MANUAL_OVERRIDE_FILE")"
  if [[ -n "$queue_item" ]]; then
    task_registry_exec get "$(jq -nc --arg task_id "$queue_item" '{task_id:$task_id}')"
    return 0
  fi

  local found=""
  while IFS=$'\t' read -r priority item; do
    id="$(jq -r '.id' <<<"$item")"
    case "$(effective_task_status "$item")" in
      completed|needs_human|rejected|superseded)
      continue
        ;;
    esac
    if jq -e --arg id "$id" '.skip[]? == $id' "$MANUAL_OVERRIDE_FILE" >/dev/null 2>&1; then
      continue
    fi
    if was_attempted_this_run "$id"; then
      continue
    fi
    if (( priority >= 90 )); then
      continue
    fi
    found="$item"
    break
  done < <(
    jq -c '.[]' "$DISCOVERED_TASKS_FILE" | while read -r item; do
      printf '%s\t%s\n' "$(task_priority "$item")" "$item"
    done | sort -n -k1,1
  )

  if [[ -n "$found" ]]; then
    printf '%s\n' "$found"
  fi
}

task_priority() {
  local task_json="$1"
  local priority base_priority
  priority="$(jq -r '.priority // "p3"' <<<"$task_json")"

  case "$priority" in
    p0) printf '0\n'; return ;;
    p1) base_priority=10 ;;
    p2) base_priority=20 ;;
    *) base_priority=30 ;;
  esac

  if is_auto_selectable_task "$task_json"; then
    if [[ "$(jq -r '.kind // ""' <<<"$task_json")" == "less-fixture" ]]; then
      printf '%s\n' "$base_priority"
    elif [[ "$(jq -r '.kind // ""' <<<"$task_json")" == "runtime" ]]; then
      printf '%s\n' "$((base_priority + 5))"
    else
      printf '%s\n' "$((base_priority + 10))"
    fi
  else
     printf '90\n'
  fi
}

write_task_file() {
  local task_json="$1"
  local task_id task_file
  task_id="$(jq -r '.id' <<<"$task_json")"
  task_file="$TASKS_DIR/$(slugify "$task_id").md"
  {
    printf '# Task\n\n'
    printf 'Task id: `%s`\n\n' "$task_id"
    printf 'Task metadata:\n'
    printf '```json\n%s\n```\n\n' "$(jq . <<<"$task_json")"
    printf 'Central governing docs:\n'
    for doc in "${GOVERNING_DOCS[@]}"; do
      printf -- '- `%s`\n' "$doc"
    done
    printf '\nCentral runtime memory snapshot:\n'
    printf '```json\n'
    jq -nc \
      --arg runtime_db "$RUNTIME_DB" \
      --arg all_less_log "$LAST_ALL_LESS_FILE" \
      --arg manual_override_file "$MANUAL_OVERRIDE_FILE" \
      '{
        runtime_db: $runtime_db,
        all_less_log: $all_less_log,
        manual_override_file: $manual_override_file
      }'
    printf '\n```\n'
    if [[ -f "$MANUAL_OVERRIDE_FILE" ]]; then
      printf '\nManual overrides:\n```json\n'
      jq . "$MANUAL_OVERRIDE_FILE"
      printf '\n```\n'
    fi
    if [[ -f "$LAST_ALL_LESS_FILE" ]]; then
      printf '\nLast all-less snapshot excerpt:\n```\n'
      sed -n '1,160p' "$LAST_ALL_LESS_FILE"
      printf '\n```\n'
    fi
    printf '\nDecision policy:\n'
    printf -- '- real Jess bug: repro in focused lower-level coverage first when appropriate\n'
    printf -- '- intentional Jess behavior or fixture drift: update Less.js expectations instead of warping Jess output\n'
    printf -- '- if semantics are ambiguous, classify as `needs-human`\n'
    printf '\nRequired end state for this iteration:\n'
    printf -- '- update tracking docs if task status changed\n'
    printf -- '- run narrow and broader affected verification\n'
    printf -- '- commit and push only if the slice is clean\n'
  } > "$task_file"
  printf '%s\n' "$task_file"
}

prepare_iteration_paths() {
  local task_id="$1"
  ITERATION_STAMP="$(date +%Y%m%d-%H%M%S)"
  ITERATION_SLUG="$(slugify "$task_id")-$ITERATION_STAMP"
  ITERATION_BRANCH="${WORKER_BRANCH_PREFIX}/$ITERATION_SLUG"
  ITERATION_WORKTREE="$WORKTREE_ROOT/$ITERATION_SLUG"
  ITERATION_RUN_DIR="$RUNS_DIR/$ITERATION_SLUG"
  ITERATION_HANDOFF_DIR="$ITERATION_RUN_DIR/handoff"
  ITERATION_LOG="$LOGS_DIR/$ITERATION_SLUG.log"
  ITERATION_SUMMARY="$ITERATION_RUN_DIR/summary.json"
  mkdir -p "$ITERATION_RUN_DIR" "$ITERATION_HANDOFF_DIR"
}

build_handoff_bundle() {
  local task_id="$1"
  node "$ROOT_DIR/scripts/task-runtime/build-handoff-bundle.mjs" \
    --task-id "$task_id" \
    --out "$ITERATION_HANDOFF_DIR" \
    --runtime-db "$RUNTIME_DB"
}

create_worker_worktree() {
  local branch="$1"
  local worktree="$2"
  log "creating worker worktree: $worktree"
  git -C "$ROOT_DIR" worktree add "$worktree" -b "$branch" "$AUTOMATION_BASE_REF" >/dev/null
  prepare_worktree_environment "$worktree"
}

prepare_worktree_environment() {
  local worktree="$1"
  if [[ -d "$ROOT_DIR/node_modules" && ! -e "$worktree/node_modules" ]]; then
    ln -s "$ROOT_DIR/node_modules" "$worktree/node_modules"
  fi
  local exclude_file
  exclude_file="$(git -C "$worktree" rev-parse --git-path info/exclude)"
  mkdir -p "$(dirname "$exclude_file")"
  if ! grep -qxF 'node_modules' "$exclude_file" 2>/dev/null; then
    printf '\nnode_modules\n' >> "$exclude_file"
  fi
}

cleanup_worker_worktree() {
  local worktree="$1"
  if [[ -d "$worktree" ]]; then
    log "cleaning up worktree: $worktree"
    git -C "$ROOT_DIR" worktree remove --force "$worktree" >/dev/null 2>&1 || true
  fi
}

classify_summary() {
  local summary_file="$1"
  jq -r '.classification // "unknown"' "$summary_file" 2>/dev/null || printf 'unknown\n'
}

extract_commit_sha() {
  local summary_file="$1"
  jq -r '.candidate_commit // empty' "$summary_file" 2>/dev/null || true
}

summary_has_common_proof() {
  local summary_file="$1"
  local task_json="$2"
  local log_file="$3"
  local task_id task_summary proof matched=0

  task_id="$(jq -r '.id' <<<"$task_json")"
  task_summary="$(jq -r '.summary // ""' <<<"$task_json")"

  jq -e '
    (.reason | type == "string" and length > 0) and
    (.verification | type == "array" and length > 0) and
    (.proof_refs | type == "array" and length > 0)
  ' "$summary_file" >/dev/null 2>&1 || return 1

  while IFS= read -r proof; do
    [[ -n "$proof" ]] || return 1
    verification_entry_matches_log "$proof" "$log_file" || return 1
  done < <(jq -r '.verification[]' "$summary_file")

  while IFS= read -r proof; do
    [[ -n "$proof" ]] || return 1
    if [[ "$proof" == *"$task_id"* ]] || [[ -n "$task_summary" && "$proof" == *"$task_summary"* ]] || file_contains_fixed "$proof" "$log_file"; then
      matched=1
    fi
  done < <(jq -r '.proof_refs[]' "$summary_file")

  (( matched == 1 ))
}

summary_has_rebaseline_proof() {
  local summary_file="$1"
  local task_json="$2"
  local log_file="$3"
  jq -e '
    (.classification == "rebaseline") and
    (.candidate_commit | type == "string" and length > 0) and
    (.candidate_branch | type == "string" and length > 0)
  ' "$summary_file" >/dev/null 2>&1 || return 1

  summary_has_common_proof "$summary_file" "$task_json" "$log_file"
}

summary_has_jess_bug_proof() {
  local summary_file="$1"
  local task_json="$2"
  local log_file="$3"
  jq -e '
    (.classification == "jess-bug") and
    (.candidate_commit | type == "string" and length > 0) and
    (.candidate_branch | type == "string" and length > 0)
  ' "$summary_file" >/dev/null 2>&1 || return 1

  summary_has_common_proof "$summary_file" "$task_json" "$log_file"
}

summary_has_needs_human_proof() {
  local summary_file="$1"
  local task_json="$2"
  local log_file="$3"
  jq -e '
    (.classification == "needs-human") and
    (.unresolved_concerns | type == "string" and length > 0)
  ' "$summary_file" >/dev/null 2>&1 || return 1

  summary_has_common_proof "$summary_file" "$task_json" "$log_file"
}

normalize_classification() {
  local summary_file="$1"
  local classification="$2"
  case "$classification" in
    jess-bug|rebaseline|needs-human)
      printf '%s\n' "$classification"
      ;;
    *)
      printf 'unknown\n'
      ;;
  esac
}

run_promotion_checks() {
  local branch="$1"
  local integration_worktree="$WORKTREE_ROOT/.integration-$(slugify "$branch")"
  log "running promotion checks"
  rm -rf "$integration_worktree"
  git -C "$ROOT_DIR" worktree add --detach "$integration_worktree" "$AUTOMATION_BASE_REF" >/dev/null
  prepare_worktree_environment "$integration_worktree"
  git -C "$integration_worktree" merge --ff-only "$branch" >/dev/null
  eval "cd \"$integration_worktree\" && $CORE_BUILD_CMD" >/dev/null
  eval "cd \"$integration_worktree\" && $JESS_BUILD_CMD" >/dev/null
  git -C "$integration_worktree" push --no-verify origin "HEAD:refs/heads/$AUTOMATION_BRANCH" >/dev/null
  git -C "$ROOT_DIR" worktree remove --force "$integration_worktree" >/dev/null 2>&1 || true
}

promote_worker_branch() {
  local branch="$1"
  log "promoting branch: $branch"
  run_promotion_checks "$branch"
}

record_result() {
  local task_id="$1"
  local classification="$2"
  local branch="$3"
  local summary_file="$4"
  local commit_sha="$5"
  local accepted_by_coordinator="${6:-false}"
  local promotion_succeeded="${7:-false}"
  local run_id="${8:-}"
  local summary_json submission_ts submission_id terminal_event_type run_status event_payload terminal_event_id

  summary_json="$(jq -c '.' "$summary_file")"
  submission_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  submission_id="${run_id}:submission"

  if [[ ("$classification" == "jess-bug" || "$classification" == "rebaseline") && "$accepted_by_coordinator" == true && "$promotion_succeeded" == true ]]; then
    terminal_event_type="task_completed"
    run_status="completed"
  elif [[ "$classification" == "needs-human" && "$accepted_by_coordinator" == true ]]; then
    terminal_event_type="task_needs_human"
    run_status="needs-human"
  elif [[ "$classification" == "needs-human" ]]; then
    terminal_event_type="task_rejected"
    run_status="rejected"
  else
    terminal_event_type=""
    run_status="failed"
  fi

  runtime_record_result "$(
    jq -nc \
      --arg submission_id "$submission_id" \
      --arg run_id "$run_id" \
      --arg task_id "$task_id" \
      --arg classification "$classification" \
      --arg candidate_commit "$commit_sha" \
      --arg created_at "$submission_ts" \
      --argjson summary "$summary_json" \
      --arg branch "$branch" \
      --arg run_status "$run_status" \
      '{
        submission:{
          submission_id:$submission_id,
          run_id:$run_id,
          task_id:$task_id,
          classification:$classification,
          candidate_commit:(if $candidate_commit == "" then null else $candidate_commit end),
          summary:$summary,
          created_at:$created_at
        },
        submissionEvent:{
          event_id:"\($run_id):submission-recorded",
          task_id:$task_id,
          event_type:"submission_recorded",
          ts:$created_at,
          actor:"coordinator",
          run_id:$run_id,
          payload:{
            classification:$classification,
            branch:$branch,
            candidate_commit:(if $candidate_commit == "" then null else $candidate_commit end),
            summary:$summary
          }
        },
        terminalEvent:null,
        runStatus:$run_status,
        finishedAt:$created_at
      }'
  )"
}

log_queue_snapshot() {
  local discovered_count completed_count needs_human_count rejected_count stats total_pending auto_selectable deferred_broad attempted
  discovered_count="$(jq 'length' "$DISCOVERED_TASKS_FILE" 2>/dev/null || printf '0\n')"
  completed_count="$(count_terminal_records completed)"
  needs_human_count="$(count_terminal_records 'needs_human')"
  rejected_count="$(count_terminal_records rejected)"
  stats="$(pending_task_stats)"
  total_pending="$(jq -r '.total' <<<"$stats")"
  auto_selectable="$(jq -r '.auto_selectable' <<<"$stats")"
  deferred_broad="$(jq -r '.deferred_broad' <<<"$stats")"
  attempted="$(jq -r '.attempted' <<<"$stats")"
  log "queue discovered=${discovered_count} completed=${completed_count} needs-human=${needs_human_count} rejected=${rejected_count} pending=${total_pending} auto=${auto_selectable} deferred-broad=${deferred_broad} attempted-this-run=${attempted}"
}

run_iteration() {
  local task_json="$1"
  local task_id task_file classification commit_sha run_id
  task_id="$(jq -r '.id' <<<"$task_json")"
  log "selected task: $task_id"
  ATTEMPTED_TASK_IDS+=("$task_id")
  task_file="$(write_task_file "$task_json")"
  prepare_iteration_paths "$task_id"
  run_id="$ITERATION_SLUG"
  build_handoff_bundle "$task_id"

  create_worker_worktree "$ITERATION_BRANCH" "$ITERATION_WORKTREE"
  runtime_start_run "$(
    jq -nc \
      --arg run_id "$run_id" \
      --arg task_id "$task_id" \
      --arg branch "$ITERATION_BRANCH" \
      --arg worktree "$ITERATION_WORKTREE" \
      --arg status "running" \
      --arg started_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{
        run:{run_id:$run_id, task_id:$task_id, branch:$branch, worktree:$worktree, status:$status, started_at:$started_at},
        event:{
          event_id:"\($run_id):run-started",
          task_id:$task_id,
          event_type:"run_started",
          ts:$started_at,
          actor:"coordinator",
          run_id:$run_id,
          payload:{branch:$branch, worktree:$worktree}
        }
      }'
  )"
  if ! bash "$ROOT_DIR/scripts/codex-auto-worker.sh" \
    --task-id "$task_id" \
    --task-file "$task_file" \
    --handoff-bundle "$ITERATION_HANDOFF_DIR" \
    --worktree "$ITERATION_WORKTREE" \
    --branch "$ITERATION_BRANCH" \
    --log-file "$ITERATION_LOG" \
    --summary-path "$ITERATION_SUMMARY"
  then
    log "worker failed"
    runtime_fail_run "$(
      jq -nc \
        --arg run_id "$run_id" \
        --arg status "failed" \
        --arg finished_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg task_id "$task_id" \
        --arg branch "$ITERATION_BRANCH" \
        --arg worktree "$ITERATION_WORKTREE" \
        '{
          runId:$run_id,
          status:$status,
          finishedAt:$finished_at,
          event:{
            event_id:"\($run_id):run-failed",
            task_id:$task_id,
            event_type:"run_failed",
            ts:$finished_at,
            actor:"coordinator",
            run_id:$run_id,
            payload:{branch:$branch, worktree:$worktree}
          }
        }'
    )"
    cleanup_worker_worktree "$ITERATION_WORKTREE"
    return 1
  fi

  classification="$(classify_summary "$ITERATION_SUMMARY")"
  classification="$(normalize_classification "$ITERATION_SUMMARY" "$classification")"
  commit_sha="$(extract_commit_sha "$ITERATION_SUMMARY")"
  log "classification=${classification}"

  case "$classification" in
    needs-human)
      if ! summary_has_needs_human_proof "$ITERATION_SUMMARY" "$task_json" "$ITERATION_LOG"; then
        log "needs-human without coordinator proof is rejected by the coordinator"
        record_result "$task_id" "$classification" "$ITERATION_BRANCH" "$ITERATION_SUMMARY" "$commit_sha" false false "$run_id"
        apply_task_transition "$task_id" "rejected" "task_rejected" "$run_id" "" "$ITERATION_SUMMARY"
        cleanup_worker_worktree "$ITERATION_WORKTREE"
        return 1
      fi
      record_result "$task_id" "$classification" "$ITERATION_BRANCH" "$ITERATION_SUMMARY" "$commit_sha" true false "$run_id"
      apply_task_transition "$task_id" "needs_human" "task_needs_human" "$run_id" "" "$ITERATION_SUMMARY"
      cleanup_worker_worktree "$ITERATION_WORKTREE"
      return 0
      ;;
    unknown)
      log "unknown worker outcome is non-terminal; leaving task pending"
      record_result "$task_id" "$classification" "$ITERATION_BRANCH" "$ITERATION_SUMMARY" "$commit_sha" false false "$run_id"
      cleanup_worker_worktree "$ITERATION_WORKTREE"
      return 1
      ;;
    jess-bug|rebaseline)
      if [[ "$classification" == "jess-bug" ]] && ! summary_has_jess_bug_proof "$ITERATION_SUMMARY" "$task_json" "$ITERATION_LOG"; then
        log "jess-bug without coordinator proof is non-terminal; leaving task pending"
        record_result "$task_id" "$classification" "$ITERATION_BRANCH" "$ITERATION_SUMMARY" "$commit_sha" false false "$run_id"
        cleanup_worker_worktree "$ITERATION_WORKTREE"
        return 1
      fi
      if [[ "$classification" == "rebaseline" ]] && ! summary_has_rebaseline_proof "$ITERATION_SUMMARY" "$task_json" "$ITERATION_LOG"; then
        log "rebaseline without coordinator proof is non-terminal; leaving task pending"
        record_result "$task_id" "$classification" "$ITERATION_BRANCH" "$ITERATION_SUMMARY" "$commit_sha" false false "$run_id"
        cleanup_worker_worktree "$ITERATION_WORKTREE"
        return 1
      fi
      promote_worker_branch "$ITERATION_BRANCH"
      record_result "$task_id" "$classification" "$ITERATION_BRANCH" "$ITERATION_SUMMARY" "$commit_sha" true true "$run_id"
      apply_task_transition "$task_id" "completed" "task_completed" "$run_id" "$commit_sha" "$ITERATION_SUMMARY"
      cleanup_worker_worktree "$ITERATION_WORKTREE"
      return 0
      ;;
    *)
      record_result "$task_id" "$classification" "$ITERATION_BRANCH" "$ITERATION_SUMMARY" "$commit_sha" false false "$run_id"
      cleanup_worker_worktree "$ITERATION_WORKTREE"
      return 1
      ;;
  esac
}

print_status() {
  local stats discovered_count completed_count needs_human_count rejected_count total_pending auto_selectable deferred_broad attempted next_task
  discover_tasks
  stats="$(pending_task_stats)"
  discovered_count="$(jq 'length' "$DISCOVERED_TASKS_FILE" 2>/dev/null || printf '0\n')"
  completed_count="$(count_terminal_records completed)"
  needs_human_count="$(count_terminal_records 'needs_human')"
  rejected_count="$(count_terminal_records rejected)"
  total_pending="$(jq -r '.total' <<<"$stats")"
  auto_selectable="$(jq -r '.auto_selectable' <<<"$stats")"
  deferred_broad="$(jq -r '.deferred_broad' <<<"$stats")"
  attempted="$(jq -r '.attempted' <<<"$stats")"
  next_task="$(select_next_task || true)"

  printf 'codex-auto status\n'
  printf '  discovered: %s\n' "$discovered_count"
  printf '  completed: %s\n' "$completed_count"
  printf '  needs-human: %s\n' "$needs_human_count"
  printf '  rejected: %s\n' "$rejected_count"
  printf '  pending: %s\n' "$total_pending"
  printf '  auto-selectable: %s\n' "$auto_selectable"
  printf '  deferred-broad: %s\n' "$deferred_broad"
  printf '  attempted-this-run: %s\n' "$attempted"
  if [[ -n "$next_task" ]]; then
    printf '  next-task: %s\n' "$(jq -r '.id' <<<"$next_task")"
  else
    printf '  next-task: none\n'
  fi
}

main() {
  local iteration=0 failures=0 task_json stats total_pending deferred_broad
  init_state
  sync_remote

  if (( STATUS_ONLY == 1 )); then
    print_status
    return 0
  fi

  ensure_automation_branch

  while :; do
    iteration=$((iteration + 1))
    log "iteration=${iteration}"

    run_all_less_snapshot || true
    discover_tasks
    log_queue_snapshot

    task_json="$(select_next_task || true)"
    if [[ -z "$task_json" ]]; then
      stats="$(pending_task_stats)"
      total_pending="$(jq -r '.total' <<<"$stats")"
      deferred_broad="$(jq -r '.deferred_broad' <<<"$stats")"
      if (( total_pending == 0 )); then
        log "no remaining tasks under current accepted state; stopping"
      elif (( deferred_broad > 0 )); then
        log "only deferred broad architectural tasks remain; use --task-id or manual pin to work one"
      else
        log "no auto-selectable tasks remain under current accepted state; stopping"
      fi
      break
    fi

    if run_iteration "$task_json"; then
      failures=0
    else
      failures=$((failures + 1))
      log "consecutive_failures=${failures}"
      if (( failures >= MAX_FAILURES )); then
        log "hit failure threshold; stopping"
        break
      fi
    fi

    if (( RUN_ONCE == 1 )); then
      log "once mode complete"
      break
    fi
    if (( MAX_ITERATIONS > 0 && iteration >= MAX_ITERATIONS )); then
      log "max iterations reached"
      break
    fi
  done
}

main
