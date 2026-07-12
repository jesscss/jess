# Less Benchmark Performance Audit

Date: `2026-04-13`
Branch: `dev`
Commit at audit start: `55fdaf02`

## Scope

This audit covers the linked `less.js` benchmark path using the current Jess-backed
Less facade and parser stack.

Primary benchmark command:

```sh
pnpm benchmark
```

Run from:

```txt
/Users/matthew/git/oss/less.js/packages/less
```

Jess dependency build used before benchmark:

```sh
pnpm --filter jess... build
```

## Immediate Findings

The benchmark path is functional again. The parser and plugin regressions that
previously caused hard failures are fixed.

The remaining problem is performance, not correctness.

Historical context from the repo owner matters here:

- before the value-forking era, the project was roughly `1.6x` Less runtime on
  this broad benchmark path
- current behavior on the modern benchmark cases is roughly `36x` to `46x`
  slower than historical Less

So this is a major architectural regression, not ordinary optimization debt.

## Comparison Table

Historical comparison comes from:

```txt
less.js/packages/less/benchmark/results/latest/macbook-pro_arm64.json
```

Current comparison output:

| File | Jess avg | Less 4.5 avg | Ratio |
|---|---:|---:|---:|
| `benchmark.less` | `1724.7ms` | `47.4ms` | `36.4x slower` |
| `benchmark-v3.less` | `1.9ms` | `2.6ms` | `0.8x` |
| `benchmark-v37.less` | `2.1ms` | `3.8ms` | `0.6x` |
| `benchmark-v39.less` | `29.1ms` | `4.6ms` | `6.3x slower` |

## Interpretation

This is not a uniform slowdown across all benchmark shapes.

- Older/smaller benchmark cases are competitive or faster.
- Modern benchmark cases are much slower.
- `benchmark.less` is the catastrophic outlier.
- `benchmark-v39.less` is the secondary modern outlier.

That strongly suggests a cost center tied to modern Less features used in those
benchmarks, not a flat parser or serializer tax on all inputs.

## Benchmark Content Notes

`benchmark.less` is not extend-free. It contains multiple `:extend(...)` sites,
including several `all` extends. A quick scan found roughly two dozen extend
uses concentrated in the latter portion of the file.

So `extend` cost showing up in profiles is not spurious. However, it still needs
to be proportional to the touched rulesets, not to the whole tree.

## CPU Profile Evidence

Profile command used:

```sh
node --cpu-prof --cpu-prof-dir=/tmp --cpu-prof-name=less-bench.cpuprofile \
  benchmark/benchmark-runner.cjs benchmark/benchmark.less 4 1 --math=always
```

Profile artifact:

```txt
/tmp/less-bench.cpuprofile
```

Sampled render timing in that profile run:

- `avg: 1995.54ms`
- `median: 1988.99ms`

## One-Render Instrumentation Evidence

Instrumentation script:

```txt
scripts/profile-less-benchmark.mjs
```

Representative one-render output:

- `elapsedMs: 2466.69`
- `getTreeCalls: 2`
- `getTreeCacheHits: 0`
- `getTreeCacheMisses: 2`
- `parseCalls: 3`
- imported files loaded once each:
  - `benchmark-import-target.less`
  - `benchmark-import-reference-target.less`

Top counted operations from one real render:

| Metric | Count | Total time |
|---|---:|---:|
| `Rules.find` | `301,333` | `3559.06ms` |
| `DeclarationRegistry.find` | `260,728` | `2885.94ms` |
| `OutputWriter.capture` | `515,451` | `1588.27ms` |
| `MixinRegistry.find` | `37,314` | `583.60ms` |
| `Node.clone` | `92,683` | `565.53ms` |
| `Node.copy` | `73,607` | `413.14ms` |
| `OutputWriter.getSince` | `1,064,254` | `177.27ms` |
| `OutputWriter.restore` | `522,538` | `114.28ms` |
| `LessParser.parse` | `3` | `112.27ms` |
| `OutputWriter.mark` | `1,132,616` | `37.77ms` |
| `DeclarationRegistry.indexPendingItems` | `279,848` | `28.53ms` |
| `Context.getTree` | `2` | `26.76ms` |

Interpretation of the instrumentation output:

- imports are not being catastrophically re-parsed in this benchmark
- lookup churn is extreme
- serializer capture and rollback churn is extreme
- clone/copy churn is still large
- the hot path is dominated by runtime architecture, not parser time

## Highest-Signal Hot Functions

Top inclusive Jess-side hotspots from the CPU profile:

