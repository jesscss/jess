# Less Benchmark Investigation Tickets

Date: `2026-04-13`
Audit source:

```txt
docs/future/performance/2026-04-13-less-benchmark-audit.md
```

These are local investigation tickets, not completed fixes.

Regression framing:

- the repo owner reports that before the value-forking effort, the benchmark
  path was around `1.6x` Less runtime
- current modern benchmark cases are around `36x` to `46x` slower than
  historical Less

Treat these tickets as regression-recovery work, not generic cleanup.

## PERF-001

Title: Reduce registry lookup churn in `find` / `_searchRulesChildren`

Area:

- [packages/core/src/tree/util/registry-utils.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts)

Evidence:

- CPU profile shows `find` and `_searchRulesChildren` at the very top of the
  hot path on `benchmark.less`.
- one-render instrumentation:
  - `Rules.find`: `301,333`
  - `DeclarationRegistry.find`: `260,728`
  - `MixinRegistry.find`: `37,314`
  - `DeclarationRegistry.indexPendingItems`: `279,848`

Hypothesis:

- the same names are being searched repeatedly through the same scope chains
- child search is being entered too often
- current registry indexing is not selective enough for the modern Less cases

Validation plan:

1. Count `find` calls per full `benchmark.less` render.
2. Count `_searchRulesChildren` calls and average fanout.
3. Identify the highest-frequency key names.
4. Verify whether extend/eval is repeatedly asking the same questions.

Success criteria:

- materially lower `find` and `_searchRulesChildren` invocation counts
- measurable drop in `benchmark.less` render time

## PERF-002

Title: Reduce serializer backtracking in `OutputWriter`

Area:

- [packages/core/src/tree/util/print.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/util/print.ts)
- [packages/core/src/tree/util/serialize-helper.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/util/serialize-helper.ts)
- [packages/core/src/tree/rules.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts)

Evidence:

- `getSince`, `restore`, and `capture` are hot in the CPU profile.
- one-render instrumentation:
  - `OutputWriter.capture`: `515,451`
  - `OutputWriter.getSince`: `1,064,254`
  - `OutputWriter.restore`: `522,538`
  - `OutputWriter.mark`: `1,132,616`

Hypothesis:

- serializer is still using speculative write-and-rewind too often
- large rule containers amplify this cost badly

Validation plan:

1. Count `mark`, `getSince`, `restore`, and `capture` calls per benchmark render.
2. Identify the top serializer callsites invoking rollback.
3. Separate “small formatting lookahead” from “large subtree capture”.

Success criteria:

- significant reduction in `getSince`/`restore` counts
- reduced inclusive cost of `serializeRulesContainerInternal`

## PERF-003

Title: Make `extend` selective to touched roots and touched rulesets

Area:

- [packages/core/src/tree/util/extend-roots.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend-roots.ts)
- [packages/core/src/tree/util/extend-walk.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend-walk.ts)

Evidence:

- `processExtends`, `wouldMatchNode`, and root-relationship checks are hot.
- `benchmark.less` genuinely contains many extends, so this cost is real.
- modern benchmark files are still much slower than small benchmark cases, so
  extend cost must be selective rather than globally proportional to tree size

Hypothesis:

- unaffected rulesets are still being classified or examined
- affected rulesets still trigger more selector work than necessary
- `all` extends may be causing broad matching surfaces

Validation plan:

1. Count how many total rulesets enter `processExtends`.
2. Count how many actually receive a changed selector.
3. Count how many instructions are tested per ruleset.
4. Split timing between local matches, crossing matches, and no-op scans.

Success criteria:

- untouched rulesets incur near-zero extend work
- touched rulesets only run bounded matching logic

## PERF-004

Title: Eliminate remaining hot-path clone/materialize work in extend/selector flows

Area:

- [packages/core/src/tree/util/extend.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/util/extend.ts)
- [packages/core/src/tree/selector.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/selector.ts)
- [packages/core/src/tree/ampersand.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/ampersand.ts)
- [packages/core/src/tree/node-base.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/node-base.ts)

Evidence:

- `Node`, `clone`, `copy`, `cloneValue`, `inherit`, and `adopt` all appear
  meaningfully in the benchmark profile.
