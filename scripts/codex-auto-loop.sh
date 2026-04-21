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
WORKER_BRANCH_PREFIX="$(jq -r '.worker_branch_prefix' "$POLICY_FILE")"
WORKTREE_ROOT="$(expand_path "$(jq -r '.worktree_root' "$POLICY_FILE")")"
STATE_ROOT="$ROOT_DIR/$(jq -r '.state_root' "$POLICY_FILE")"
RUNTIME_DB="$ROOT_DIR/$(jq -r '.runtime_db' "$POLICY_FILE")"
MAX_FAILURES="$(jq -r '.max_failures' "$POLICY_FILE")"
MANUAL_OVERRIDE_FILE="$ROOT_DIR/$(jq -r '.manual_override_file' "$POLICY_FILE")"
ALL_LESS_CMD="$(jq -r '.commands.all_less' "$POLICY_FILE")"
CORE_BUILD_CMD="$(jq -r '.commands.core_build' "$POLICY_FILE")"
JESS_BUILD_CMD="$(jq -r '.commands.jess_build' "$POLICY_FILE")"
TASK_SOURCES=()
while IFS= read -r line; do
  TASK_SOURCES+=("$line")
done < <(jq -r '.task_sources[]' "$POLICY_FILE")

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
COMPLETED_FILE="$STATE_ROOT/completed.jsonl"
NEEDS_HUMAN_FILE="$STATE_ROOT/needs-human.jsonl"
REJECTED_FILE="$STATE_ROOT/rejected.jsonl"

CURRENT_STATE_VERSION=2