| Function | Package area | Notes |
|---|---|---|
| `find` | `packages/core/src/tree/util/registry-utils.ts` | Repeated declaration/function/mixin lookup |
| `_searchRulesChildren` | `packages/core/src/tree/util/registry-utils.ts` | Child-scope search path |
| `getSince` | `packages/core/src/tree/util/print.ts` | Serializer backtracking |
| `restore` | `packages/core/src/tree/util/print.ts` | Serializer rollback |
| `Node` | `packages/core/src/tree/node-base.ts` | Object churn / node construction |
| `clone` / `copy` / `cloneValue` | `packages/core/src/tree/node-base.ts` and related nodes | Cloning still present in hot paths |
| `processExtends` | `packages/core/src/tree/util/extend-roots.ts` | Extend root orchestration |
| `wouldMatchNode` | `packages/core/src/tree/util/extend-walk.ts` | Extend matching |
| `serializeRulesContainerInternal` | `packages/core/src/tree/util/serialize-helper.ts` | General rule serialization |
| `originatesFromReferenceImport` | `packages/core/src/tree/util/serialize-helper.ts` path | Repeated import-origin checks during serialization |
| `createLessProxy` | `packages/jess-plugin-less-compat/src/transform/proxy.ts` | Less facade/proxy overhead |

## Main Diagnosis

The slowdown is not one single function. It is a combined cost from four
subsystems:

### 1. Lookup churn

`find` and `_searchRulesChildren` are hotter than they should be.

This suggests one or more of:

- repeated lookup of the same names in the same scope chain
- child search work happening too broadly
- registry indexing not being reused effectively
- extend or eval paths triggering repeated tree searches instead of direct access

The one-render harness makes this concrete:

- `Rules.find`: `301,333` calls
- `DeclarationRegistry.find`: `260,728` calls
- `MixinRegistry.find`: `37,314` calls
- `DeclarationRegistry.indexPendingItems`: `279,848` calls

### 2. Serializer backtracking churn

`getSince` and `restore` are hot because the output writer is frequently asked to:

1. write speculative output
2. inspect the emitted substring
3. rewind and retry

This is not free. On a large benchmark it becomes a serious tax.

The one-render harness makes this concrete:

- `OutputWriter.capture`: `515,451` calls
- `OutputWriter.getSince`: `1,064,254` calls
- `OutputWriter.restore`: `522,538` calls
- `OutputWriter.mark`: `1,132,616` calls

### 3. Clone / object churn

`Node`, `clone`, `copy`, `cloneValue`, `inherit`, and `adopt` all show up in the
profile. Clone/materialization pressure has been reduced, but it is not gone.

This matters because modern Less benchmark paths combine:

- large trees
- extend rewriting
- selector composition
- serialization

All of which amplify clone churn.

The one-render harness makes this concrete:

- `Node.clone`: `92,683` calls
- `Node.copy`: `73,607` calls

### 4. Extend cost

`processExtends`, `wouldMatchNode`, and related root-check helpers are clearly
hot.

`extend` is a real feature in `benchmark.less`, so some cost is expected. But
the current profile is consistent with the user concern:

- too much work on rulesets that should be unaffected
- too much work per actually affected ruleset

## What Was Fixed Before This Audit

These were correctness/runtime blockers and are no longer the main issue:

- nested qualified-rule ambiguity in Less parsing
  - shared gate now lives in `packages/css-parser/src/cssRecursiveParser.ts`
- Less slash parsing for obvious non-division cases
  - `small/20px` now parses as slash-list, not arithmetic
- color-keyword division under `mathMode: 'always'`
  - `red/2` remains arithmetic-capable
- Less plugin parse-time config propagation
  - `@jesscss/plugin-less` now passes parser-relevant options such as `mathMode`

Those fixes restored benchmark execution, but they did not solve the core
performance problem.

## Architectural Reading

The dominant issue is not parser cost.

The dominant issue is eval + lookup + serialization work in `core`, with extend
as one of the heavier contributors.

In particular:

- modern benchmarks activate expensive runtime behavior
- small older benchmarks do not
- therefore the biggest wins are likely in runtime selectivity, lookup caching,
  and output/backtracking reduction
- the pre-fork `~1.6x` context strongly suggests the value-forking era and
  related copy/materialization machinery remain prime suspects until proven
  otherwise

## Recommended Order

1. Reduce registry lookup churn.
2. Reduce serializer backtracking.
3. Make extend selective to touched roots/rulesets only.
4. Remove remaining hot-path clone/materialize seams in extend/selector work.
5. Re-check Less facade overhead after the above, because the proxy path is
   probably secondary rather than primary.

## Related Ticket File

See:

```txt
docs/future/performance/2026-04-13-less-benchmark-investigation-tickets.md
```
