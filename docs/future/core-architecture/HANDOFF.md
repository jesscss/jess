# Core Architecture Handoff

This is the live handoff for the core eval/render architecture work heading
toward the next alpha release. Keep it short and operational.

## Current Goal

Jess should get back to a credible alpha state with a smaller, faster, easier
to reason about runtime.

The runtime direction is:

- preserve one canonical source tree;
- avoid mutating/corrupting canonical nodes during eval, resolve, or render;
- reuse canonical nodes whenever that preserves readability, serialization,
  parentage, lookup state, and output correctness;
- allocate owned nodes, state objects, side maps, arrays, or helper wrappers
  only when they remove more runtime cost than they add or protect a real
  runtime invariant;
- judge performance by real Less eval/render speed first, memory pressure
  second, and static object-count audits only as supporting evidence.

Do not preserve owned public results for theoretical caller mutation. That is
not a goal.

## Active Queue

No active queue items are currently defined.

### Alpha Confidence

Restock only from evidence:

- a failing or missing alpha gate;
- a measured Less eval/render regression or clear hot-path win;
- a concrete helper/state/copy deletion with focused proof;
- a real canonical-tree preservation bug.

Do not restock from broad lane history or from completed-work summaries.

Most recent run cleared the direct-index container reuse item: explicit
direct-index reference targets now reuse raw canonical lookup containers when
they are already safe index containers, and plain declaration registration can
skip no-op owned materialization during Rules registration without changing
direct declaration resolve/render semantics.

## Closed Work Policy

Completed lanes are intentionally not tracked in detail here. If a lane has no
active queue item, it is out of the handoff. Use git history and focused tests
for proof.

Do not add entries shaped like “complete unless...” or “reopen only if...”.
Those are historical notes disguised as queue items. If a future issue appears,
write it as a new concrete active queue item with:

- file/surface;
- suspected runtime cost or correctness risk;
- completion gate;
- focused verification command.

## Runtime Guardrails

- Preserve Jess behavior unless the active task explicitly changes it.
- Render-only paths should emit through native syntax or direct state when a
  public result node is not required.
- Public `resolve(...)`, `eval(...)`, and compatibility/debug APIs may own
  result nodes only when canonical reuse would corrupt source readability,
  serialization, parentage, lookup state, or output correctness.
- New state records must be smaller and cheaper than the wrapper/tree they
  replace. Do not create AST v2 out of side-state.
- Do not trade one removed node for more expensive side maps, `WeakMap`
  lookups, recursive walks, helper arrays, or function-call ladders.
- Do not generalize a helper until at least two live surfaces need the same
  contract.

## Current Audit Snapshot

Latest static node-creation audit on `dev`:

```text
new-node: 277
derive: 29
with-surface: 38
copy-leaves: 27
module-context: 370
render-context: 1
```

Static counts are not the release goal. Use them to catch obvious bloat and to
support runtime measurements.

## Verification

Use the smallest focused test while iterating, then the nearest broader gate.

Standard architecture gate:

```sh
pnpm run audit:node-creation
pnpm run verify:node-copy-frontier
pnpm run verify:render-buffer-frontier
pnpm run verify:materialization-frontier
pnpm run verify:package-exports
pnpm run verify:baseline -- --changed
```

Performance-sensitive changes should also run:

```sh
pnpm run measure:less:hotpath
```

Function-call or rawArgs changes should also run:

```sh
node scripts/measure-callwithcontext-rawargs.mjs 750
```

Use the full baseline when a change touches root gates, package metadata,
shared verifier scripts, or broad render/eval contracts:

```sh
pnpm run verify:baseline
```

## Worktree / Commit Rule

For queue runs:

1. Read relevant source and focused tests before editing.
2. Make the smallest behavior-preserving change.
3. Run focused proof first.
4. Run the nearest broader verification.
5. Update this handoff only when the active queue or runtime truth changes.
6. Commit and push when clean.

If using sub-agents, keep work isolated in the existing core-architecture
worktrees and refresh them from `origin/dev` after their previous change lands.

## Historical Pointers

The older node-copy-specific framing is historical context only:

- `docs/future/node-copy-reduction/README.md`
- `docs/future/node-copy-reduction/HANDOFF.md`
- `docs/future/node-copy-reduction/less-hotpath-history.jsonl`

Do not resurrect those files as the active queue.
