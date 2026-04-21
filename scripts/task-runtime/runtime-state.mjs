import { existsSync, readFileSync, statSync } from 'node:fs';
import { openRuntimeDb } from './lib/db.mjs';

const TERMINAL_EVENT_TO_STATUS = {
  task_completed: 'completed',
  task_needs_human: 'needs-human',
  task_rejected: 'rejected',
};

const TERMINAL_EVENT_TYPES = new Set(Object.keys(TERMINAL_EVENT_TO_STATUS));

function parsePayload(value) {
  if (!value) {
    return {};
  }

  return JSON.parse(value);
}

function serializePayload(payload) {
  return JSON.stringify(payload ?? {});
}

function withTransaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw error;
  }
}

function readJsonlRecords(filePath) {
  const text = readFileSync(filePath, 'utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function hasReadableJsonl(filePath) {
  return Boolean(filePath) && existsSync(filePath) && statSync(filePath).size > 0;
}

function upsertTaskRuntime(db, taskId, patch) {
  const current = db
    .prepare('SELECT task_id FROM task_runtime WHERE task_id = ?')
    .get(taskId);

  if (current) {
    const currentRow = db
      .prepare(
        `
          SELECT lease_owner, lease_expires_at, active_run_id, last_event_id, updated_at
          FROM task_runtime
          WHERE task_id = ?
        `,
      )
      .get(taskId);
    const has = (key) => Object.hasOwn(patch, key);

    db.prepare(
      `
        UPDATE task_runtime
        SET lease_owner = ?,
            lease_expires_at = ?,
            active_run_id = ?,
            last_event_id = ?,
            updated_at = ?
        WHERE task_id = ?
      `,
    ).run(
      has('lease_owner') ? patch.lease_owner : currentRow.lease_owner,
      has('lease_expires_at') ? patch.lease_expires_at : currentRow.lease_expires_at,
      has('active_run_id') ? patch.active_run_id : currentRow.active_run_id,
      has('last_event_id') ? patch.last_event_id : currentRow.last_event_id,
      has('updated_at') ? patch.updated_at : currentRow.updated_at,
      taskId,
    );
    return;
  }

  db.prepare(
    `
      INSERT INTO task_runtime (
        task_id,
        lease_owner,
        lease_expires_at,
        active_run_id,
        last_event_id,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(
    taskId,
    patch.lease_owner ?? null,
    patch.lease_expires_at ?? null,
    patch.active_run_id ?? null,
    patch.last_event_id ?? null,
    patch.updated_at ?? null,
  );
}

function getLatestTaskEvent(db, taskId) {
  return db
    .prepare(
      `
        SELECT event_id, task_id, event_type, ts, actor, run_id, payload_json
        FROM events
        WHERE task_id = ?
        ORDER BY ts DESC, event_id DESC
        LIMIT 1
      `,
    )
    .get(taskId);
}

function getRuntimeRow(db, taskId) {
  return db
    .prepare(
      `
        SELECT
          tr.task_id,
          tr.lease_owner,
          tr.lease_expires_at,
          tr.active_run_id,
          tr.last_event_id,
          tr.updated_at,
          r.status AS active_run_status,
          r.started_at AS active_run_started_at,
          r.finished_at AS active_run_finished_at
        FROM task_runtime tr
        LEFT JOIN runs r ON r.run_id = tr.active_run_id
        WHERE tr.task_id = ?
      `,
    )
    .get(taskId);
}

function getTaskStatus(db, taskId) {
  const event = getLatestTaskEvent(db, taskId);
  if (!event) {
    const runtime = getRuntimeRow(db, taskId);
    if (!runtime) {
      return 'open';
    }
    if (runtime.active_run_id || runtime.lease_owner) {
      return 'leased';
    }
    return 'open';
  }

  const terminalStatus = TERMINAL_EVENT_TO_STATUS[event.event_type];
  if (terminalStatus) {
    return terminalStatus;
  }

  const runtime = getRuntimeRow(db, taskId);
  if (runtime && (runtime.active_run_id || runtime.lease_owner)) {
    return 'leased';
  }

  return 'open';
}

function listTaskEvents(db, taskId) {
  return db
    .prepare(
      `
        SELECT event_id, task_id, event_type, ts, actor, run_id, payload_json
        FROM events
        WHERE task_id = ?
        ORDER BY ts ASC, event_id ASC
      `,
    )
    .all(taskId)
    .map((row) => ({ ...row, payload: parsePayload(row.payload_json) }));
}

function insertEvent(db, event) {
  db.prepare(
    `
      INSERT INTO events (event_id, task_id, event_type, ts, actor, run_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        task_id = excluded.task_id,
        event_type = excluded.event_type,
        ts = excluded.ts,
        actor = excluded.actor,
        run_id = excluded.run_id,
        payload_json = excluded.payload_json
    `,
  ).run(
    event.event_id,
    event.task_id,
    event.event_type,
    event.ts,
    event.actor,
    event.run_id ?? null,
    serializePayload(event.payload),
  );

  const isTerminal = TERMINAL_EVENT_TYPES.has(event.event_type);
  upsertTaskRuntime(db, event.task_id, {
    active_run_id: isTerminal ? null : event.run_id ?? null,
    last_event_id: event.event_id,
    updated_at: event.ts,
    ...(isTerminal ? { lease_owner: null, lease_expires_at: null } : {}),
  });
}

function createRun(db, run) {
  db.prepare(
    `
      INSERT INTO runs (run_id, task_id, branch, worktree, status, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        task_id = excluded.task_id,
        branch = excluded.branch,
        worktree = excluded.worktree,
        status = excluded.status,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at
    `,
  ).run(
    run.run_id,
    run.task_id,
    run.branch ?? null,
    run.worktree ?? null,
    run.status ?? 'running',
    run.started_at,
    run.finished_at ?? null,
  );

  upsertTaskRuntime(db, run.task_id, {
    active_run_id: run.run_id,
    updated_at: run.started_at,
  });
}

function finishRun(db, runId, status, finishedAt) {
  db.prepare(
    `
      UPDATE runs
      SET status = ?, finished_at = ?
      WHERE run_id = ?
    `,
  ).run(status, finishedAt, runId);

  const run = db
    .prepare(
      `
        SELECT task_id
        FROM runs
        WHERE run_id = ?
      `,
    )
    .get(runId);

  if (!run) {
    return;
  }

  const runtime = getRuntimeRow(db, run.task_id);
  if (runtime?.active_run_id === runId) {
    upsertTaskRuntime(db, run.task_id, {
      active_run_id: null,
      updated_at: finishedAt,
    });
  }
}

function recordSubmission(db, submission) {
  db.prepare(
    `
      INSERT INTO submissions (
        submission_id,
        run_id,
        task_id,
        classification,
        candidate_commit,
        summary_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(submission_id) DO UPDATE SET
        run_id = excluded.run_id,
        task_id = excluded.task_id,
        classification = excluded.classification,
        candidate_commit = excluded.candidate_commit,
        summary_json = excluded.summary_json,
        created_at = excluded.created_at
    `,
  ).run(
    submission.submission_id,
    submission.run_id,
    submission.task_id,
    submission.classification,
    submission.candidate_commit ?? null,
    serializePayload(submission.summary),
    submission.created_at,
  );
}

function leaseTask(db, taskId, lease) {
  upsertTaskRuntime(db, taskId, {
    lease_owner: lease.lease_owner ?? null,
    lease_expires_at: lease.lease_expires_at ?? null,
    active_run_id: lease.active_run_id ?? null,
    updated_at: lease.updated_at ?? new Date().toISOString(),
  });
}

function getTaskRuntime(db, taskId) {
  const runtime = getRuntimeRow(db, taskId);

  if (!runtime) {
    return null;
  }

  const latestEvent = getLatestTaskEvent(db, taskId);
  return {
    ...runtime,
    status: latestEvent ? TERMINAL_EVENT_TO_STATUS[latestEvent.event_type] ?? 'open' : 'open',
    latest_event: latestEvent
      ? { ...latestEvent, payload: parsePayload(latestEvent.payload_json) }
      : null,
  };
}

function isTaskOpen(db, taskId) {
  const runtime = getTaskRuntime(db, taskId);
  if (!runtime) {
    return true;
  }

  return runtime.status === 'open' && !runtime.active_run_id && !runtime.lease_owner;
}

function listOpenTasks(db, tasks) {
  return tasks.filter((task) => isTaskOpen(db, task.id));
}

function isDatabaseEmpty(db) {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'")
    .get();
  return row.count > 0
    ? db.prepare('SELECT COUNT(*) AS count FROM events').get().count === 0
    : true;
}

function importLegacyJsonlState(db, legacyFiles) {
  if (!legacyFiles) {
    return;
  }

  const { completedFile, needsHumanFile, rejectedFile } = legacyFiles;
  const hasLegacyRecords =
    hasReadableJsonl(completedFile) ||
    hasReadableJsonl(needsHumanFile) ||
    hasReadableJsonl(rejectedFile);

  if (!hasLegacyRecords || !isDatabaseEmpty(db)) {
    return;
  }

  const files = [
    [completedFile, 'task_completed'],
    [needsHumanFile, 'task_needs_human'],
    [rejectedFile, 'task_rejected'],
  ];

  for (const [filePath, eventType] of files) {
    if (!filePath) {
      continue;
    }
    if (!hasReadableJsonl(filePath)) {
      continue;
    }

    for (const record of readJsonlRecords(filePath)) {
      insertEvent(db, {
        event_id: `legacy:${record.task_id}:${record.ts}:${record.classification}`,
        task_id: record.task_id,
        event_type: eventType,
        ts: record.ts,
        actor: record.classification ?? 'legacy',
        run_id: null,
        payload: record,
      });
    }
  }
}

export function createRuntimeState(dbPath, options = {}) {
  const db = openRuntimeDb(dbPath);

  if (options.legacyJsonl) {
    importLegacyJsonlState(db, options.legacyJsonl);
  }

  return {
    close() {
      db.close();
    },
    insertEvent(event) {
      insertEvent(db, event);
    },
    listEvents(taskId) {
      return listTaskEvents(db, taskId);
    },
    createRun(run) {
      createRun(db, run);
    },
    startRun(run, event) {
      withTransaction(db, () => {
        createRun(db, run);
        insertEvent(db, event);
      });
    },
    finishRun(runId, status, finishedAt) {
      finishRun(db, runId, status, finishedAt);
    },
    failRun({ runId, status, finishedAt, event }) {
      withTransaction(db, () => {
        insertEvent(db, event);
        finishRun(db, runId, status, finishedAt);
      });
    },
    recordSubmission(submission) {
      recordSubmission(db, submission);
    },
    recordResult({ submission, submissionEvent, terminalEvent, runStatus, finishedAt }) {
      withTransaction(db, () => {
        recordSubmission(db, submission);
        insertEvent(db, submissionEvent);
        if (terminalEvent) {
          insertEvent(db, terminalEvent);
        }
        finishRun(db, submission.run_id, runStatus, finishedAt);
      });
    },
    leaseTask(taskId, lease) {
      leaseTask(db, taskId, lease);
    },
    getTaskRuntime(taskId) {
      return getTaskRuntime(db, taskId);
    },
    getTaskStatus(taskId) {
      return getTaskStatus(db, taskId);
    },
    isTaskTerminal(taskId) {
      return getTaskStatus(db, taskId) !== 'open';
    },
    listOpenTasks(tasks) {
      return listOpenTasks(db, tasks);
    },
  };
}
