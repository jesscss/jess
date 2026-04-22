# Canonical Task Registry

This directory contains canonical checked-in task snapshots for active monorepo work.

Each task file is the authoritative current-state snapshot for one task.
History is tracked separately through the runtime event system and recorded back onto the task snapshot via accepted transition references.

Operator steering should go through `scripts/task-runtime/operator-tasks.mjs`, not ad hoc edits to task files.

That keeps task mutation event-backed and deterministic for later agents.
