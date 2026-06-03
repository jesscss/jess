# Core Architecture Handoff

This is the live handoff for getting Jess back to a credible alpha. Keep it
short, current, and operational. Do not store detailed completed-pass summaries
here.

## Current Reality

The single-pass eval/render-to-string refactor was justified by a hypothesis:
preserving one canonical tree and avoiding routine clone/mutate cycles should be
faster and smaller in real Less evaluation/render work.

Current alpha evidence does not yet prove that hypothesis. Treat the project as
being in regression recovery until profiles and benchmarks say otherwise. The
work now has two priorities, in this order:

1. Unblock correctness with red-to-green core repros for every `.less`
   parse/eval failure.
2. Run repeated V8/profile-guided performance rounds that reduce real hot-path
   cost: object creation, state/tracking records, `WeakMap`/side-map churn,
   helper arrays, recursive walks, and function-call ladders.

Static node/object counts are only supporting evidence. The release goal is
faster real Less eval/render first, lower memory pressure second.

## Runtime Direction

- Preserve one canonical source tree.
- Do not mutate or corrupt canonical nodes during eval, resolve, or render.
- Reuse canonical nodes whenever that preserves readable/serializable source,
  valid parentage, lookup state, and output correctness.
- Allocate owned nodes, state records, side maps, arrays, or helper wrappers
  only when they protect a real runtime invariant or remove more runtime cost
  than they add.
- Do not preserve owned public results for theoretical caller mutation. That is
  not a goal.
- Do not trade one deleted node for more expensive side state, recursive walks,
  `WeakMap` lookups, helper arrays, or function-call overhead.
- Repeated generated output, especially recursive mixin bodies, should reuse the
  canonical body shape. Most of the tree should not be reserialized on every
  placement; prefer reusable static render segments/templates with narrow
  dynamic placeholders for values, selectors, imports, extends, merges, or
  other state-dependent output.
- The current render buffer is a useful foundation, but it is not yet a full
  static-template cache. Treat flat/segmented buffer work as a path toward
  "serialize static parts once, fill dynamic slots cheaply", not merely as an
  append/capture abstraction.
- Do not render to `OutputWriter.preview(...)` only to discard the result and
  render the same node again. Preview output must either be the emitted output,
  populate a cache reused by emission, or be replaced with a cheaper structural
  predicate.
- Do not use `Error` objects for routine control flow. Expected misses, failed
  candidate checks, branch classification, and diagnostic-only result states
  must use typed result objects, booleans, sentinels, or lightweight records.
  Real `Error` instances belong only on exceptional throw paths.

## Active Correctness Queue

No active correctness blockers. The alpha snapshot command currently records
all queued benchmark files in one run.

If any other `.less` fixture or benchmark fails to parse or evaluate, add it to
this queue as a focused core repro before changing expected output. If `.less`
renders but CSS differs, review expected behavior manually before changing
tests or semantics.

## Performance Round Protocol

After the correctness queue is clear enough for benchmarks to run, every handoff
run should do at least one full performance round. Do not make speculative
cleanup changes without before/after evidence.

1. Capture a baseline profile and benchmark snapshot.
2. Identify the top concrete cost from the profile: object allocation surface,
   lookup path, recursive walk, helper array, state graph, side-map lookup, or
   function-call ladder.
3. State the hypothesis in one sentence in this handoff before editing.
4. Make the smallest behavior-preserving change that removes that cost.
5. If the change touches expected misses or candidate classification, add or
   update tests proving the hot path does not allocate or return real `Error`
   objects for control-flow results.
6. Run focused tests and the same profile/benchmark again.
7. Keep the change only if it improves real runtime cost, removes measurable
   memory/object pressure without slowing runtime, or fixes correctness.
8. Revert or reshape the change if it only moves cost elsewhere.
9. Update the active snapshot below with a one-paragraph result and the next
   profile target.

### Required User Performance Report

At the end of every handoff run, report performance to the user in plain terms:

