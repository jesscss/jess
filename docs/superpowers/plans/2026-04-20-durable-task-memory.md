# Durable Task And Memory System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile handoff/JSONL auto-loop state model with a durable monorepo task system built from checked-in task snapshots, coordinator-controlled state transitions, and a local SQLite runtime store.

**Architecture:** Keep stable specs/docs as architectural intent, add a checked-in canonical task registry with one file per task, and introduce a local SQLite runtime database for leases, runs, submissions, and event ingestion. The coordinator becomes the only writer of authoritative task state, workers emit machine-readable candidate artifacts, and operator commands steer the same system through validated transitions.

**Tech Stack:** Bash, Node.js, SQLite, JSON task artifacts, existing Codex CLI scripts, repo docs under `docs/superpowers/` and `docs/tasks/`

---

### Task 1: Define checked-in task schema, repository layout, and onboarding doc

**Files:**
- Create: `docs/tasks/README.md`
- Create: `tasks/README.md`
- Create: `tasks/schema/task.schema.json`
- Create: `tasks/schema/event.schema.json`
- Create: `tasks/index.json`
- Create: `tasks/less-registry/README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing test**

Use file-structure checks as the first failing proof:

```bash
test -f docs/tasks/README.md
test -f tasks/schema/task.schema.json
test -f tasks/index.json
```

Expected: non-zero exit status before implementation because the files do not exist.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
test -f docs/tasks/README.md
```

Expected: non-zero exit status.

- [ ] **Step 3: Write minimal implementation**

Create `docs/tasks/README.md` with:

```md
# Task System

This directory documents the durable task and execution-memory system for the Jess monorepo.

## Source Of Truth

- Stable specs/docs define architectural intent.
- `tasks/` holds canonical current task snapshots.
- The local runtime database stores leases, runs, submissions, and event-ingestion state.

## Read Order For Agents

1. `AGENTS.md`
2. Relevant stable spec/design docs
3. `docs/tasks/README.md`
4. The assigned task file under `tasks/`
5. Generated task handoff bundle from the coordinator

## Write Rules

- Workers may not directly update canonical task files.
- Workers may not directly update the runtime database.
- The coordinator is the only authoritative writer for task-state transitions.

## Operator Commands

Operator commands should target the task system itself, not bypass it with ad hoc file edits.
```

Create `tasks/README.md` with:

```md
# Canonical Task Registry

This directory contains canonical checked-in task snapshots for active monorepo work.

Each task file is the authoritative current-state snapshot for one task.
History is tracked separately through the runtime event system and recorded back onto the task snapshot via accepted transition references.
```

Create `tasks/schema/task.schema.json` with:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://jesscss.local/tasks/task.schema.json",
  "title": "Jess Task Snapshot",
  "type": "object",
  "required": [
    "id",
    "title",
    "track",
    "bucket",
    "priority",
    "status",
    "source_refs",
    "goal_refs",
    "definition_of_done",
    "proof_expectations",
    "accepted_commit",
    "accepted_run_id",
    "last_transition_event_id"
  ],
  "properties": {
    "id": { "type": "string" },
    "title": { "type": "string" },
    "track": { "type": "string" },
    "bucket": { "type": "string" },
    "priority": {
      "type": "string",
      "enum": ["p0", "p1", "p2", "p3"]
    },
    "status": {
      "type": "string",
      "enum": [
        "open",
        "leased",
        "in_progress",
        "awaiting_review",
        "completed",
        "needs_human",
        "rejected",
        "superseded"
      ]
    },
    "source_refs": {
      "type": "array",
      "items": { "type": "string" }
    },
    "goal_refs": {
      "type": "array",
      "items": { "type": "string" }
    },
    "depends_on": {
      "type": "array",
      "items": { "type": "string" },
      "default": []
    },
    "blocked_by": {
      "type": "array",
      "items": { "type": "string" },
      "default": []
    },
    "definition_of_done": { "type": "string" },
    "proof_expectations": {
      "type": "array",
      "items": { "type": "string" }
    },
    "accepted_commit": {
      "type": ["string", "null"]
    },
    "accepted_run_id": {
      "type": ["string", "null"]
    },
    "last_transition_event_id": {
      "type": ["string", "null"]
    }
  },
  "additionalProperties": true
}
```

Create `tasks/schema/event.schema.json` with:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://jesscss.local/tasks/event.schema.json",
  "title": "Jess Task Event",
  "type": "object",
  "required": [
    "event_id",
    "task_id",
    "event_type",
    "ts",
    "actor",
    "run_id"
  ],
  "properties": {
    "event_id": { "type": "string" },
    "task_id": { "type": "string" },
    "event_type": { "type": "string" },
    "ts": { "type": "string" },
    "actor": { "type": "string" },
    "run_id": {
      "type": ["string", "null"]
    },
    "payload": {
      "type": "object",
      "default": {}
    }
  },
  "additionalProperties": true
}
```

