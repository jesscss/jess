CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  run_id TEXT,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS task_runtime (
  task_id TEXT PRIMARY KEY,
  lease_owner TEXT,
  lease_expires_at TEXT,
  active_run_id TEXT,
  last_event_id TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (active_run_id) REFERENCES runs(run_id) ON DELETE SET NULL,
  FOREIGN KEY (last_event_id) REFERENCES events(event_id) ON DELETE SET NULL
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
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_task_id ON events(task_id);
CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id);
CREATE INDEX IF NOT EXISTS idx_runs_task_id ON runs(task_id);
CREATE INDEX IF NOT EXISTS idx_submissions_run_id ON submissions(run_id);
CREATE INDEX IF NOT EXISTS idx_submissions_task_id ON submissions(task_id);
CREATE INDEX IF NOT EXISTS idx_task_runtime_active_run_id ON task_runtime(active_run_id);