- **Real benchmark** numbers for the files touched or measured. These are the
  only numbers that count as "Jess got faster/slower" and the only numbers to
  compare against Less 4.x;
- historical Less 4.x real benchmark comparison and rough slowdown ratio where
  available;
- **Instrumented profiler** results only as diagnostic support. Label them
  explicitly as profiler/counter runs, and do not present profiler elapsed time
  as product performance;
- **CPU profile** evidence only as sampled hotspot/call-stack evidence. Label
  CPU sample counts separately from benchmark timings;
- whether the run improved, regressed, or only clarified the next target;
- which optimization was kept, rejected, or deferred and why;
- the next profile target.

Do not hide behind proxy metrics. If a code change was rejected because the real
benchmark slowed down, say that. If profiler elapsed moves but the real
benchmark does not, call that a diagnostic clue, not a runtime improvement.

### Required Profile Inputs

Use the existing instrumentation before choosing a performance edit:

```sh
pnpm --filter @jesscss/core build
pnpm --filter @jesscss/less-parser build
pnpm --filter @jesscss/plugin-less build
pnpm --filter @jesscss/plugin-less-compat build
pnpm --filter jess build

node scripts/profile-less-benchmark.mjs --file=benchmark-v37.less
node scripts/profile-less-benchmark.mjs --file=benchmark-v39.less
```

For recursive mixin/color work, also profile the smallest extracted stress file
or the broad benchmark once it is bounded:

```sh
node scripts/profile-less-benchmark.mjs --file=benchmark-color-stress.less
node scripts/profile-less-benchmark.mjs --file=benchmark.less
```

Use CPU profiles for focused tests when call stacks are unclear:

```sh
./scripts/profile-test.sh core "<test-file-or-filter>"
./scripts/profile-test.sh jess "<test-file-or-filter>"
```

Use `JESS_PROFILE=1` when phase timing matters:

```sh
JESS_PROFILE=1 node scripts/profile-less-benchmark.mjs --file=benchmark-v37.less
```

### Required Benchmark Inputs

Record Jess alpha snapshots, not only historical Less comparisons:

```sh
BENCH_FILES=benchmark-color-stress.less,benchmark-v37.less,benchmark-v39.less BENCH_RUNS=6 BENCH_WARMUP=2 BENCH_TIMEOUT_MS=15000 \
  node packages/less/benchmark/run-and-compare.mjs
```

Use this hot-path fixture set for package-local comparisons:

```sh
pnpm run measure:less:hotpath:record -- --note "<short hypothesis/result>"
```

Use static audits only to support profile decisions:

```sh
pnpm run audit:node-creation
```

## Active Performance Snapshot

Current known evidence from the latest handoff run:

- Latest handoff round first fixed the reporting guidance: every final report
  must label numbers as **Real benchmark**, **Instrumented profiler**, or
  **CPU profile** evidence, and only real benchmark numbers count as
  "Jess got faster/slower" or compare to Less 4.x. The performance experiment
  targeted `Reference.evalNode`/`Rules.find`. **Real benchmark** baseline for
  the run was noisy at about `499.28ms avg / 434.86ms median`, while the
  **Instrumented profiler** diagnostic still showed `Reference.evalNode`
  3,610 calls and `Rules.find` 999 calls. A narrow registry experiment skipped
  child-search setup when a `Rules` node had no child-rule registry entries;
  focused lookup/mixin tests passed, but **Real benchmark** post-change samples
  were only about `407.11ms avg / 386.36ms median` and
  `404.84ms avg / 382.50ms median`, which is not better than the established
  post-extend band, and the instrumented profiler diagnostic worsened. The
  registry change was rejected and reverted. Less 4.5 remains about `47ms`, so
  broad alpha is still roughly `8-9x` slower. Next target: get a CPU-profile
  stack breakdown specifically for `Reference.evalNode` and `Rules.find`
  before changing lookup semantics or allocation shape again.
