## `.cursor/archive/`

This folder contains **archived, time-specific** debugging notes and one-off analysis documents.

Policy:

- Archive files are prefixed with the archive date: `YYYY-MM-DD__<original_name>.md`
- Archived files are kept for historical context, but should not be treated as the canonical source of truth.

Canonical “live” docs are typically:

- `.cursor/PROJECT_STATE.md`
- `.cursor/changes.md`
- `.cursor/DEBUGGING_ORCHESTRATION.md`
- Small area notes only when necessary; prefer Cursor-native rules and canonical package docs

The 2026-05-09 archive batch moved old root-level extend/debug session notes out
of startup context. Use the canonical package docs and current handoffs before
consulting those files.