Create `tasks/index.json` with:

```json
{
  "version": 1,
  "tracks": [
    {
      "id": "less-registry-redesign",
      "title": "Less parity / registry redesign recovery",
      "task_dir": "tasks/less-registry"
    }
  ]
}
```

Create `tasks/less-registry/README.md` with:

```md
# Less / Registry Redesign Tasks

This directory holds the bootstrap canonical tasks for the Less parity and registry-redesign lane.
```

Add to `.gitignore`:

```gitignore
# Durable task runtime state
state/task-runtime/
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
test -f docs/tasks/README.md
test -f tasks/schema/task.schema.json
test -f tasks/schema/event.schema.json
test -f tasks/index.json
git check-ignore -q state/task-runtime/example
```

Expected: all commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add .gitignore docs/tasks/README.md tasks/README.md tasks/schema/task.schema.json tasks/schema/event.schema.json tasks/index.json tasks/less-registry/README.md
git commit -m "feat: add durable task registry scaffolding"
```

### Task 2: Add canonical bootstrap tasks for the Less / registry-redesign lane

**Files:**
- Create: `tasks/less-registry/*.json`
- Modify: `tasks/index.json`

- [ ] **Step 1: Write the failing test**

Create a file-count proof:

```bash
find tasks/less-registry -maxdepth 1 -name '*.json' | wc -l
```

Expected before implementation: `0`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
find tasks/less-registry -maxdepth 1 -name '*.json' | wc -l
```

Expected: `0`.

- [ ] **Step 3: Write minimal implementation**

Create initial canonical task files such as:

`tasks/less-registry/less-at-rules-comments.json`

```json
{
  "id": "less-at-rules-comments",
  "title": "Preserve authored comments in at-rule preludes",
  "track": "less-registry-redesign",
  "bucket": "less-fixture",
  "priority": "p1",
  "status": "open",
  "source_refs": [
    "docs/future/performance/2026-04-13-registry-redesign-proposal.md",
    "packages/jess/test/less/all-less.test.ts"
  ],
  "goal_refs": [
    "docs/superpowers/specs/2026-04-20-durable-task-memory-design.md"
  ],
  "depends_on": [],
  "blocked_by": [],
  "definition_of_done": "Focused proof and targeted outer proof both pass, and accepted evidence is linked.",
  "proof_expectations": [
    "targeted core or parser repro when applicable",
    "targeted less fixture proof",
    "promotion verification"
  ],
  "accepted_commit": null,
  "accepted_run_id": null,
  "last_transition_event_id": null
}
```

`tasks/less-registry/less-registry-expansion.json`

```json
{
  "id": "less-registry-expansion",
  "title": "Expand durable task coverage beyond bootstrap Less lane",
  "track": "repo-wide-rollout",
  "bucket": "expansion",
  "priority": "p2",
  "status": "open",
  "source_refs": [
    "docs/superpowers/specs/2026-04-20-durable-task-memory-design.md"
  ],
  "goal_refs": [
    "repo-wide task coverage"
  ],
  "depends_on": [
    "runtime-db-bootstrap"
  ],
  "blocked_by": [],
  "definition_of_done": "At least one non-Less area is migrated into canonical task files, and migration follow-up tasks are recorded.",
  "proof_expectations": [
    "canonical task files created",
    "event history linked",
    "status command shows area"
  ],
  "accepted_commit": null,
  "accepted_run_id": null,
  "last_transition_event_id": null
}
```

`tasks/less-registry/runtime-db-bootstrap.json`

```json
{
  "id": "runtime-db-bootstrap",
  "title": "Bootstrap SQLite runtime store for durable task execution",
  "track": "task-memory-foundation",
  "bucket": "runtime",
  "priority": "p0",
  "status": "open",
  "source_refs": [
    "docs/superpowers/specs/2026-04-20-durable-task-memory-design.md"
  ],
  "goal_refs": [
    "local durable runtime store"
  ],
  "depends_on": [],
  "blocked_by": [],
  "definition_of_done": "SQLite runtime store exists with schema, coordinator can read/write it, and old JSONL-only state is no longer authoritative.",
  "proof_expectations": [
    "schema bootstrap test",
    "runtime query smoke",
    "coordinator state read/write proof"
  ],
  "accepted_commit": null,
  "accepted_run_id": null,
  "last_transition_event_id": null
}
```

Update `tasks/index.json` to include:

```json
{
  "version": 1,
  "tracks": [
    {
      "id": "less-registry-redesign",
      "title": "Less parity / registry redesign recovery",
      "task_dir": "tasks/less-registry"
    },
    {
      "id": "task-memory-foundation",
      "title": "Durable task and memory system foundation",
      "task_dir": "tasks/less-registry"
    },
    {
      "id": "repo-wide-rollout",
      "title": "Repo-wide task-system rollout",
      "task_dir": "tasks/less-registry"
    }
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
find tasks/less-registry -maxdepth 1 -name '*.json' | wc -l
jq -e '.id == "runtime-db-bootstrap"' tasks/less-registry/runtime-db-bootstrap.json
jq -e '.tracks | length >= 3' tasks/index.json
```

Expected: file count is at least `3`, and all `jq` checks succeed.

- [ ] **Step 5: Commit**

```bash
git add tasks/less-registry/*.json tasks/index.json
git commit -m "feat: add bootstrap durable task snapshots"
```

### Task 3: Add runtime SQLite schema and bootstrap tooling

**Files:**
- Create: `scripts/task-runtime/init-db.mjs`
- Create: `scripts/task-runtime/runtime-schema.sql`
- Create: `scripts/task-runtime/lib/db.mjs`
- Modify: `docs/tasks/README.md`

- [ ] **Step 1: Write the failing test**

Use a bootstrap smoke:

```bash
node scripts/task-runtime/init-db.mjs --db /tmp/jess-task-runtime.sqlite
```

Expected before implementation: non-zero exit status because the script does not exist.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node scripts/task-runtime/init-db.mjs --db /tmp/jess-task-runtime.sqlite
```

Expected: non-zero exit status.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/task-runtime/runtime-schema.sql` with:

```sql
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  run_id TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_runtime (
  task_id TEXT PRIMARY KEY,
  lease_owner TEXT,
  lease_expires_at TEXT,
  active_run_id TEXT,
  last_event_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  branch TEXT,
  worktree TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS submissions (
  submission_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  classification TEXT NOT NULL,
  candidate_commit TEXT,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

Create `scripts/task-runtime/lib/db.mjs` with:

```js
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function openRuntimeDb(dbPath) {
  const db = new Database(dbPath);
  const schema = readFileSync(path.resolve(__dirname, '../runtime-schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}
```

Create `scripts/task-runtime/init-db.mjs` with:

```js
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { openRuntimeDb } from './lib/db.mjs';

const args = process.argv.slice(2);
const dbFlag = args.indexOf('--db');

if (dbFlag === -1 || !args[dbFlag + 1]) {
  console.error('Usage: node scripts/task-runtime/init-db.mjs --db <path>');
  process.exit(2);
}

const dbPath = path.resolve(args[dbFlag + 1]);
mkdirSync(path.dirname(dbPath), { recursive: true });
const db = openRuntimeDb(dbPath);
db.prepare('SELECT name FROM sqlite_master WHERE type = ? ORDER BY name').all('table');
db.close();
console.log(dbPath);
```

Append to `docs/tasks/README.md`:

```md
## Runtime Database

The local runtime database is a SQLite file under `state/task-runtime/`.

It is the authoritative source for:
- leases
- runs
- submissions
- event-ingestion bookkeeping

It is not committed to git.
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
rm -f /tmp/jess-task-runtime.sqlite
node scripts/task-runtime/init-db.mjs --db /tmp/jess-task-runtime.sqlite
sqlite3 /tmp/jess-task-runtime.sqlite '.tables'
```

Expected: the database file is created, and `.tables` lists `events`, `runs`, `submissions`, and `task_runtime`.

- [ ] **Step 5: Commit**

```bash
git add scripts/task-runtime/init-db.mjs scripts/task-runtime/runtime-schema.sql scripts/task-runtime/lib/db.mjs docs/tasks/README.md
git commit -m "feat: add runtime database bootstrap"
```

### Task 4: Add machine-readable worker submission format and validator

**Files:**
- Create: `scripts/task-runtime/worker-submission.schema.json`
- Create: `scripts/task-runtime/validate-submission.mjs`
- Modify: `scripts/codex-auto-worker.sh`
- Modify: `docs/tasks/README.md`

- [ ] **Step 1: Write the failing test**

Use validator absence as the first failing proof:

```bash
node scripts/task-runtime/validate-submission.mjs /tmp/missing.json
```

Expected before implementation: non-zero exit status because the validator script does not exist.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node scripts/task-runtime/validate-submission.mjs /tmp/missing.json
```

Expected: non-zero exit status.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/task-runtime/worker-submission.schema.json` with:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": [
    "task_id",
    "classification",
    "reason",
    "files_changed",
    "verification",
    "proof_refs",
    "candidate_commit",
    "candidate_branch",
    "unresolved_concerns"
  ],
  "properties": {
    "task_id": { "type": "string" },
    "classification": {
      "type": "string",
      "enum": ["jess-bug", "rebaseline", "needs-human"]
    },
    "reason": { "type": "string" },
    "files_changed": {
      "type": "array",
      "items": { "type": "string" }
    },
    "verification": {
      "type": "array",
      "items": { "type": "string" }
    },
    "proof_refs": {
      "type": "array",
      "items": { "type": "string" }
    },
    "candidate_commit": {
      "type": ["string", "null"]
    },
    "candidate_branch": {
      "type": ["string", "null"]
    },
    "unresolved_concerns": { "type": "string" }
  },
  "additionalProperties": true
}
```

Create `scripts/task-runtime/validate-submission.mjs` with:

```js
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';

const [file] = process.argv.slice(2);

if (!file) {
  console.error('Usage: node scripts/task-runtime/validate-submission.mjs <file>');
  process.exit(2);
}

const schema = JSON.parse(readFileSync(new URL('./worker-submission.schema.json', import.meta.url)));
const payload = JSON.parse(readFileSync(file, 'utf8'));
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

if (!validate(payload)) {
  console.error(JSON.stringify(validate.errors, null, 2));
  process.exit(1);
}

console.log('ok');
```

Update `scripts/codex-auto-worker.sh` so the prompt requires final output as JSON written to the summary path, with the same schema fields, instead of freeform bullet text.

Append to `docs/tasks/README.md`:

```md
## Worker Submission Contract

Workers must emit machine-readable submission JSON that validates against `scripts/task-runtime/worker-submission.schema.json`.

Freeform summaries are not authoritative.
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cat > /tmp/worker-submission.json <<'EOF'
{
  "task_id": "runtime-db-bootstrap",
  "classification": "needs-human",
  "reason": "Example payload",
  "files_changed": [],
  "verification": ["example"],
  "proof_refs": ["proof"],
  "candidate_commit": null,
  "candidate_branch": null,
  "unresolved_concerns": "none"
}
EOF
node scripts/task-runtime/validate-submission.mjs /tmp/worker-submission.json
```

Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add scripts/task-runtime/worker-submission.schema.json scripts/task-runtime/validate-submission.mjs scripts/codex-auto-worker.sh docs/tasks/README.md
git commit -m "feat: add machine-readable worker submissions"
```

### Task 5: Replace JSONL coordinator state with SQLite-backed runtime state

**Files:**
- Modify: `scripts/codex-auto-loop.sh`
- Modify: `config/codex-auto-policy.json`
- Create: `scripts/task-runtime/runtime-state.mjs`
- Create: `scripts/task-runtime/runtime-state.test.mjs`

- [ ] **Step 1: Write the failing test**

Create a small runtime-state smoke test file:

```js
import assert from 'node:assert/strict';
import { createRuntimeState } from './runtime-state.mjs';

const state = createRuntimeState('/tmp/jess-task-runtime-test.sqlite');
assert.equal(state.listOpenTasks([]).length, 0);
state.close();
```

Expected before implementation: import failure because `runtime-state.mjs` does not exist.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node scripts/task-runtime/runtime-state.test.mjs
```

Expected: non-zero exit status.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/task-runtime/runtime-state.mjs` with helpers that wrap the SQLite DB for:

- opening/closing runtime DB
- inserting events
- creating runs
- recording submissions
- leasing tasks
- reading active run state

Create `scripts/task-runtime/runtime-state.test.mjs`:

```js
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createRuntimeState } from './runtime-state.mjs';

const dbPath = '/tmp/jess-task-runtime-test.sqlite';
rmSync(dbPath, { force: true });

const state = createRuntimeState(dbPath);
state.insertEvent({
  event_id: 'evt-1',
  task_id: 'runtime-db-bootstrap',
  event_type: 'task_created',
  ts: '2026-04-20T00:00:00Z',
  actor: 'test',
  run_id: null,
  payload: {}
});

const events = state.listEvents('runtime-db-bootstrap');
assert.equal(events.length, 1);
assert.equal(events[0].event_id, 'evt-1');

state.close();
```

Update `config/codex-auto-policy.json` with:

```json
{
  "runtime_db": "state/task-runtime/runtime.sqlite"
}
```

Update `scripts/codex-auto-loop.sh` to:

- stop treating `completed.jsonl`, `needs-human.jsonl`, and `rejected.jsonl` as authoritative
- initialize runtime DB if needed
- write runs/submissions/events to SQLite
- treat JSONL files only as migration inputs if present

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node scripts/task-runtime/runtime-state.test.mjs
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/task-runtime/runtime-state.mjs scripts/task-runtime/runtime-state.test.mjs scripts/codex-auto-loop.sh config/codex-auto-policy.json
git commit -m "feat: move coordinator runtime state into sqlite"
```

### Task 6: Add coordinator-owned task transition applier

**Files:**
- Create: `scripts/task-runtime/apply-transition.mjs`
- Create: `scripts/task-runtime/lib/task-files.mjs`
- Modify: `scripts/codex-auto-loop.sh`
- Modify: `docs/tasks/README.md`

- [ ] **Step 1: Write the failing test**

Use missing-script failure:

```bash
node scripts/task-runtime/apply-transition.mjs
```

Expected before implementation: non-zero exit status.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node scripts/task-runtime/apply-transition.mjs
```

Expected: non-zero exit status.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/task-runtime/lib/task-files.mjs` with helpers to:

- load a task file by `id`
- update allowed fields
- validate the updated snapshot against `tasks/schema/task.schema.json`
- write the task file back with stable formatting

Create `scripts/task-runtime/apply-transition.mjs` that:

- accepts task id, new status, event payload, and accepted proof refs
- validates the transition against allowed status changes
- writes a runtime event
- updates the canonical task file
- rejects invalid transitions

Update `scripts/codex-auto-loop.sh` so:

- workers never directly mutate task files
- successful coordinator decisions call `apply-transition.mjs`
- `completed`, `needs_human`, and `rejected` are all task-state transitions rather than JSONL append hacks

Append to `docs/tasks/README.md`:

```md
## Authoritative State Changes

Canonical task snapshots are only updated through coordinator-owned transition application.

Workers may not edit task snapshots directly.
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node scripts/task-runtime/apply-transition.mjs --help
```

Expected: prints usage and exits `0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/task-runtime/apply-transition.mjs scripts/task-runtime/lib/task-files.mjs scripts/codex-auto-loop.sh docs/tasks/README.md
git commit -m "feat: add coordinator-owned task transitions"
```

### Task 7: Add generated task handoff bundles for cold-start workers

**Files:**
- Create: `scripts/task-runtime/build-handoff-bundle.mjs`
- Modify: `scripts/codex-auto-loop.sh`
- Modify: `docs/tasks/README.md`

- [ ] **Step 1: Write the failing test**

Use missing script failure:

```bash
node scripts/task-runtime/build-handoff-bundle.mjs --help
```

Expected before implementation: non-zero exit status.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node scripts/task-runtime/build-handoff-bundle.mjs --help
```

Expected: non-zero exit status.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/task-runtime/build-handoff-bundle.mjs` that:

- takes a task ID and output directory
- reads the canonical task snapshot
- reads recent runtime events for that task and track
- writes:
  - `task_snapshot.json`
  - `task_context.json`
  - `recent_events.json`
  - `verification_policy.json`

Update `scripts/codex-auto-loop.sh` so worker runs are seeded from this bundle instead of freeform task-file assembly alone.

Append to `docs/tasks/README.md`:

```md
## Cold-Start Worker Handoffs

The coordinator generates a handoff bundle per run so fresh workers can recover context without conversational history.
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
mkdir -p /tmp/jess-handoff-bundle
node scripts/task-runtime/build-handoff-bundle.mjs --task-id runtime-db-bootstrap --out /tmp/jess-handoff-bundle
test -f /tmp/jess-handoff-bundle/task_snapshot.json
test -f /tmp/jess-handoff-bundle/task_context.json
test -f /tmp/jess-handoff-bundle/recent_events.json
test -f /tmp/jess-handoff-bundle/verification_policy.json
```

Expected: all commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/task-runtime/build-handoff-bundle.mjs scripts/codex-auto-loop.sh docs/tasks/README.md
git commit -m "feat: add cold-start task handoff bundles"
```

### Task 8: Add operator command surface for steering task state and priority

**Files:**
- Create: `scripts/task-runtime/operator-tasks.mjs`
- Modify: `docs/tasks/README.md`
- Modify: `tasks/README.md`

- [ ] **Step 1: Write the failing test**

Use missing script failure:

```bash
node scripts/task-runtime/operator-tasks.mjs --help
```

Expected before implementation: non-zero exit status.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node scripts/task-runtime/operator-tasks.mjs --help
```

Expected: non-zero exit status.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/task-runtime/operator-tasks.mjs` supporting commands such as:

- `status`
- `prioritize <task-id> <priority>`
- `add <task-id> <title>`
- `block <task-id> <reason>`
- `focus <track>`

Immediate authoritative changes should be the default, but support:

- `--propose`

for proposal mode that records an event without changing canonical task state.

Document the command surface in `docs/tasks/README.md` and `tasks/README.md`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node scripts/task-runtime/operator-tasks.mjs --help
```

Expected: usage output with command list.

- [ ] **Step 5: Commit**

```bash
git add scripts/task-runtime/operator-tasks.mjs docs/tasks/README.md tasks/README.md
git commit -m "feat: add operator task steering commands"
```

### Task 9: Migrate the current auto-loop to the new task registry

**Files:**
- Modify: `scripts/codex-auto-loop.sh`
- Modify: `scripts/codex-auto-worker.sh`
- Modify: `config/codex-auto-policy.json`
- Modify: `docs/future/performance/codex-auto-loop.md`

- [ ] **Step 1: Write the failing test**

Use status/selection proof:

```bash
bash scripts/codex-auto-status.sh
```

Expected before migration: output is still driven by discovered prose tasks and legacy JSONL assumptions.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bash scripts/codex-auto-status.sh
```

Expected: legacy output path, proving migration is not yet complete.

- [ ] **Step 3: Write minimal implementation**

Update the auto-loop so it:

- reads open work from canonical task files, not regex discovery over handoff text
- reads completion/blocking state from task snapshots and runtime DB, not JSONL ledgers
- seeds workers with the generated handoff bundle
- requires machine-readable worker submission JSON
- applies authoritative transitions only through the coordinator

Update `scripts/codex-auto-worker.sh` to emit JSON submissions into the run artifact directory.

Update `docs/future/performance/codex-auto-loop.md` to explain the new architecture and operator flow.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
bash scripts/codex-auto-status.sh
bash scripts/codex-auto-loop.sh --once
```

Expected:

- status reports tasks from canonical task files
- one loop iteration leases a canonical task and writes runtime artifacts without mutating canonical task state directly from the worker

- [ ] **Step 5: Commit**

```bash
git add scripts/codex-auto-loop.sh scripts/codex-auto-worker.sh config/codex-auto-policy.json docs/future/performance/codex-auto-loop.md
git commit -m "feat: migrate auto loop onto durable task memory"
```

### Task 10: Retire the handoff as operational truth and record rollout follow-ups

**Files:**
- Modify: `docs/future/performance/2026-04-13-registry-redesign-handoff.md`
- Modify: `tasks/less-registry/*.json`
- Modify: `tasks/index.json`

- [ ] **Step 1: Write the failing test**

Use grep proof:

```bash
rg -n \"primary source of truth|operational truth\" docs/future/performance/2026-04-13-registry-redesign-handoff.md
```

Expected before implementation: no explicit retirement note exists.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
rg -n \"primary source of truth|operational truth\" docs/future/performance/2026-04-13-registry-redesign-handoff.md
```

Expected: non-zero exit status.

- [ ] **Step 3: Write minimal implementation**

Update the handoff doc so it clearly states:

- it is no longer the operational source of truth
- canonical execution state now lives in the task registry
- remaining actionable items have task IDs in `tasks/`

Add or update tasks so repo-wide expansion itself is tracked as explicit work.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
rg -n \"no longer the operational source of truth\" docs/future/performance/2026-04-13-registry-redesign-handoff.md
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add docs/future/performance/2026-04-13-registry-redesign-handoff.md tasks/less-registry/*.json tasks/index.json
git commit -m "docs: retire handoff as operational truth"
```

## Self-Review

- Spec coverage:
  - canonical task snapshots: covered by Tasks 1-2
  - SQLite runtime store: covered by Tasks 3 and 5
  - machine-readable worker output: covered by Task 4
  - coordinator-only state transitions: covered by Task 6
  - cold-start handoff bundles: covered by Task 7
  - operator command surface: covered by Task 8
  - migration from current loop: covered by Task 9
  - retiring handoff model: covered by Task 10
- Placeholder scan:
  - removed generic “implement later” language; each task names concrete files, commands, and example content
- Type consistency:
  - status names, task schema fields, and runtime DB concepts are consistent with the spec terminology