- Latest handoff round kept a small extend-chain optimization. A fresh broad
  `benchmark.less` baseline measured about `412.00ms avg / 383.02ms median`
  and `profile-less-benchmark.mjs --file=benchmark.less` measured about
  `785.76ms` instrumented elapsed. The CPU profile showed `processExtends`
  back near the top, with copy pressure still fragmented across guard,
  registration, callable, and render paths. The kept change caches the original
  selector subtree value set once inside `applyExtendsToSelector` and threads
  it into chained-extend lookup, avoiding repeated original-selector walks
  after successful extends. Focused extend tests and the broader mixin test are
  green. Post-change broad samples were about `380.99ms avg / 367.85ms median`
  and `396.34ms avg / 383.44ms median`; the instrumented profile moved to
  about `700.85ms`. Less 4.5 remains about `47ms`, so broad alpha is still
  roughly `8x` slower. Next target: profile `Reference.evalNode`/`Rules.find`
  together and look for a real lookup-state reduction; guard copies are hot but
  currently protect canonical guard eval/prep state and should not be removed
  without a red-to-green invariant change.
- Latest handoff round deepened the broad `benchmark.less` evidence without
  keeping a production code change. A 15-run/5-warmup real benchmark baseline
  measured about `389.55ms avg / 383.93ms median`; a V8 CPU profile then showed
  the hottest leaves in copy/object surfaces (`copyChild`, `Node`,
  `copyCallableRulesValue`, `copyWithReusableLeaves`) plus `Rules` iteration,
  variable lookup, extend processing, and render body serialization. A narrow
  experiment that skipped transient callable child-segment objects and built
  mixin-output maps in one loop passed focused callable/mixin tests but slowed
  the same broad benchmark to about `410.77ms avg / 396.99ms median` and then
  `448.40ms avg / 436.18ms median`, so it was rejected and reverted. The
  post-revert broad sample returned to about `398.62ms avg / 384.52ms median`.
  Less 4.5 remains about `47ms`, so broad alpha is still roughly `8-9x` slower.
  Next target: do not shave placement metadata loops blindly; profile the
  actual callable body copy path and look for a semantic reduction in owned
  container creation or static render reuse.
- Latest handoff run found the alpha snapshot compiler-resolution note was
  stale: `BENCH_FILES=benchmark-color-stress.less,benchmark-v37.less,benchmark-v39.less,benchmark-v3.less,benchmark.less`
  with `BENCH_RUNS=6 BENCH_WARMUP=2 BENCH_TIMEOUT_MS=15000` records all files.
  The same run measured about 20ms color stress, 18-26ms v37/v39/v3, and
  390-432ms broad `benchmark.less` against historical Less 4.5 at about 47ms.
  A focused experiment removing the routine `Set<ScopeFrame>` allocation from
  simple live-slot reference lookup was rejected: it passed the focused
  allocation/reference tests but A/B broad runner evidence was worse
  (`~405ms avg / 392ms median` kept-change sample versus `~360ms avg / 362ms
  median` after reverting). Do not restock that exact micro-change unless a
  later profile shows a different implementation shape.
- Latest correctness pass cleared `benchmark-v3.less` through the Less alpha
  runner. The first failure was a parser context leak: guarded mixin parsing
  left comma-as-or state on the shared parse context, so nested declaration
  `if((...))` conditions over-consumed branch separators. The next failure was
  default-param eval scope: `@border: darken(@bg, 10%)` evaluated without the
  sibling `@bg` live slot. Focused parser/core regressions now cover both, and
  `benchmark-v3.less --runs=1 --warmup=0 --math=always` completes at about
  120ms.
- Recursive color mixin stress exposed an exponential render bug: depth 20 did
  not complete within 60s before the fix. After removing child `Rules`
  preview-then-rerender paths, `benchmark-color-stress.less` depth 20 profiles
  at about 120ms with bounded writer mark/getSince counts.
- Latest V8 round on broad `benchmark.less` found ordinary extend non-matches
  spending about 36% self time constructing `ExtendError` objects. Replacing
  those hot-path result errors with lightweight `{ name, type, message }`
  records kept extend semantics and moved the profiled 8-run/3-warmup broad
  runner from about 674ms avg / 666ms median to about 456ms avg / 453ms median.
  A non-profiled 15-run/5-warmup sample after the change was noisy but improved
  at about 509ms avg / 427ms median. Less 4.x remains about 41-47ms, so this is
  still an alpha-blocking broad benchmark regression.
