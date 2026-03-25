# Node Copy Reduction — Handoff

## Read Order

1. [session-instance-architecture.md](./session-instance-architecture.md)
2. [dependency-graph.md](./dependency-graph.md)
3. [PROGRESS.md](./PROGRESS.md)
4. [node-session-status.md](./node-session-status.md)

## Current Verdict

This branch is not merge-ready.

The bridge work was useful, but it exposed the real missing model:

- immutable source tree
- many lazy session-local instances over that tree
- sparse dependency-guided shadow state

## Active Stage

Current real work is:

- `SI-1`: instance root core
- `SI-2`: lazy node views
- `SI-3`: sparse shadow state

Do not keep treating bridge helpers as the target architecture.

## Immediate Proof Cases

The highest-signal proof cases are:

- `Call`
- `StyleImport`
- `Mixin`
- `Func`
- `Rules`

Why:

- they are where repeated reuse of the same canonical subtree is still most visible

## What To Do Next

1. Define instance roots clearly in code.
2. Define lazy node views that keep the normal node API.
3. Move sparse shadow ownership to the instance root.
4. Use dependency reach to keep broad trees thin.
5. Prove repeated imports.
6. Prove repeated mixin/function reuse.

## Hard Rules

- no explicit instance parameters in ordinary node APIs
- no normalizing internal materialization as an eval strategy
- no helper/wrapper family growth unless it maps to a named future primitive
- do not treat local bridge-green slices as architectural completion

## What To Avoid

- polishing one-overlay-per-canonical-node as if it were the destination
- adding more bridge seams without collapsing them toward instance roots/views
- using local tests to declare the whole architecture solved

## Working Tree Notes

- Ignore unrelated dirty files under `packages/docs-content/...` unless asked to work there.
- Keep docs aligned to the new stage model and target architecture.
- If a code change only strengthens the bridge without moving toward instance roots/views, challenge it before landing it.