runtime_state_exec() {
  local action="$1"
  local payload_json="${2:-{}}"
  ACTION="$action" \
    PAYLOAD_JSON="$payload_json" \
    RUNTIME_DB="$RUNTIME_DB" \
    COMPLETED_FILE="$COMPLETED_FILE" \
    NEEDS_HUMAN_FILE="$NEEDS_HUMAN_FILE" \
    REJECTED_FILE="$REJECTED_FILE" \
    DISCOVERED_TASKS_FILE="$DISCOVERED_TASKS_FILE" \
    node --input-type=module - <<EOF
import { readFileSync } from 'node:fs';
import { createRuntimeState } from '${ROOT_DIR}/scripts/task-runtime/runtime-state.mjs';

const action = process.env.ACTION;
const payload = process.env.PAYLOAD_JSON ? JSON.parse(process.env.PAYLOAD_JSON) : {};
const state = createRuntimeState(process.env.RUNTIME_DB, action === 'init'
  ? {
      legacyJsonl: {
        completedFile: process.env.COMPLETED_FILE,
        needsHumanFile: process.env.NEEDS_HUMAN_FILE,
        rejectedFile: process.env.REJECTED_FILE,
      },
    }
  : {});

try {
  switch (action) {
    case 'init':
      break;
    case 'task-status':
      process.stdout.write(state.getTaskStatus(payload.task_id));
      break;
    case 'count-status': {
      const tasks = JSON.parse(readFileSync(process.env.DISCOVERED_TASKS_FILE, 'utf8'));
      let count = 0;
      for (const task of tasks) {
        if (state.getTaskStatus(task.id) === payload.status) {
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
      throw new Error(`Unknown runtime-state action: ${action}`);
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

init_state() {
  mkdir -p "$LEASES_DIR" "$LOGS_DIR" "$RESULTS_DIR" "$RUNS_DIR" "$TASKS_DIR" "$WORKTREE_ROOT"
  runtime_init
  if [[ ! -f "$MANUAL_OVERRIDE_FILE" ]]; then
    printf '{\"queue\":[],\"skip\":[],\"pin\":null}\n' > "$MANUAL_OVERRIDE_FILE"
  fi
}

sync_remote() {
  log "fetching origin branches"
  git -C "$ROOT_DIR" fetch origin "$STABLE_BRANCH" "$AUTOMATION_BRANCH" >/dev/null 2>&1 || true
}

ensure_automation_branch() {
  if ! git -C "$ROOT_DIR" ls-remote --exit-code --heads origin "$AUTOMATION_BRANCH" >/dev/null 2>&1; then
    log "creating automation branch from origin/${STABLE_BRANCH}"
    git -C "$ROOT_DIR" push origin "origin/$STABLE_BRANCH:refs/heads/$AUTOMATION_BRANCH"
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

discover_doc_tasks() {
  local source line text id
  for source in "${TASK_SOURCES[@]}"; do
    [[ -f "$ROOT_DIR/$source" ]] || continue
    while IFS=: read -r line text; do
      text="$(printf '%s' "$text" | sed -E 's/^[[:space:]-]+//')"
      [[ -n "$text" ]] || continue
      id="doc:$(slugify "${source}-${line}-${text}")"
      jq -nc \
        --arg id "$id" \
        --arg kind "doc" \
        --arg source "$source" \
        --arg line "$line" \
        --arg summary "$text" \
        '{id:$id, kind:$kind, source:$source, line:($line|tonumber), summary:$summary}'
    done < <(numbered_matches 'tests-unit/[^`[:space:]]+\.less|^[[:space:]]*[1-4]\.[[:space:]]+\*\*Track|serializer backtracking / buffered render|clone / copy / materialization pressure|remaining generic registry/query overhead' "$ROOT_DIR/$source")
  done
}

discover_all_less_tasks() {
  [[ -f "$LAST_ALL_LESS_FILE" ]] || return 0
  python3 - "$LAST_ALL_LESS_FILE" <<'PY' | sort -u | while read -r fixture; do
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(errors="ignore")
text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
text = re.sub(r'\x1b\][^\x07]*(?:\x07|\x1b\\\\)', '', text)

for match in re.findall(r'tests-unit/[^"\s]+\.less', text):
    print(match.split("\x1b", 1)[0])
PY
    [[ -n "$fixture" ]] || continue
    jq -nc \
      --arg id "less:$fixture" \
      --arg kind "less-fixture" \
      --arg source "all-less" \
      --arg summary "$fixture" \
      '{id:$id, kind:$kind, source:$source, summary:$summary}'
  done
}

discover_tasks() {
  {
    discover_doc_tasks
    discover_all_less_tasks
  } | jq -s 'unique_by(.id)' > "$DISCOVERED_TASKS_FILE"
}

has_terminal_record() {
  local _source="$1"
  local id="$2"
  [[ "$(runtime_task_status "$id")" != "open" ]]
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
  local kind summary
  kind="$(jq -r '.kind // ""' <<<"$task_json")"
  summary="$(jq -r '.summary // ""' <<<"$task_json")"

  case "$kind" in
    less-fixture)
      return 0
      ;;
    doc)
      [[ "$summary" == *'tests-unit/'*'.less'* ]]
      return
      ;;
    *)
      return 0
      ;;
  esac
}

pending_task_stats() {
  local item id total=0 auto_selectable=0 deferred_broad=0 attempted=0
  while read -r item; do
    id="$(jq -r '.id' <<<"$item")"
    if has_terminal_record "$COMPLETED_FILE" "$id"; then
      continue
    fi
    if has_terminal_record "$NEEDS_HUMAN_FILE" "$id"; then
      continue
    fi
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
    jq -nc --arg id "$FORCED_TASK_ID" '{id:$id, kind:"forced", source:"cli", summary:$id}'
    return 0
  fi

  pin="$(jq -r '.pin // empty' "$MANUAL_OVERRIDE_FILE")"
  if [[ -n "$pin" ]]; then
    jq -nc --arg id "$pin" '{id:$id, kind:"manual", source:"override", summary:$id}'
    return 0
  fi

  queue_item="$(jq -r '.queue[0] // empty' "$MANUAL_OVERRIDE_FILE")"
  if [[ -n "$queue_item" ]]; then
    jq -nc --arg id "$queue_item" '{id:$id, kind:"manual", source:"override-queue", summary:$id}'
    return 0
  fi

  local found=""
  while IFS=$'\t' read -r priority item; do
    id="$(jq -r '.id' <<<"$item")"
    if has_terminal_record "$COMPLETED_FILE" "$id"; then
      continue
    fi
    if has_terminal_record "$NEEDS_HUMAN_FILE" "$id"; then
      continue
    fi
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
  if is_auto_selectable_task "$task_json"; then
    if [[ "$(jq -r '.kind // ""' <<<"$task_json")" == "less-fixture" ]]; then
      printf '10\n'
    elif [[ "$(jq -r '.kind // ""' <<<"$task_json")" == "doc" ]]; then
      printf '20\n'
    else
      printf '50\n'
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
  ITERATION_LOG="$LOGS_DIR/$ITERATION_SLUG.log"
  ITERATION_SUMMARY="$ITERATION_RUN_DIR/summary.json"
  mkdir -p "$ITERATION_RUN_DIR"
}

create_worker_worktree() {
  local branch="$1"
  local worktree="$2"
  log "creating worker worktree: $worktree"
  git -C "$ROOT_DIR" worktree add "$worktree" -b "$branch" "origin/$AUTOMATION_BRANCH" >/dev/null
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

summary_field_value() {
  local label="$1"
  local summary_file="$2"
  awk -F': ' -v key="$label" '$1 == key {print substr($0, length(key) + 3)}' "$summary_file" | head -n 1
}

summary_has_rebaseline_proof() {
  local summary_file="$1"
  local fixture_paths fixture_diff related_behavior doc_support focused_proof reason
  fixture_paths="$(summary_field_value '  - Fixture path(s)' "$summary_file")"
  fixture_diff="$(summary_field_value '  - Fixture differs on disk' "$summary_file")"
  related_behavior="$(summary_field_value '  - Related Jess behavior' "$summary_file")"
  doc_support="$(summary_field_value '  - Governing doc support' "$summary_file")"
  focused_proof="$(summary_field_value '  - Focused proof' "$summary_file")"
  reason="$(summary_field_value '  - Reason' "$summary_file")"

  [[ -n "$fixture_paths" && "$fixture_paths" != "none" ]] || return 1
  [[ "$fixture_diff" == "yes" ]] || return 1
  [[ -n "$related_behavior" && "$related_behavior" != "none" ]] || return 1
  [[ -n "$doc_support" && "$doc_support" != "none" ]] || return 1
  [[ -n "$focused_proof" ]] || return 1
  [[ -n "$reason" ]] || return 1

  file_contains_regex 'docs/(future/performance|superpowers/specs|superpowers/plans)/' "$summary_file"
}

summary_has_jess_bug_proof() {
  local summary_file="$1"
  local related_behavior doc_support focused_proof reason verification_run commit_sha
  related_behavior="$(summary_field_value '  - Related Jess behavior' "$summary_file")"
  doc_support="$(summary_field_value '  - Governing doc support' "$summary_file")"
  focused_proof="$(summary_field_value '  - Focused proof' "$summary_file")"
  reason="$(summary_field_value '  - Reason' "$summary_file")"
  verification_run="$(summary_field_value 'Verification run' "$summary_file")"
  commit_sha="$(summary_field_value 'Commit sha' "$summary_file")"

  [[ -n "$related_behavior" && "$related_behavior" != "none" ]] || return 1
  [[ -n "$doc_support" && "$doc_support" != "none" ]] || return 1
  [[ -n "$focused_proof" && "$focused_proof" != "none" ]] || return 1
  [[ -n "$reason" ]] || return 1
  [[ -n "$verification_run" && "$verification_run" != "none" ]] || return 1
  [[ -n "$commit_sha" && "$commit_sha" != "none" ]] || return 1
}

summary_has_needs_human_proof() {
  local summary_file="$1"
  local related_behavior doc_support focused_proof reason verification_run
  related_behavior="$(summary_field_value '  - Related Jess behavior' "$summary_file")"
  doc_support="$(summary_field_value '  - Governing doc support' "$summary_file")"
  focused_proof="$(summary_field_value '  - Focused proof' "$summary_file")"
  reason="$(summary_field_value '  - Reason' "$summary_file")"
  verification_run="$(summary_field_value 'Verification run' "$summary_file")"

  [[ -n "$doc_support" && "$doc_support" != "none" ]] || return 1
  [[ -n "$focused_proof" && "$focused_proof" != "none" ]] || return 1
  [[ -n "$reason" ]] || return 1
  [[ -n "$verification_run" && "$verification_run" != "none" ]] || return 1
  [[ -n "$related_behavior" ]] || return 1
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
  git -C "$ROOT_DIR" worktree add --detach "$integration_worktree" "origin/$AUTOMATION_BRANCH" >/dev/null
  git -C "$integration_worktree" merge --ff-only "$branch" >/dev/null
  eval "cd \"$integration_worktree\" && $CORE_BUILD_CMD" >/dev/null
  eval "cd \"$integration_worktree\" && $JESS_BUILD_CMD" >/dev/null
  git -C "$integration_worktree" push origin "HEAD:refs/heads/$AUTOMATION_BRANCH" >/dev/null
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

  if [[ "$classification" == "jess-bug" || "$classification" == "rebaseline" ]]; then
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
      --arg terminal_event_type "$terminal_event_type" \
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
        terminalEvent:(if $terminal_event_type == "" then null else {
          event_id:"\($run_id):terminal",
          task_id:$task_id,
          event_type:$terminal_event_type,
          ts:$created_at,
          actor:"coordinator",
          run_id:$run_id,
          payload:{
            classification:$classification,
            branch:$branch,
            candidate_commit:(if $candidate_commit == "" then null else $candidate_commit end),
            summary:$summary
          }
        } end),
        runStatus:$run_status,
        finishedAt:$created_at
      }'
  )"
}

log_queue_snapshot() {
  local discovered_count completed_count needs_human_count rejected_count stats total_pending auto_selectable deferred_broad attempted
  discovered_count="$(jq 'length' "$DISCOVERED_TASKS_FILE" 2>/dev/null || printf '0\n')"
  completed_count="$(count_terminal_records completed)"
  needs_human_count="$(count_terminal_records 'needs-human')"
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
      if ! summary_has_needs_human_proof "$ITERATION_SUMMARY"; then
        log "needs-human without coordinator proof is non-terminal; leaving task pending"
        record_result "$task_id" "$classification" "$ITERATION_BRANCH" "$ITERATION_SUMMARY" "$commit_sha" false false "$run_id"
        cleanup_worker_worktree "$ITERATION_WORKTREE"
        return 1
      fi
      record_result "$task_id" "$classification" "$ITERATION_BRANCH" "$ITERATION_SUMMARY" "$commit_sha" true false "$run_id"
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
      promote_worker_branch "$ITERATION_BRANCH"
      record_result "$task_id" "$classification" "$ITERATION_BRANCH" "$ITERATION_SUMMARY" "$commit_sha" true true "$run_id"
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
  needs_human_count="$(count_terminal_records 'needs-human')"
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
  ensure_automation_branch

  if (( STATUS_ONLY == 1 )); then
    print_status
    return 0
  fi

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