- The current `profile-less-benchmark.mjs --file=benchmark.less` sample after
  the extend error-record change is about 644ms elapsed. Counters are stable:
  `Reference.evalNode` 3,610 calls / about 103ms, `LessParser.parse` 3 calls /
  about 90ms, `Rules.find` 999 calls / about 33ms,
  `OutputWriter.getSince` 127,537 calls / about 10ms, and
  `MixinRegistry.indexPendingItems` 36,239 calls / about 8ms.
- The next V8 hotspots after removing `ExtendError` construction are object
  creation/copy surfaces: `copyChild`, `Node` construction,
  `constructCopy`/`copyWithReusableLeaves`, plus variable lookup
  (`findVarWithinScopeSurface`) and render serialization
  (`serializeRulesContainerInternal` / `renderRulesBody`). The next round should
  profile one of those surfaces, change only the measured hot path, then rerun
  the same broad benchmark/profile.
- Latest static node-creation audit:

```text
new-node: 278
derive: 29
with-surface: 38
copy-leaves: 28
module-context: 372
render-context: 1
```

Next target: capture a deeper CPU profile for broad `benchmark.less`, because
the coarse counters are now too blunt. The current measured costs still point
at `Reference.evalNode`, parser time, `Rules.find`, `OutputWriter.getSince`,
and `MixinRegistry.indexPendingItems`, while earlier CPU profiles also showed
object-copy pressure in guard evaluation (`copyGuardForEval` during callable
candidate checks), declaration registration/reference value copies, Less compat
adapter creation, and extend classification fallback. Treat these as runtime
architecture work: remove routine copies only where canonical source remains
readable and output semantics stay unchanged, then remeasure the same broad
benchmark.

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

Use the full baseline when a change touches root gates, package metadata,
shared verifier scripts, or broad render/eval contracts:

```sh
pnpm run verify:baseline
```

Function-call or rawArgs changes should also run:

```sh
node scripts/measure-callwithcontext-rawargs.mjs 750
```

## Queue Restocking Rules

Restock only from evidence:

- a failing or missing alpha gate;
- a focused core repro created from a real `.less` parse/eval failure;
- a measured Less eval/render regression;
- a V8/profile hot path with a concrete cost surface;
- a helper/state/copy deletion with focused proof and no runtime slowdown;
- a real canonical-tree preservation bug.

Do not restock from completed lane history. Do not add entries shaped like
“complete unless...” or “reopen only if...”. If it is not active work, remove it.

## Worktree / Commit Rule

For queue runs:

1. Read relevant source and focused tests before editing.
2. Write the red repro first for correctness bugs.
3. Capture the before profile for performance work.
4. Make the smallest behavior-preserving change.
5. Run focused proof first.
6. Run the same benchmark/profile after the change.
7. Keep/revert based on measured evidence.
8. Update this handoff only with active queue state, profile snapshot, and next
   target.
9. Commit and push when clean.

If using sub-agents, keep work isolated in existing core-architecture worktrees,
merge/push each accepted change to `origin/dev`, refresh from `origin/dev`, and
reuse the worktree for the next task.

## Historical Pointers

The older node-copy-specific framing is historical context only:

- `docs/future/node-copy-reduction/README.md`
- `docs/future/node-copy-reduction/HANDOFF.md`
- `docs/future/node-copy-reduction/less-hotpath-history.jsonl`

Do not resurrect those files as the active queue.

The older alpha sandbox benchmark files from `/Users/matthew/git/oss/less copy.js`
are preserved in
`/Users/matthew/git/oss/less.js/packages/less/benchmark/archive/old-alpha-2026-06-03/`.
Use those archived fixtures/diffs for numeric map-key, unparenthesized division,
and older broad-benchmark compatibility coverage.
