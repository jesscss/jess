## Worker Contract

`scripts/codex-auto-worker.sh` runs one isolated `codex exec` task in a fresh worktree.

The worker must:

- handle exactly one task
- classify the result
- update tracking docs
- verify the slice
- commit and push its worker branch only when clean
