# Codex Auto Loop Design

Date: `2026-04-19`
Status: Draft

## Goal

Create a repo-local automation loop for Codex CLI that repeatedly:

1. selects the next smallest high-value task from the registry redesign docs and current Less parity failures
2. runs one isolated worker iteration in a fresh worktree
3. classifies the outcome as a Jess fix, a Less.js fixture rebaseline, or a human-review stop
4. verifies the slice, updates tracking docs, commits, and pushes
5. integrates the worker result onto a shared automation branch
6. repeats until the task docs are exhausted and `all-less` is green, or only human-review tasks remain

This loop is intended to automate deterministic backlog recovery work, not open-ended experimentation.

## Non-Goals

- Multi-worker concurrency in v1
- Automatic force-push or history rewriting on shared branches
- Fully autonomous semantic decisions when repo intent is unclear
- Replacing the human-led `dev` branch workflow

## Constraints

- `dev` remains the human-led branch
- automation work must happen on a dedicated integration branch
- each worker iteration handles one coherent slice only
- workers run in fresh worktrees
- the system must distinguish:
  - real Jess bugs
  - outdated Less.js 4.x expectations
  - intentional Jess behavior that should be rebaselined in Less.js alpha
  - ambiguous cases requiring human review
- if an `all-less` failure is believed to be a real runtime/parser/serializer bug, it must first be reduced into focused lower-level coverage before broad fixes are accepted
- Less.js fixture updates must keep the relevant branches aligned, not just local working trees

## Branch Model

### Stable Branches

- `dev`
  - human-led Jess integration branch
- `codex/auto-less-recovery`
  - rolling automation integration branch

### Worker Branches

Workers create ephemeral branches from the current tip of `origin/codex/auto-less-recovery`:

- `codex/auto-less-recovery/<task-id>-<timestamp>`

Workers never push directly to `dev`.

## High-Level Architecture

The automation system has two roles:

### 1. Coordinator

The coordinator owns:

- task discovery
- task leasing
- worktree creation
- worker invocation via `codex exec`
- candidate integration onto the shared automation branch
- retry / rejection / escalation handling

The coordinator is the only actor allowed to advance `codex/auto-less-recovery`.

### 2. Worker

Each worker is a one-shot Codex CLI run in a fresh worktree. It is responsible for:

- solving one task only
- following the repo’s classification policy
- updating docs/task tracking
- running the required verification
- committing and pushing its candidate branch

## Control Flow

### Bootstrap

1. Ensure the main repo is on `dev` with no unsafe branch mismatch.
2. Commit/push current human-directed work before starting the loop.
3. Ensure `codex/auto-less-recovery` exists on remote, branching from the desired starting point.

### Per-Iteration Loop

1. Fetch:
   - `origin/dev`
   - `origin/codex/auto-less-recovery`
2. Read task sources:
   - `docs/future/performance/2026-04-13-registry-redesign-handoff.md`
   - `docs/future/performance/2026-04-13-registry-redesign-proposal.md`
3. Discover current outer failures from the `all-less` command output.
4. Build a candidate task queue.
5. Select one task using fixed priority rules.
6. Create a fresh worktree from `origin/codex/auto-less-recovery`.
7. Create a worker branch for that task.
8. Invoke `codex exec` with:
   - the task description
   - the classification policy
   - required verification commands
   - required tracking-doc update rules
9. Wait for worker completion.
10. Fetch the worker branch.
11. Rebase or merge the worker result onto the latest `origin/codex/auto-less-recovery`.
12. Rerun promotion verification.
13. If green:
   - fast-forward the shared automation branch
   - push `codex/auto-less-recovery`
14. Archive logs/state and start the next iteration.

### Stop Conditions

Stop the loop when any of these is true:

- all explicit handoff/proposal items are resolved and `all-less` is green
- the remaining queue contains only `needs-human` items
- repeated worker or integration failures exceed a configured threshold
- repo/branch state is no longer safe to continue automatically

## Task Discovery

The coordinator should pull tasks from three sources:

### 1. Registry Redesign Docs

Extract open items from:

- `2026-04-13-registry-redesign-handoff.md`
- `2026-04-13-registry-redesign-proposal.md`

This does not need perfect natural-language parsing in v1. A simple heuristic is acceptable:

- treat bullets under open buckets as candidate tasks
- allow a small manual override file for pinned priorities

### 2. Current `all-less` Failures

Collect current red fixtures and group them by likely bucket:

- semantic runtime/parser/serializer regressions
- formatting/trivia drift
- fixture drift
- warning/deprecation contract drift

### 3. Manual Overrides

Allow an override file for:

- pinned-next task
- skipped tasks
- known human-review blockers

## Classification Policy

Each worker must classify the task outcome into exactly one of these:

### A. Real Jess Bug

Use this when the observed behavior:

- contradicts existing Jess design intent
- contradicts focused lower-level tests
- or is not semantically acceptable under the current runtime/serialization contract

Required action:

- reproduce in focused lower-level coverage first when applicable
- fix Jess
- keep Less.js expectations unchanged unless additional intentional drift is also discovered

### B. Outdated Less.js 4.x Expectation / Intentional Jess Rebaseline

Use this when the output differs from old Less.js expectations, but the Jess behavior is:

1. semantically equivalent, or
2. more internally consistent, or
3. closer to current dev expectations

Required action:

- do not “fix” Jess just to match old Less.js output
- update the linked Less.js alpha fixture
- preserve old output in `legacy/` where that workflow is already used on the Less.js side
- keep the relevant Less.js branches synchronized

### C. Needs Human Review

Use this when:

- repo intent is ambiguous
- docs and tests disagree materially
- the change would commit Jess to a non-obvious semantic contract
- the required fix is too broad for a safe one-slice worker task

Required action:

- do not guess
- update tracking with the ambiguity
- return the task as blocked

## Verification Policy

Each worker must verify in this order:

1. smallest focused repro
2. affected package test/build
3. relevant outer Less fixture proof
4. broader integration check if the slice touches shared serializer/runtime seams

The coordinator must rerun promotion verification after integrating the worker branch onto the latest automation branch.

## Required Tracking Updates

Each accepted worker iteration must update the relevant tracking docs:

- handoff doc for status/narrowed remainder
- proposal doc only if the architectural plan or decision record changed

The worker should record:

- what was fixed
- what was rebaselined
- what remains
- whether the result was classified as a real bug fix or a fixture-alignment decision

## Suggested Repo Files

### Checked-In

- `scripts/codex-auto-loop.sh`
  - coordinator entrypoint
- `scripts/codex-auto-worker.sh`
  - worker wrapper around `codex exec`
- `config/codex-auto-policy.json`
  - branch names, commands, retry thresholds, task rules
- `docs/future/performance/codex-auto-loop.md`
  - operator guide

### Ignored Runtime State

- `state/codex-auto/leases/`
- `state/codex-auto/logs/`
- `state/codex-auto/results/`
- `state/codex-auto/needs-human.json`

## Implementation Notes

### Coordinator Simplicity

Use a shell-based coordinator in v1. It should:

- stay easy to audit
- use plain git and `codex exec`
- store minimal structured state in JSON files

Do not overbuild a framework before the loop proves useful.

### Worker Prompt Discipline

The worker prompt should explicitly require:

- one task only
- no speculative broad rewrites
- bug-vs-fixture classification
- lower-level repro before core/runtime fixes when appropriate
- tracking doc updates
- commit and push only if the slice is clean

### Fresh Worktrees

Never reuse a dirty worktree for the next iteration. A fresh worktree per task is part of the safety model.

### No Direct Shared-Branch Pushes From Workers

Workers push only their candidate branches. The coordinator alone updates `codex/auto-less-recovery`.

## Risks

### 1. Wrong Automatic Classification

Mitigation:

- keep policy explicit
- prefer `needs-human` over guessing
- record rationale in tracking docs

### 2. Automation Branch Drift

Mitigation:

- coordinator always integrates against latest remote automation branch
- promotion verification runs after integration, not just in the worker branch

### 3. Worktree / Branch Leaks

Mitigation:

- deterministic naming
- explicit cleanup
- retained logs for failed iterations

### 4. Overfitting To Current Handoff Wording

Mitigation:

- keep discovery heuristics simple
- allow manual overrides
- treat docs as guidance plus current queue input, not a perfect parser source

## Recommended v1 Scope

Version 1 should be sequential:

- exactly one worker at a time
- one task per iteration
- one coordinator process

Parallel workers can come later, but only after the single-worker coordinator proves stable.

## Success Criteria

The system is successful when it can:

- repeatedly take one next task from the registry-redesign and Less-parity backlog
- make a correct bug-vs-fixture-vs-human classification
- land clean verified slices onto `codex/auto-less-recovery`
- keep Less.js fixture state aligned when rebaselines are intentional
- reduce the backlog without requiring manual orchestration each iteration