- one-render instrumentation:
  - `Node.clone`: `92,683`
  - `Node.copy`: `73,607`

Hypothesis:

- selector rewriting still allocates too many detached/safe-copy structures
- clone pressure compounds with extend and serialization costs
- the large regression from pre-fork `~1.6x` to current `36x-46x` strongly
  implicates copy/materialization-heavy runtime architecture

Validation plan:

1. Count `clone`, `copy`, and `cloneValue` invocations during one benchmark render.
2. Attribute counts to calling subsystems.
3. Identify top clone-producing callsites in extend and selector composition.

Success criteria:

- clone/copy counts materially reduced
- inclusive cost of node construction and clone helpers drops in the profile

## PERF-005

Title: Audit repeated `originatesFromReferenceImport` checks during serialization

Area:

- [packages/core/src/tree/util/serialize-helper.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/util/serialize-helper.ts)

Evidence:

- `originatesFromReferenceImport` is hotter than expected in a benchmark that is
  not primarily about import-reference behavior.
- one-render instrumentation:
  - `Context.getTree`: `2`
  - `LessParser.parse`: `3`
  - imported files each loaded once in the measured benchmark render

Hypothesis:

- import-origin behavior is being recomputed during generic serialization when it
  should instead be represented as explicit entry/exit state on the active
  wrapper/path
- any ancestry walk for "did this come from a reference import?" during hot-path
  serialization is already the wrong architectural shape
- reference-import trees may also be getting reloaded or re-parsed more often
  than intended, which would compound the cost and make the repeated origin
  checks more visible than they should be

Validation plan:

1. Count calls per benchmark render.
2. Identify the dominant serializer callsites.
3. Verify whether the check is ancestry-based instead of state-based.
4. Count `getTree` / parse activity for imported files during one benchmark
   render.
5. Verify that reference imports are cached as trees and reused rather than
   reparsed.

Success criteria:

- no ancestry-walk reference-import checks on the hot serialization path
- explicit push/pop or equivalent direct state representation instead
- reduced serializer inclusive cost
- proof that reference imports are not being re-parsed on the hot path

## PERF-006

Title: Measure Less compat proxy overhead separately from core runtime cost

Area:

- [packages/jess-plugin-less-compat/src/transform/proxy.ts](/Users/matthew/git/oss/jess/packages/jess-plugin-less-compat/src/transform/proxy.ts)

Evidence:

- `createLessProxy` appears in the CPU profile.
- user architecture requirement:
  - less-compat should be zero-cost unless `@plugin` or another compat-only
    path is actually used
  - even then, proxy creation should stay lazy until a visitor actually asks
    for a Less-style AST node

Hypothesis:

- the Less compat layer should be zero-cost unless plugin compatibility is
  actually needed
- even when `@plugin` or another compat-requiring path is present, proxy
  creation should remain lazy until a visitor actually requests a Less-style AST
  node
- current measured proxy cost may indicate eager proxy creation or proxy work
  happening outside true demand paths

Validation plan:

1. Measure benchmark path with and without compat/proxy layer where possible.
2. Count proxy creations per render.
3. Separate facade cost from core runtime cost.
4. Verify whether any proxy is created in renders with no `@plugin` usage.
5. Verify whether visitors are causing eager whole-tree proxy wrapping instead of
   per-node on-demand wrapping.

Success criteria:

- no measurable proxy cost in renders that do not use compat/plugin visitors
- demand-driven proxy creation only for nodes actually requested by visitors
- clear percentage attribution for remaining facade overhead

## PERF-007

Title: Build a one-render instrumentation harness for `benchmark.less`

Area:

- instrumentation script only

Evidence:

- current diagnosis is already useful, but repeated manual probing is too slow

Hypothesis:

- one dedicated instrumentation harness will speed all later perf work

Validation plan:

1. Add a local script that renders `benchmark.less` once and records counts for:
   - `find`
   - `_searchRulesChildren`
   - `processExtends`
   - `wouldMatchNode`
   - `getSince`
   - `restore`
   - `clone` / `copy`
2. Save results in a stable machine-readable form.

Success criteria:

- repeatable one-command perf counters for follow-up investigations

Current status:

- implemented in `scripts/profile-less-benchmark.mjs`
- current representative counts are now captured in the benchmark audit doc
