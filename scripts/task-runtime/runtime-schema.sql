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
