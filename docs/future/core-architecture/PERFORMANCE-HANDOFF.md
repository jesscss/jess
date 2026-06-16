# Core Architecture Performance Handoff

This file is the benchmark/profile doctrine and evidence log for Jess core
architecture work.

Use `HANDOFF.md` for active integration: current mode, next pass, and the
specific benchmark leash applied to the queue. Use
`AGGRESSIVE-CUTTING-REVIEW.md` for the hardline cutting doctrine. Use this file
for benchmark protocol, measured targets, rejected experiments, historical
evidence, active performance queues, and reactivation thresholds.

Current mode: **benchmark leash for node serialization completion**. Performance
is active as a gate, not as the queue and not as an alternate focus. The active
handoff currently chooses unfinished `writeSyntax(...)` / `render(...)` /
public string wrapper node families from `NODE-REWRITE-TRACKER.md`; this file
supplies the benchmark and profile rules that decide whether a hot-path patch
is kept, reshaped, or reverted.

## Preserved Lesson

Historical transition docs were removed from the working tree. The durable
lesson they preserved remains: the target is still one canonical source tree,
explicit live lookup/binding state, source-order render/eval, temporary output
state, and no routine copied evaluated AST.

## Historical Evidence To Preserve

The April 2026 broad Less benchmark audit found a real architectural
regression, not a small constant-factor problem:

- owner context at the time: before the value-forking era, Jess was roughly
  `1.6x` Less runtime on the broad benchmark path;
- April comparison: modern benchmark cases were roughly `36x` to `46x` slower
  than Less;
- `benchmark.less`: Jess `1724.7ms` avg vs Less `47.4ms` avg;
- `benchmark-v39.less`: Jess `29.1ms` avg vs Less `4.6ms` avg;
- older/smaller fixtures were competitive or faster, so the slowdown was tied
  to modern Less features and runtime architecture, not a universal parser or
  serializer tax.

Representative one-render instrumentation for broad `benchmark.less` showed:

- `Rules.find`: `301,333` calls;
- `DeclarationRegistry.find`: `260,728` calls;
- `Reference.evalNode`: `12,037` calls;
- `OutputWriter.capture`: `515,451` calls;
- `OutputWriter.getSince`: `1,064,254` calls;
- `OutputWriter.restore`: `522,538` calls;
- `OutputWriter.mark`: `1,132,616` calls;
- `Node.clone`: `92,683` calls;
- `Node.copy`: `73,607` calls.

The registry audit also found extremely hot declaration keys, especially
lexical globals and recursive mixin/loop variables:

- `base-hue`: `93,810`;
- `icon-prefix`: `28,920`;
- `i`: `28,853`;
- `base-url`: `27,580`;
- `white`: `17,444`;
- `cols`: `11,745`.

Carry this forward as the performance thesis:

- lookup must become direct frame/binding access for hot reference types;
- declaration lookup must not allocate `Set`s, convert to arrays, sort, and
  repeat generic recursive searches for ordinary variable reads;
- writer capture/rollback must not stringify or slice output just to inspect
  then throw away the result;
- copy/clone/inherit/frozen must not be routine eval/render isolation;
- extend work must be selective to touched roots/rulesets and avoid repeated
  full-tree searches, selector stringification, and cloned selector structures.

## Current Policy

Performance is active as a leash on node serialization cutting. Do not select
standalone selector/equality cleanup, callback rewrites, micro-performance
rounds, lookup redesign, binding-index work, or copy/materialization cleanup
while the handoff is in `writeSyntax` mode. The only active focus is completing
node serialization rows. The next broad eval/render/lookup/copy/rules/render
buffer change must start from a current benchmark or profile target and end
with the same benchmark/profile rerun, but benchmark evidence cannot switch the
queue focus by itself.

In benchmark-leashed cutting mode:

- keep the aggressive-cutting posture: delete machinery and semantic reasons
  for work rather than polishing helpers;
- run focused tests and full gates before claiming behavior progress;
- run stable hot-path benchmarks before and after non-trivial hot-path edits;
- use profiler/counter/CPU-profile evidence to choose targets, not to claim
  "Jess got faster";
- do not claim speed wins without real benchmark evidence;
- reject or reshape changes that reduce local object counts but slow or fail
  to improve the real benchmark, unless the change fixes correctness and the
  regression is explicitly accepted as debt.

## Reactivation Threshold

Full performance rounds are currently active. If future work parks performance
again, bring full performance rounds back as active work when any one of these
is true:

1. A broad architecture batch touches one of the measured hot surfaces:
   reference lookup/render, callable output/body placement, rules/ruleset body
   rendering, at-rule header/body rendering, extend matching, parser/compat
   facade, `OutputWriter`, `Node` traversal, `clone/copy/inherit/frozen`, or
   `List`/`Sequence` materialization.
2. Two consecutive queue passes land without removing obvious hot-path object
   creation/function-call/generator/Array-helper waste.
3. The full alpha/correctness queue is clear and the next proposed work is a
   performance-motivated rewrite rather than a local deletion.
4. `pnpm run measure:less:hotpath` shows a median regression of roughly **10% or
   more** on any primary fixture, or a consistent smaller regression across two
   consecutive samples.
5. A CPU/V8 profile shows a concrete top-frame surface whose fix is not a small
   local cleanup.

Once reactivated, do not do unmeasured performance work. Every performance
round needs a before snapshot, one hypothesis, one patch, focused tests, the
same after snapshot, and a keep/revert decision.

## Required Real Benchmark Inputs

Record Jess alpha hot-path snapshots:

```sh
pnpm run measure:less:hotpath -- --stable
```

Treat the printed `signal=` field as the benchmark trust gate. `usable` can
support a keep/revert decision, `unstable` needs another run or CPU/allocation
profile corroboration, and `noisy` is not decision-quality evidence.

For quick smoke checks during cutting, the cheaper bounded run is still useful
as a regression tripwire:

```sh
pnpm run measure:less:hotpath -- --iterations 15 --warmup 5
```

Use saved hot-path fixture comparisons when keeping a patch:

```sh
pnpm run measure:less:hotpath:record -- --stable --note "<short hypothesis/result>"
```

The broad Less benchmark fixture can still be inspected when
`/Users/matthew/git/oss/less.js` is available:

```sh
node scripts/profile-less-benchmark.mjs --file=benchmark.less
```

## Required Profile Inputs

Build the relevant packages before profiling:

```sh
pnpm --filter @jesscss/core build
pnpm --filter @jesscss/less-parser build
pnpm --filter @jesscss/plugin-less build
pnpm --filter @jesscss/plugin-less-compat build
pnpm --filter jess build
```

Use profiler/counter runs for diagnosis, not user-facing speed claims:

```sh
node scripts/profile-less-benchmark.mjs --file=benchmark-v37.less
node scripts/profile-less-benchmark.mjs --file=benchmark-v39.less
node scripts/profile-less-benchmark.mjs --file=benchmark-color-stress.less
node scripts/profile-less-benchmark.mjs --file=benchmark.less
```

Use CPU profiles when call stacks are unclear:

```sh
./scripts/profile-test.sh core "<test-file-or-filter>"
./scripts/profile-test.sh jess "<test-file-or-filter>"
```

Use phase timing only as diagnostic support:

```sh
JESS_PROFILE=1 node scripts/profile-less-benchmark.mjs --file=benchmark-v37.less
```

## Evidence Rules

- **Real benchmark** numbers are the only numbers that count as "Jess got
  faster/slower".
- **Instrumented profiler** numbers are diagnostic counters/timings only.
- **CPU profile** sample counts identify hot stacks; they are not benchmark
  timings.
- Static node/object audits are supporting evidence only.

If a patch reduces local object counts but slows real benchmarks, reject or
reshape it.

## Current Evidence Log

### 2026-06-16 Interpolated Scalar Whole-Selector Cut

Hypothesis: whole-selector interpolation with an owned scalar token replacement
should not call the replacement public string API before constructing the
selector materialization.

Patch shape:

- `Interpolated.createSelector(...)` reads direct scalar token text for
  `Any`/`Anonymous`/`Keyword` replacements in the whole-selector interpolation
  path;
- non-scalar selector/generic materialization stays on the existing path;
- a focused test proves the scalar path does not call replacement
  `toTrimmedString(...)`.

Evidence:

- focused red/green proof: `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/interpolated.test.ts --run -t "creates scalar
  whole-selector interpolations without public string transport"` failed on
  replacement `toTrimmedString(...)` before the cut and passed after;
- focused suites: `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/interpolated.test.ts
  src/tree/__tests__/selector-interpolated.test.ts --run` passed;
- core build: `pnpm --filter @jesscss/core build` passed with the known
  `src/tree/js-expr.ts` direct-eval warning;
- hotpath leash: `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` passed. Results are tripwire-only, not a speed claim:
  `functions.less` median 14.88ms unstable, `import-reference.less` median
  24.97ms noisy, `mixins-guards.less` median 40.70ms noisy,
  `extend-chaining.less` median 5.89ms noisy, `media.less` median 5.93ms
  unstable.

### 2026-06-16 Call Stylesheet Func Arg Surface Cut

Hypothesis: stylesheet `Func` calls should not pre-evaluate call args into a
replacement `List` before handing them to the callable binding evaluator, which
already owns arg evaluation and binding copies.

Patch shape:

- `Call.renderDynamicFunctionOutput(...)` and `Call.evalFromStateInFrame(...)`
  pass source args directly to `Func.evalCall(...)`;
- `Func.evalCall(...)` accepts an optional arg list and forwards
  `args?.value` or a shared readonly empty arg array to
  `evaluateCallableCollection(...)`;
- a focused test proves a stylesheet function arg container is constructed once
  for the callable binding surface instead of twice.

Evidence:

- focused red/green proof: `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/call.test.ts --run -t "passes stylesheet function args
  through the callable binding surface once"` failed at `2` constructed copies
  before the cut and passed after;
- focused suites: `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/call.test.ts src/tree/__tests__/func.test.ts --run`
  passed;
- core build: `pnpm --filter @jesscss/core build` passed with the known
  `src/tree/js-expr.ts` direct-eval warning;
- hotpath leash: `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` passed. Results are tripwire-only, not a speed claim:
  `functions.less` median 18.96ms noisy, `import-reference.less` median
  24.49ms usable, `mixins-guards.less` median 18.61ms usable,
  `extend-chaining.less` median 6.11ms usable, `media.less` median 6.35ms
  unstable.

### 2026-06-15 QueryCondition Static Contract Probe Cut

Hypothesis: `QueryCondition` static child render should not rediscover the
child class contract with `Object.getPrototypeOf(...)` on every static sibling.

Patch shape:

- `renderQueryConditionValue(...)` and `renderQueryConditionValueRest(...)`
  use explicit scalar type/prototype contracts for `Any`/`Anonymous`/`Keyword`,
  `Bool`, `Dimension`/`Num`, and `Color`;
- custom render overrides still use the existing write-vs-return mark fallback;
- an attempted `Call.evalArgNodes(...)` empty-list reuse was rejected by focused
  tests because empty arg lists still carry source-call parent identity.

Evidence:

- focused tests: `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/query-condition.test.ts src/tree/__tests__/call.test.ts
  --run` passed;
- hotpath leash: `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` passed. Results were tripwire-only, not a speed claim:
  `functions.less` median 14.98ms usable, `import-reference.less` median
  19.92ms usable, `mixins-guards.less` median 16.58ms usable,
  `extend-chaining.less` median 5.15ms usable, `media.less` median 5.07ms
  unstable.

### 2026-06-15 Call Scalar Direct-Type Classifier Pass

Hypothesis: the accepted scalar-argument fast path should not pay the generic
`isNode(...bitmask...)` classifier when the owned node `type` tag is enough.

Patch shape:

- `Call.serializeRenderedArgsFrom(...)` and `Call.writeEvaluatedSyntax(...)`
  now check `Num`/`Dimension`/`Color`/`Bool` with direct `type` comparisons;
- no new helper, traversal, node, materialized value, or metadata mutation was
  added;
- the active handoff queue was refreshed to exactly 15 unchecked sizable
  `writeSyntax`-focus tasks.

Evidence:

- focused test: `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/call.test.ts --run` passed;
- hotpath leash: `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` passed. Results were tripwire-only, not a speed claim:
  `functions.less` median 14.94ms usable, `import-reference.less` median
  22.00ms noisy, `mixins-guards.less` median 17.06ms usable,
  `extend-chaining.less` median 5.89ms usable, `media.less` median 5.88ms
  usable.

### 2026-06-15 Call Scalar Argument Trim/Eval Skip

Hypothesis: common scalar CSS call args already have a direct writer contract,
so they should not pay an evaluated trim window or immediate eval call when no
trivia is active and base `Node.eval` is intact.

Patch shape:

- `Call.serializeRenderedArgsFrom(...)` writes `Num`, `Dimension`, `Color`, and
  `Bool` args directly on the no-trivia/base-eval path;
- `Call.writeEvaluatedSyntax(...)` uses the same scalar-contract direct writer
  before falling back to `evalImmediateSync(...)`;
- the broader `F_STATIC` shortcut was rejected by tests because API-mutated
  static nodes can evaluate to different output.

Evidence:

- focused test: `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/call.test.ts --run` passed;
- hotpath leash: `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` passed. Results were tripwire-only, not a speed claim:
  `functions.less` median 16.82ms unstable, `import-reference.less` median
  24.16ms usable, `mixins-guards.less` median 20.05ms unstable,
  `extend-chaining.less` median 6.07ms usable, `media.less` median 5.97ms
  unstable.

### 2026-06-15 Call Plain Buffer Mark Reuse Pass

Hypothesis: plain/evaluated CSS-call buffer render already owns a buffer writer
mark, so `renderPlainFunctionCall(...)` should reuse it instead of opening a
nested whole-call mark/readback window.

Patch shape:

- `renderPlainFunctionCall(...)` accepts an optional mark for buffer callers;
- plain/evaluated CSS-call buffer render passes the buffer mark through to the
  whole-call renderer;
- focused tests prove shared flat-buffer render has one call-level readback;
- per-argument trim marks remain visible and are not claimed as fixed.

Evidence:

- focused test: `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/call.test.ts --run` passed;
- hotpath leash: `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` passed. Results were tripwire-only, not a speed claim:
  `functions.less` median 15.19ms unstable, `import-reference.less` median
  24.96ms usable, `mixins-guards.less` median 16.78ms usable,
  `extend-chaining.less` median 6.22ms noisy, `media.less` median 5.87ms
  unstable.

### 2026-06-15 QueryCondition Static Class-Contract Probe Cut

Hypothesis: the previous static-sibling QueryCondition cut was too narrow
because it only trusted `Node.prototype.render`. Static scalar subclasses such
as `Any` own direct render methods, so they were still paying dynamic
write-vs-return probe marks in sync and async-capable query-condition render.

Patch shape:

- static children now write syntax directly when their render method still
  matches their class prototype render contract;
- per-instance/custom render overrides stay on the fallback because tests prove
  they may return text without writing;
- a sync dynamic test now proves static siblings are not probed, alongside the
  existing async sibling proof.

Evidence:

- focused test: `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/query-condition.test.ts --run` passed;
- core build passed;
- quick bounded hotpath leash: `pnpm run measure:less:hotpath --
  --iterations 15 --warmup 5` completed with mixed signal only. Usable
  medians: `functions` `16.13ms`, `import-reference` `22.74ms`,
  `mixins-guards` `17.47ms`, `extend-chaining` `5.85ms`. Unstable median:
  `media` `5.84ms`. Treat this as a regression tripwire only, not a speed
  claim or keep/revert-quality stable benchmark.

### 2026-06-15 List Sequence Active Trivia Child Transport Pass

Hypothesis: `List` and `Sequence` source syntax should not call child public
`toString(...)` just because trivia exists. The needed behavior is only
leading-trivia emission plus direct child syntax writing.

Patch shape:

- added `emitNodeSourceSyntaxWithTrivia(...)` in `tree/util/trivia.ts`;
- replaced active-trivia child `toString(...)` calls in `List` and `Sequence`
  with direct trivia-aware `writeSyntax(...)`;
- focused tests prove active-trivia output stays unchanged while child
  `toString(...)` overrides are not called.

Evidence:

- focused tests: `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/list.test.ts src/tree/__tests__/sequence.test.ts --run`
  passed;
- core build passed;
- quick bounded hotpath leash: `pnpm run measure:less:hotpath --
  --iterations 15 --warmup 5` completed with mixed signal only. Usable
  medians: `import-reference` `20.89ms`, `mixins-guards` `17.66ms`,
  `extend-chaining` `6.52ms`. Unstable medians: `functions` `14.26ms`,
  `media` `6.56ms`. Treat this as a regression tripwire only, not a speed
  claim or keep/revert-quality stable benchmark.

### 2026-06-15 List Sequence Dynamic Buffer Mark Reuse Pass

Hypothesis: `List` and `Sequence` dynamic flat-buffer render already write
through the direct child-render loop, so the buffer wrapper should reuse that
same writer mark instead of opening an outer mark/readback window around the
inner direct-render readback.

Patch shape:

- `List` direct dynamic render accepts an existing writer mark when the caller
  is a render buffer and reuses it for `writePreparedRenderText(...)`;
- `Sequence` direct dynamic render does the same for sync and async-capable
  paths;
- shared flat-buffer tests prove dynamic `List` and `Sequence` render use one
  mark/read window for the family-level wrapper;
- the analogous `QueryCondition` change was tried and rejected because dynamic
  child render still has a per-child write-vs-return probe contract.

Evidence:

- focused tests: `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/list.test.ts src/tree/__tests__/sequence.test.ts --run`
  passed;
- core build passed;
- quick bounded hotpath leash: `pnpm run measure:less:hotpath --
  --iterations 15 --warmup 5` completed with mixed signal only. Usable
  medians: `import-reference` `21.87ms`, `mixins-guards` `16.69ms`, `media`
  `5.53ms`. Unstable medians: `functions` `16.51ms`, `extend-chaining`
  `5.76ms`. Treat this as a regression tripwire only, not a speed claim or
  keep/revert-quality stable benchmark.

### 2026-06-14 Block Paren Quoted Attribute Known-Wrapper Render Pass

Hypothesis: known wrapper render output should write or buffer final text
directly instead of preparing writer state and reading it back. This applies
only when the wrapper text is already known and no child/trivia work is needed.

Patch shape:

- nil `Block` render writes/buffers known curly or square delimiter text
  directly when authored trivia is not active;
- empty/nil `Paren` render writes/buffers known paren, square, or escaped
  delimiter text directly when trivia is not active;
- non-escaped literal `Quoted` render writes/buffers the quoted scalar directly;
- bare string-name `AttributeSelector` render writes/buffers `[name]`
  directly;
- dynamic children, trivia-backed syntax, escaped quoted render semantics, and
  non-bare attribute render stay on existing paths.

After patch, bounded hot-path leash:

- `functions`: `16.54ms`, `noisy`;
- `import-reference`: `25.09ms`, `unstable`;
- `mixins-guards`: `18.20ms`, `usable`;
- `extend-chaining`: `7.13ms`, `unstable`;
- `media`: `5.92ms`, `noisy`.

Broad `benchmark.less` profiler status after the patch:

- `OutputWriter.mark`: `50002`;
- `OutputWriter.getSince`: `45006`;
- `OutputWriter.restore`: `29542`;
- `Reference.evalNode`: `3619`;
- `Rules.find`: `1013`.

Decision: keep as bounded known-wrapper machinery deletion only. No speed
claim: the hot-path leash was noisy/unstable and broad profile counters stayed
on the same lookup/eval and writer surfaces.

### 2026-06-14 Call List Sequence Known-Empty Serialization Pass

Hypothesis: known-empty call/list/sequence output should return directly before
opening writer mark/getSince or render-buffer mark setup. This deletes
serialization scaffolding for scalar-empty paths without changing non-empty
dynamic render contracts.

Patch shape:

- empty string-name `Call` text is shared by public stringification plus direct
  and buffer render;
- empty `List` source/render paths return known empty output before writer or
  buffer preparation;
- empty `Sequence` source/render paths return known empty output before writer
  or buffer preparation;
- no runtime nodes, arrays, copies, placement state, public API, or traversal
  were added.

After patch, bounded hot-path leash:

- `functions`: `15.38ms`, `unstable`;
- `import-reference`: `21.06ms`, `unstable`;
- `mixins-guards`: `16.40ms`, `usable`;
- `extend-chaining`: `5.83ms`, `unstable`;
- `media`: `5.71ms`, `unstable`.

Broad `benchmark.less` profiler status after the patch:

- `OutputWriter.mark`: `50002`;
- `OutputWriter.getSince`: `45006`;
- `OutputWriter.restore`: `29542`;
- `Reference.evalNode`: `3619`;
- `Rules.find`: `1013`.

Decision: keep as bounded known-output machinery deletion only. No speed claim:
the hot-path leash was mostly unstable and the broad profiler counters stayed
on the same lookup/eval and writer surfaces.

### 2026-06-14 Url Rest StyleImport Serialization Pass

Hypothesis: scalar `Url` render/context output, cold `Rest.name`, and
`StyleImport` sync render can delete string-transport or closure machinery
without adding nodes, arrays, traversal, or public API surface.

Patch shape:

- scalar `url(Any)` render/context output writes the final string directly and
  avoids writer mark/getSince/replace scaffolding;
- trivia-backed or non-scalar URL values keep the localized fallback readback;
- `Rest.name` reads node values through `valueOf()` instead of public
  `toString(...)` transport;
- `StyleImport` sync render no longer allocates a local finalizer closure;
- first-use `StyleImport` placement copies were audited and kept as existing
  semantic placement state because focused tests assert owned placement
  children and source-child mapping.

After patch, bounded hot-path leash:

- `functions`: `14.26ms`, `usable`;
- `import-reference`: `19.51ms`, `usable`;
- `mixins-guards`: `18.07ms`, `usable`;
- `extend-chaining`: `5.36ms`, `usable`;
- `media`: `6.14ms`, `noisy`.

Broad `benchmark.less` profiler status after the patch:

- `OutputWriter.mark`: `50002`;
- `OutputWriter.getSince`: `45006`;
- `OutputWriter.restore`: `29542`;
- `Reference.evalNode`: `3619`;
- `Rules.find`: `1013`.

Decision: keep as bounded serialization machinery deletion only. No speed
claim: the hot-path run had one noisy fixture, and broad profile counters show
this pass did not materially touch the dominant lookup/eval surfaces.

### 2026-06-14 AtRule Scalar Dynamic Leaf Readback And Key Cut

Hypothesis: dynamic leaf at-rule render should not use child
`mark/getSince/restore` readback for scalar `Any` name/prelude pieces when no
trivia is active. These nodes already own the exact text needed for the final
leaf string.

Patch shape:

- `renderLeafNodeToString(...)` returns `Any.value` directly when no trivia is
  active;
- `AtRule.valueOf()` reads `name.valueOf()` instead of public
  `name.toString()`;
- complex or trivia-backed leaf pieces stay on the existing readback path;
- focused AtRule tests count marks, reads, restores, captures, and previews for
  a dynamic scalar `@namespace` leaf path and prove `AtRule.valueOf()` does not
  call public name string transport;
- no runtime node, helper, array, cache, side map, copy, or public API was
  added.

After final patch, bounded hot-path leash:

- `functions`: `14.42ms`, `unstable`;
- `import-reference`: `19.88ms`, `usable`;
- `mixins-guards`: `16.97ms`, `usable`;
- `extend-chaining`: `5.47ms`, `usable`;
- `media`: `5.84ms`, `usable`.

Broad `benchmark.less` profiler status after the patch:

- `OutputWriter.mark`: `50044`;
- `OutputWriter.getSince`: `45048`;
- `Reference.evalNode`: `3619`;
- `Rules.find`: `1013`.

Decision: keep as focused serialization machinery deletion only. No speed
claim: one bounded fixture stayed unstable and the broad profiler counters did
not move.

### 2026-06-14 QueryCondition Async Static-Sibling Probe Cut

Hypothesis: `QueryCondition` async-capable render should not force static
base-render siblings through the dynamic child fallback just because another
child may be async. The remaining fallback should also use the writer's
existing content check instead of opening a second `mark()` just to ask whether
the child wrote output.

Patch shape:

- static children whose render method is the base `Node.render` contract now
  write syntax directly inside async-capable `QueryCondition` render;
- instance-owned/custom child render overrides still use the fallback because
  tests prove they may return text without writing;
- fallback output checks changed from `w.mark() === before` to
  `!w.hasContentSince(before)`;
- no node, array, helper, side map, cache, copy, or public API was added.

Before patch, bounded hot-path leash:

- `functions`: `14.33ms`, `usable`;
- `import-reference`: `19.05ms`, `unstable`;
- `mixins-guards`: `16.06ms`, `usable`;
- `extend-chaining`: `5.47ms`, `unstable`;
- `media`: `5.51ms`, `usable`.

After patch, bounded hot-path leash:

- `functions`: `15.35ms`, `unstable`;
- `import-reference`: `22.21ms`, `unstable`;
- `mixins-guards`: `17.09ms`, `usable`;
- `extend-chaining`: `5.56ms`, `unstable`;
- `media`: `5.28ms`, `usable`.

Broad `benchmark.less` profiler status after the patch:

- `OutputWriter.mark`: `50044`;
- `OutputWriter.getSince`: `45048`;
- `Reference.evalNode`: `3619`;
- `Rules.find`: `1013`.

Decision: keep as focused serialization machinery deletion only. No speed
claim: the bounded run was noisy/unstable for several fixtures, and the broad
profiler counters did not move, which suggests the broad fixture does not
exercise this specific async QueryCondition sibling path.

### 2026-06-14 Rejected Selector Remainder-Factory Loop Cut

Hypothesis: `trySmallCompoundExtendMatch(...)` should avoid callback closures
in subset detection and remainder construction by using indexed loops, and
avoid allocating a remainder array when there are no remainders.

Patch shape tested:

- replaced `find.value.every(... target.value.some(...))` with nested loops;
- replaced `target.value.filter(... find.value.some(...))` with a lazy
  remainder array pushed only for unmatched components;
- no helper, public API, selector cache, side map, or new selector creation
  boundary was added beyond existing semantic remainder construction.

Focused proof during attempt:

- `pnpm --filter @jesscss/core test -- selector-match-unit`;
- `pnpm --filter @jesscss/core test -- selector-compare`;
- `pnpm --filter @jesscss/core test -- process-extends`;
- `pnpm --filter @jesscss/core test -- extend-eval-integration`;
- `pnpm --filter @jesscss/core build`.

Before patch, bounded hot-path leash:

- `functions`: `14.56ms`, `usable`;
- `import-reference`: `19.97ms`, `usable`;
- `mixins-guards`: `17.08ms`, `usable`;
- `extend-chaining`: `5.65ms`, `usable`;
- `media`: `5.56ms`, `unstable`.

After patch, first bounded run:

- `functions`: `15.05ms`, `unstable`;
- `import-reference`: `21.50ms`, `unstable`;
- `mixins-guards`: `17.17ms`, `usable`;
- `extend-chaining`: `5.63ms`, `usable`;
- `media`: `5.68ms`, `usable`.

Confirmatory after run:

- `functions`: `15.11ms`, `unstable`;
- `import-reference`: `22.36ms`, `usable`;
- `mixins-guards`: `16.98ms`, `usable`;
- `extend-chaining`: `5.49ms`, `usable`;
- `media`: `5.82ms`, `unstable`.

Third after run:

- `functions`: `15.00ms`, `unstable`;
- `import-reference`: `20.25ms`, `usable`;
- `mixins-guards`: `18.40ms`, `unstable`;
- `extend-chaining`: `6.21ms`, `usable`;
- `media`: `6.32ms`, `usable`.

Decision: rejected and reverted. The third run showed usable regressions on
`extend-chaining` and `media`; this exact local loop rewrite should not be
repeated without a broader structural change or profile evidence that explains
why it should win.

False assumption to preserve: this pass assumed callback removal would be a
local win because `every(...)`, `some(...)`, and `filter(...)` allocate
closures and, in the remainder case, an intermediate array. That was too
object-count-driven. The hand-written version added more explicit loop state,
extra branches, lazy-array checks, and repeated manual matching in a V8-sensitive
selector path. The benchmark says the old callback shape was not the dominant
cost, or V8 optimized it well enough that the manual rewrite lost. Do not
replace small callback predicates in this area on style/object-count intuition
alone; first prove a profile hotspot and then change the larger selector
matching shape that causes the repeated subset/remainder checks.

### 2026-06-14 Selector Equality Predicate Callback Cut

Hypothesis: common selector equality and extension-type predicates should not
pay callback closures or a temporary filtered numeric path array when straight
loops over the existing selector/path arrays express the same checks.

Before patch, bounded hot-path leash:

- `functions`: `14.41ms`, `usable`;
- `import-reference`: `21.29ms`, `usable`;
- `mixins-guards`: `17.79ms`, `unstable`;
- `extend-chaining`: `5.51ms`, `usable`;
- `media`: `5.68ms`, `unstable`.

Patch shape:

- `determineExtensionType(...)` counts `arg` and numeric path segments in one
  loop instead of `some(...)` plus `filter(...)`;
- compound/simple and simple/compound `componentsMatch(...)` paths use cached
  scalar keys plus loops instead of `some(...)`;
- selector-list argument and compound equivalence checks use nested loops
  instead of `every(...)` + `some(...)`;
- no selector nodes, side maps, caches, helpers, or public APIs were added.

After patch, first bounded run:

- `functions`: `14.85ms`, `unstable`;
- `import-reference`: `21.09ms`, `unstable`;
- `mixins-guards`: `17.62ms`, `usable`;
- `extend-chaining`: `5.57ms`, `usable`;
- `media`: `5.74ms`, `unstable`.

Confirmatory after run:

- `functions`: `14.08ms`, `unstable`;
- `import-reference`: `19.55ms`, `usable`;
- `mixins-guards`: `17.43ms`, `usable`;
- `extend-chaining`: `5.30ms`, `usable`;
- `media`: `5.19ms`, `unstable`.

Decision: keep as machinery deletion. No speed claim: the first after-run lost
some decision-quality signal, while the confirmatory run restored the usable
selector/import signals and showed no stable regression.

### 2026-06-14 Selector Extend Path-Stack Cut

Hypothesis: full recursive selector extend search should not allocate a new
path array and callback closure for every child before it knows whether a match
exists. The walk can carry one local path stack and copy only at stored match
locations.

Before patch, bounded hot-path leash:

- `functions`: `14.24ms`, `unstable`;
- `import-reference`: `20.37ms`, `usable`;
- `mixins-guards`: `19.21ms`, `usable`;
- `extend-chaining`: `5.69ms`, `usable`;
- `media`: `5.50ms`, `usable`.

Patch shape:

- selector-list, compound, complex, and pseudo-selector recursive search
  descent now uses indexed loops and `currentPath.push(...)` / `pop()`;
- stored `ExtendLocation.path` arrays still copy at match boundaries;
- no selector nodes, side maps, caches, or public API surfaces were added.

After patch:

- `functions`: `14.64ms`, `unstable`;
- `import-reference`: `20.43ms`, `usable`;
- `mixins-guards`: `16.82ms`, `usable`;
- `extend-chaining`: `5.45ms`, `usable`;
- `media`: `5.35ms`, `unstable`.

Decision: keep as machinery deletion. No speed claim: media lost
decision-quality signal, while usable fixtures did not show a regression.

### 2026-06-14 Any Compare Scalar Transport Cut

Hypothesis: compare branches that already know an operand is `Any` should read
the owned scalar value directly instead of routing that scalar through public
`toString(...)` transport. This is a machinery deletion, not a performance
claim.

Before patch, bounded hot-path leash:

- `functions`: `15.68ms`, `unstable`;
- `import-reference`: `18.57ms`, `usable`;
- `mixins-guards`: `14.49ms`, `usable`;
- `extend-chaining`: `4.88ms`, `usable`;
- `media`: `4.62ms`, `unstable`.

Patch shape:

- `Any.compare(...)` fallback normalizes `this.value` directly;
- `List.compare(...)` and `Sequence.compare(...)` normalize `other.value`
  directly in the `other.type === 'Any'` branch;
- focused tests prove these paths do not call public `Any.toString(...)` as
  transport.

After patch:

- `functions`: `12.29ms`, `unstable`;
- `import-reference`: `17.45ms`, `unstable`;
- `mixins-guards`: `14.33ms`, `usable`;
- `extend-chaining`: `4.63ms`, `usable`;
- `media`: `4.42ms`, `unstable`.

Decision: keep as machinery deletion. No speed claim: import-reference lost
decision-quality signal, and the stable-ish fixtures did not show a regression.

### 2026-06-06 ScopeFrame Callable Hit/Miss Prototype

Hypothesis: simple static callable hits, and the subset of simple misses whose
surface coverage is already known, should be represented by the active binding
frame before the older recursive callable lookup path. This should be proved
with callable/mixin/import fixtures, not by claiming a broad benchmark win,
because the current `benchmark-v39.less` diagnostic profile is dominated by
variables and JS function calls.

Before patch:

- `node scripts/profile-less-benchmark.mjs --file=benchmark-v39.less` reported
  `Reference.evalNode` `482` calls / `5.27ms` and `Rules.find` `68` calls /
  `0.42ms`;
- `lookupStats.rulesFindByType` was `{ "function": 68 }`, so there were no
  measured mixin/ruleset `Rules.find` calls in that fixture;
- quick hot-path leash
  `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5` was mixed:
  `functions` `15.31ms` unstable, `import-reference` `22.16ms` usable,
  `mixins-guards` `18.23ms` usable, `extend-chaining` `5.91ms` unstable,
  `media` `6.63ms` unstable.

Patch shape:

- `ScopeFrame.callableBucketsByName` now reuses the existing
  `Rules.mixinsByName` arrays when present; no per-callable wrapper object,
  output cache, or node copy was added;
- an empty `Map` sentinel was rejected after `audit:node-creation` showed it
  raised the static `new-node` count from `321` to `322`; the field is optional
  instead;
- `Rules.find('mixin', staticKey, ...)` checks only the current already-built
  frame for direct, non-targeted, non-local lookups. It returns covered static
  hits without entering `Rules.findMixinsFast(...)`; it does not call
  `getScopeFrame(...)` just to attempt the shortcut;
- simple static misses stop only when `callableMissesCovered` proves the
  current frame has no child callable surfaces and no reference-import callable
  surfaces;
- targeted, namespace, local/import-visibility, child-surface, and guard
  ambiguity paths remain on the bridge until those facts are encoded in binding
  state.

Evidence:

- focused `mixin.test.ts` and `scope-frame.test.ts` passed for the initial hit
  slice (`137` tests);
- new focused tests prove direct `Rules.find(...)` static `Mixin` and simple
  `Ruleset`-as-mixin hits skip `Rules.findMixinsFast(...)` when a frame
  already exists;
- new miss tests prove a direct static miss skips `Rules.findMixinsFast(...)`
  only when no child callable surfaces exist, and keeps the bridge when child
  surfaces exist;
- regression caught: a parent-frame discovery attempt caused bad `.mixin`
  misses in import-reference namespace behavior; the shortcut now refuses
  ancestor discovery and targeted/local lookup;
- final focused callable/import gate passed (`162` tests; `78` skipped by
  filter);
- `@jesscss/core` build passed;
- post-miss `node scripts/profile-less-benchmark.mjs --file=benchmark-v39.less`
  reported `Reference.evalNode` `482` calls / `4.80ms` and `Rules.find` `68`
  calls / `0.34ms`; `Rules.find` remained only function lookup in this
  fixture, so this is diagnostic status, not a broad speed claim;
- post-miss quick hot-path leash
  `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5` reported
  `functions` `12.91ms` usable, `import-reference` `17.56ms` usable,
  `mixins-guards` `15.43ms` usable, `extend-chaining` `5.07ms` unstable, and
  `media` `5.34ms` usable;
- post-miss `pnpm run audit:node-creation` reported `new-node: 321`,
  `with-surface: 33`, `derive: 30`, `copy-leaves: 28`.

Verdict: keep as binding integration progress only. Do not claim a broad speed
win from this slice. The next callable binding target is representing
targeted/namespace/import/child-surface callable facts in binding state so those
bridges can be deleted without ancestor walks or generic registry rediscovery.

### 2026-06-05 Callable Default-Guard Classification

Hypothesis: `prepareCallableEvalCandidates(...)` should not recursively inspect
candidate guards to rediscover `default()`. The parser already knows whether a
guard contains `default()` while parsing Less guard syntax, so parsed Less must
carry explicit `hasDefault: true | false`; direct API construction can infer
the flag once at construction/entry creation when the option is omitted.

Before patch:

- stable hot-path baseline on commit `9d3ea09467ca480fb18fe7d17418459e346b04fa`:
  `functions` median `13.74ms`, `import-reference` median `22.04ms`,
  `mixins-guards` median `74.84ms`;
- broad instrumented `benchmark.less`: `Reference.evalNode` `3619` calls /
  `94.12ms`, `Rules.find` `1013` calls / `30.26ms`, `OutputWriter.getSince`
  `149331` calls / `5.45ms`;
- CPU profile top frames included `guardContainsDefault` `313` samples,
  `copyChild` `148`, `Node` `43`, `copyCallableRulesValue` `25`,
  `findWithinScopeSurface` `19`, `findVarWithinScopeSurface` `15`,
  `copyWithReusableLeaves` `12`, and `inherit` `11`;
- node-creation audit stayed broad: `new-node` `321`, `with-surface` `36`,
  `copy-leaves` `31`, `derive` `30`.

Patch kept:

- `packages/less-parser/src/productions/root.ts` passes `hasDefault: true` or
  `hasDefault: false` for guarded Less mixins/rulesets;
- `packages/core/src/tree/util/callable-candidate.ts` trusts
  `candidate.options?.hasDefault === true` and no longer scans guard trees or
  rewrites candidate metadata in the candidate loop;
- `Mixin`/`Ruleset` constructors and `callableRulesEntry(...)` infer the flag
  only for direct/synthetic construction when the caller did not provide it.

After patch:

- stable hot-path benchmark: `functions` median `12.86ms`,
  `import-reference` median `19.78ms`, `mixins-guards` median `18.74ms`,
  `extend-chaining` median `5.30ms`, `media` median `6.46ms`; all five
  signals were `usable`;
- final CPU profile
  `profiling/core-architecture/CPU.20260605.174243.84124.0.001.cpuprofile`
  showed `guardContainsDefault = 0` samples and
  `callableGuardContainsDefault = 0` samples;
- final broad instrumented `benchmark.less`: `Reference.evalNode` `3619` calls
  / `92.71ms`, `Rules.find` `1013` calls / `30.31ms`,
  `OutputWriter.getSince` `149331` calls / `5.51ms`;
- final CPU top frames shifted to copy/ownership and lookup:
  `copyChild` `144`, `Node` `35`, `copyCallableRulesValue` `24`,
  `findVarWithinScopeSurface` `23`, `findWithinScopeSurface` `14`,
  `copyWithReusableLeaves` `11`, `constructCopy` `10`, `inherit` `9`.

Next measured target:

- Copy/ownership is now the hottest concrete stack, not guard detection.
  `copyChild` samples group under `copyValueForDerived` (`45`),
  `getHeaderString` (`42`), `callWithContext` (`28`), `ownSelector` (`28`),
  `createRegistrationState` (`22`), `evaluateReferenceValueNode` (`20`), and
  `cloneBoundValue` (`9`). Treat this as evidence of registration derivation,
  selector header rendering, JS function argument ownership, reference value
  eval, and binding clone debt, not as evidence that final CSS rendering needs
  child copying.
- Repeated callable/mixin eval is suspicious. Before more helper polish, count
  semantic mixin calls versus candidate/output evals and decide whether live
  placement/binding state can avoid repeated body evaluation or copied public
  materialization.

### 2026-06-05 Static Reference Value Copy Cut

Hypothesis: a static non-rules-like referenced value should not be copied merely
because it has source trivia or child nodes. `F_STATIC` already means the value
is inert for eval, so routine reference eval/render can reuse the canonical
static value. Rules-like values stay excluded until callable/public ownership is
handled by explicit placement/materialization state.

Before patch:

- CPU profile
  `profiling/core-architecture/CPU.20260605.175415.48626.0.001.cpuprofile`
  showed `Reference.evalNode` at `146 / 1234` samples (`11.8%`);
- `Reference.evalNode` bucket split: copy/result ownership `47` samples,
  callable lookup/mixin registry `30`, variable declaration lookup `21`,
  function/declaration registry lookup `19`, result finalization/eval value
  `16`, target/key normalization `10`, variable live binding lookup `2`;
- copy leaves included `copyChild` `26` samples. This was evidence that the
  hot reference story was not only raw `Rules.find(...)`; looked-up value
  finalization and ownership copying were a large part of the stack.

Patch kept:

- `packages/core/src/tree/reference.ts` now allows
  `canReturnReferenceValue(...)` for any `F_STATIC` non-rules-like value;
- deleted `canReturnSourceFreeReferenceContainer(...)` and
  `canRenderReferenceContainerText(...)`, removing the child scans that tried
  to re-prove source-free reusable leaves on every reference result path;
- no new traversal, node creation, parent/source mutation, `.inherit(...)`, or
  copy helper was added.

After patch:

- CPU profile
  `profiling/core-architecture/CPU.20260605.180616.3382.0.001.cpuprofile`
  showed `Reference.evalNode` at `133 / 1183` samples (`11.2%`);
- `Reference.evalNode` bucket split: copy/result ownership `26` samples,
  callable lookup/mixin registry `56`, variable declaration lookup `32`,
  function/declaration registry lookup `7`, result finalization/eval value
  `12`, target/key normalization `0`, variable live binding lookup `0`;
- top leaves were `findVarWithinScopeSurface` `17`, `copyChild` `15`,
  `findWithinScopeSurface` `12` total across two lines, and smaller
  finalization/key frames;
- hot-path sanity benchmark after this patch: `functions` median `15.18ms`,
  `import-reference` median `21.34ms`, `mixins-guards` median `18.28ms`,
  `extend-chaining` median `5.65ms`, `media` median `6.76ms` with `media`
  noisy. Compared with the prior stable snapshot (`functions` `12.86ms`,
  `import-reference` `19.78ms`, `mixins-guards` `18.74ms`,
  `extend-chaining` `5.30ms`, `media` `6.46ms`), this is mixed and not a
  speed win.

Next measured target:

- The remaining `Reference.evalNode` story is lookup plus callable output
  evaluation, not live binding lookup itself. `findVarWithinScopeSurface` is
  the top leaf, but callable/mixin evaluation owns the largest semantic bucket.
  Before adding helper polish, count semantic mixin/reference calls against
  candidate/output eval work and keep cutting copy/materialization pressure
  around the looked-up value path.

### 2026-06-05 Reference Class Surface Cut

Hypothesis: `Reference` still had method-level cruft that could be deleted
without changing semantics: alias predicate wrappers, a useless Promise identity
wrapper, and nested render closures allocated before the direct raw lookup
could decide whether a static referenced value can render immediately.

Patch kept:

- `packages/core/src/tree/reference.ts` deleted
  `canReturnReferenceValueWithoutCopy(...)` and
  `canRenderReferenceValueTextOnly(...)`, both of which only called
  `canReturnReferenceValue(...)`;
- `Reference.evalNode(...)` now returns the `MaybePromise<Node>` from
  `evaluateReferenceNode(...)` directly instead of wrapping thenables in an
  identity `.then(...)`;
- `Reference.render(...)` keeps the direct raw static-reference path in
  straight-line code instead of allocating `renderResolved`, `renderRaw`, and
  `renderThroughEvaluator` closures first;
- rules lookup options are filled directly on one `FindOptions` object instead
  of building spread fragments through `getContextualReferenceLookupStart(...)`
  and `getLiveReferenceLookupStart(...)`;
- leaky rules lookup no longer builds a temporary scope array or recursive
  local walker for `[resolvedTarget, rulesParent, sourceRulesParent]`;
- `Reference.renderReferenceSyntax(...)` moved its syntax-key emitter out of a
  per-call nested closure. The array-key loop already existed; no new traversal
  or node creation was introduced.

Evidence:

- focused Reference-family tests passed: `410` tests across
  `reference`, `mixin`, `declaration`, `ruleset`, `list`, `sequence`,
  `condition`, and `operation`;
- hot-path sanity benchmark after this patch:
  `functions` median `12.99ms`, `import-reference` median `19.67ms`,
  `mixins-guards` median `17.17ms`, `extend-chaining` median `5.09ms`
  (`unstable`), and `media` median `6.18ms`;
- this is not a speed claim because the pass did not capture a clean
  before/after pair. Treat it as a benchmark leash status line only.

Next measured target:

- Continue `Reference` before moving to the next node. The remaining target is
  the copy/materialization ownership cluster, especially rules-like reference
  value surfaces, `evaluateReferenceValueNode(...)` copy pressure, declaration
  finalization, merged assign normalization, and key evaluation/conversion.

### 2026-06-06 Reference Main Eval Lookup Surface Cut

Hypothesis: the raw render path was no longer paying eager lookup/finalizer
closures, but the main `Reference` eval/render path still allocated the same
kind of closures before ordinary synchronous lookup. This pass deletes that
setup work without changing lookup semantics or claiming a measured speed win.

Patch kept:

- `evaluateReferenceNode(...)` no longer allocates local `finishLookup`,
  `runLookup`, `resolveTargetValue`, or `evaluateKey` closures before the sync
  path can run;
- the direct static-render check is preserved for sync and async lookup
  results;
- `finalizeRuntimeVarBindingResult(...)` no longer checks
  `canReturnReferenceValue(...)` twice for the same evaluated binding;
- `evaluateReferenceValueNode(...)` folds the two source-reuse static-return
  branches into one condition.

Evidence:

- `pnpm exec eslint packages/core/src/tree/reference.ts` passed;
- `pnpm --filter @jesscss/core build` passed with the existing `js-expr.ts`
  direct-eval bundler warning;
- focused Reference/mixin tests passed after build: `226` tests;
- broader affected tests passed: `410` tests across `reference`, `mixin`,
  `declaration`, `ruleset`, `list`, `sequence`, `condition`, and `operation`;
- hot-path sanity benchmark after this patch:
  `functions` median `13.70ms`, `import-reference` median `20.68ms`,
  `mixins-guards` median `17.58ms`, `extend-chaining` median `5.69ms`, and
  `media` median `6.68ms`; all five signals were usable;
- no speed claim. This pass did not capture a clean before/after benchmark
  pair, so the benchmark is a leash sanity line only.

### 2026-06-05 Reference Raw Lookup Surface Cut

Hypothesis: `Reference` still had obvious sync-path setup work that could be
deleted before the next measured copy/materialization pass. The target was
machinery, not a measured performance claim.

Patch kept:

- `evaluateFallbackValue(...)` now relies on `canReturnReferenceValue(...)`
  directly instead of checking the same static condition in a narrower first
  branch;
- `finalizeDeclarationReferenceResult(...)` computes
  `hasImportantDeclarationValue(...)` once and reuses the value for the
  text-only return branch and declaration-value evaluation;
- `evaluateReferenceValueNode(...)` no longer contains two adjacent branches
  that both called `copyWithReusableLeaves(declValue).eval(context)`;
- rules-like callable candidates no longer re-run `isNode(...)` checks after
  the loop has already validated `Mixin | Ruleset`; overloads preserve the
  type contract without runtime classification;
- `resolveRawReferenceLookupTarget(...)` no longer allocates
  `finishLookup`, `runLookup`, `resolveTargetValue`, `evaluateKey`, or a sync
  IIFE before a normal raw lookup. The sync path is straight-line through
  initial target, key evaluation, target-value resolution, lookup, pop, and
  finalization. Async branches remain explicit.

Evidence:

- `pnpm exec eslint packages/core/src/tree/reference.ts` passed;
- `pnpm --filter @jesscss/core build` passed with the existing `js-expr.ts`
  direct-eval bundler warning;
- focused Reference/mixin tests passed after build: `226` tests;
- broader affected tests passed: `410` tests across `reference`, `mixin`,
  `declaration`, `ruleset`, `list`, `sequence`, `condition`, and `operation`;
- hot-path sanity benchmark after this patch:
  `functions` median `12.84ms` usable, `import-reference` median `37.76ms`
  noisy, `mixins-guards` median `18.41ms` unstable, `extend-chaining` median
  `5.43ms` usable, and `media` median `6.38ms` usable;
- no speed claim. This pass did not capture a clean before/after benchmark
  pair, and two benchmark signals were not usable, so the benchmark is a leash
  sanity line only.

### 2026-06-05 Reference Helper Surface Cut

Hypothesis: after the class-surface pass, `Reference` still had one-call
helpers and temporary objects that made the lookup/finalization path harder to
reason about without protecting semantics.

Patch kept:

- `findVarDeclarationFast(...)` now returns the matched node directly instead
  of a single-field `{ match }` object;
- `findVarDeclarationFast(...)` no longer allocates a per-scope IIFE result
  object to split public/optional current-scope matches;
- `resolveInitialReferenceTarget(...)` no longer allocates an IIFE to compute a
  simple runtime live-slot key;
- deleted fallback predicate wrappers, lookup adapter factories, result-kind
  classification helper/type, copy delegation wrapper, and the one-call target
  materialization wrappers;
- target materialization still preserves the existing `.inherit(...)` and
  copy/materialization semantics. This pass did not solve ownership pressure.

Evidence:

- focused Reference-family tests passed: `410` tests across
  `reference`, `mixin`, `declaration`, `ruleset`, `list`, `sequence`,
  `condition`, and `operation`;
- `pnpm --filter @jesscss/core build` passed with the existing `js-expr.ts`
  direct-eval bundler warning;
- `pnpm exec eslint packages/core/src/tree/reference.ts` passed;
- hot-path sanity benchmark after this patch:
  `functions` median `12.70ms`, `import-reference` median `18.21ms`,
  `mixins-guards` median `17.01ms`, `extend-chaining` median `5.13ms`, and
  `media` median `6.33ms`; all five signals were usable;
- no speed claim. This pass did not capture a clean before/after benchmark
  pair, so the benchmark is a leash sanity line only.

## Parked Measured Targets

Keep these targets visible when performance rounds reactivate:

- Copy recursion: `copyChild`, `constructCopy`, `copyWithReusableLeaves`,
  `copyCallableRulesValue`, callable output/body placement.
- Node construction and copied ownership: `Node` construction, `.clone()`,
  `.copy()`, `.inherit()`, `frozen`.
- Variable/reference lookup: `findVarWithinScopeSurface`,
  `findWithinScopeSurface`, `Reference.render`, `Reference.evalNode`,
  `finalizeReferenceLookupResult`.
- Render serialization: `serializeRulesContainerInternal`, `renderRulesBody`,
  `_emitRulesBody`, `emitNode`, `getHeaderString`, `OutputWriter.getSince`.
- Extend matching: `wouldMatchNode`, `processExtends`,
  `applyExtendsToSelector`, `isSameOrDescendantRoot`.
- Generic traversal/materialization: `Node.forEachNode`, `Node.children`,
  `Node.nodes`, `List.resolveItems`, `Sequence.evaluateValues`,
  generator/Array-helper/tuple-array traversal.
- Parser/compat facade overhead when benchmark profiles point above core.

## Future Research Lanes

These are not active cut-queue items. Start one only after the reactivation
threshold trips, or when a focused profile says the named surface is the next
real bottleneck.

### Null-Proto Lookup Slots

Experiment: compare hot variable-reference lookup using null-prototype string
slot tables against the current lookup containers.

Hypothesis:

- `Object.create(null)` may be faster and lighter than `Map` for hot string-key
  variable names;
- lookup should return a stable `BindingCell`, not a raw node, so live-binding
  semantics are independent of the dictionary implementation;
- explicit `parentFrame` walking should be tested before prototype-chain scope
  inheritance because it is easier to reason about for shadowing, assignment,
  import/reference visibility, mixin invocation, and Sass-style live updates.

Candidate shape:

```ts
interface ScopeFrame {
  slots: Record<string, BindingCell | undefined>;
  parent: ScopeFrame | undefined;
}

interface BindingCell {
  value: Node;
  flags: number;
  sourceDecl: Node | undefined;
  version: number;
}
```

Test variants:

1. `Map<string, BindingCell>` lookup.
2. `Object.create(null)` slots plus explicit `parentFrame` walk.
3. `Object.create(parentSlots)` prototype-chain reads, only after variant 2 is
   correct and measured.
4. Optional split dictionaries for lexical/scope keys and linear/live-binding
   keys if Sass-style semantics require different write/read behavior.

Required proof before keeping any patch:

- focused Less variable lookup tests: lexical shadowing, recursive mixin/loop
  variables, defaults, imports/reference imports, declaration order, and live
  assignment/update behavior;
- focused Sass-style live-binding tests if the runtime path claims to preserve
  those semantics;
- same real benchmark before/after snapshot;
- no broad registry rewrite unless the small hot variable-reference path wins.

### JavaScript Backend / Native Scope Execution

Historical idea: original Jess advertised itself as JavaScript-evaluated style
sheets and compiled `.jess` stylesheets to JavaScript. That direction may have
been fast because lexical variables, closures, and ordinary function calls let
the JavaScript engine handle much of the scope and execution machinery.

Treat this as a radical research backend, not the active Less eval/render
architecture.

Main-branch evidence:

- `packages/jess/README.md` says Jess "transpiles to JavaScript
  under-the-hood."
- `packages/jess/src/render-module.ts` parses `.jess`, then calls
  `root.toModule(...)` twice to produce compile-time and runtime JS modules.
- `packages/jess/src/render.ts` runs Rollup, writes the generated compiler JS,
  `require(...)`s it, and calls its default export to produce CSS.
- `Root.toModule(...)` emits a JS default function, builds `$TREE` with
  `$J.root((() => { const $OUT = []; ... })())`, then calls
  `$J.renderCss($TREE, $CONTEXT)`.
- `Mixin.toModule(...)` emits JS functions for simple mixins, and `Let` emits
  JS bindings / override plumbing for `@let`.
- `Call.toModule(...)` emits a lazy `ref: () => name` for JS-callable names and
  falls back to CSS calls when the reference is not available.

Important distinction: the main-branch backend was a hybrid. It used JS
lexical names and function calls, but it still generated Jess node objects and
then evaluated/rendered a `$TREE`. The future experiment should measure both
the historical hybrid and a more radical direct-emission backend that writes CSS
without building an evaluated AST.

Hypothesis:

- for Jess-native syntax, compiling to JavaScript may make simple variables,
  functions, loops, and imports much cheaper than interpreting an AST;
- native JS scope and closure capture may replace a large share of registry,
  lookup, and frame plumbing;
- generated JS can let V8 optimize stable hot paths better than a generic
  node-dispatch interpreter.

Primary risk:

- Less mixin semantics do not map cleanly to plain JavaScript functions. Less
  mixins can be overloaded, guarded, merged, namespaced, used as maps, unlocked
  into caller scope in deprecated paths, participate in reference/import
  visibility, interact with `default()`, and depend on declaration/order
  behavior that is not just lexical JS scope.

Research shape:

1. Start with Jess-native or strict-Less subset only: variables, declarations,
   simple nesting, simple functions, loops, and plain mixins.
2. Generate JS that writes CSS directly to a buffer. Do not generate a second
   evaluated AST.
3. Represent mixin overload sets explicitly rather than pretending every Less
   mixin is one JS function.
4. Treat guards/default resolution, detached rulesets, mixin maps, reference
   imports, extends, and deprecated caller-scope leakage as separate semantic
   modules that may stay interpreted or call into runtime helpers.
5. Compare generated-JS backend against current render/eval on tiny fixtures,
   recursive mixin stress, broad Less hot-path fixtures, and Jess-native
   examples.

Keep criteria:

- generated JS must preserve source diagnostics and sourcemap strategy;
- the backend must be opt-in or isolated until it proves Less compatibility;
- no active runtime refactor should depend on this experiment succeeding;
- if it wins, use the result to inform the interpreter shape: direct emission,
  lexical binding cells, static templates, and fewer generic node dispatches.

## Recent Benchmark Sanity Notes

### Selector `writeSyntax` Render-Stringification Cut

Date: 2026-06-08.

Status: focused machinery deletion, not a real speed claim.

Pre-pass broad `benchmark.less` status after the parentless callable fix had
`OutputWriter.mark` `154363` and `OutputWriter.getSince` `149331`.
Caller-stack profiling showed selector/header public string APIs as major
illegal render transport: `BasicSelector`, `Ruleset.getHeaderString`,
`CompoundSelector`, `ComplexSelector`, `SelectorList`, and `Any`.

Patch shape: selector containers and `Ruleset.getHeaderString(...)` now use a
direct `writeSyntax(options)` writer path instead of public
`toString(...)`/`toTrimmedString(...)` as child transport. Public string APIs
remain cold wrappers around direct writer emission.

Post-pass broad `benchmark.less` profiler status:
`OutputWriter.mark` `54534`, `OutputWriter.getSince` `49502`,
`OutputWriter.restore` `26638`, `Reference.evalNode` `3619` calls /
`69.29ms`, `Rules.find` `1013` calls / `25.68ms`, elapsed `540.89ms`.

Interpretation: `mark/getSince` traffic moved sharply, but elapsed is
profiler/noisy status only. Do not call this a runtime speed win without a
clean real benchmark before/after.

Remaining measured serialization targets from caller stacks:
`Ruleset.getHeaderString` header-string capture (`21911`),
declaration duplicate pre-rendering (`4129` repeated marks plus
`replaceSince`), `Any.toString` (`6871`), `Dimension`/`Num`, `Color`,
`PseudoSelector`, `Sequence`, and `Quoted`.

### Standalone Bare-Variable Cache Rejection

Date: 2026-06-06.

Change attempted and rejected: frame-local static-variable lookup identity
caching inside `lookupScopeFrameVariable(...)` as a standalone cache layer.

Two implementations were tried:

- a `Map` cache keyed by lookup identity;
- a single-entry primitive-field cache on `ScopeFrame`.

Both cached binding identity only, not evaluated values. Both were removed from
runtime code because the evidence did not justify the machinery.

Evidence:

- Initial pass status after fallback-frame ownership: `benchmark-v39.less`
  profile showed `Reference.evalNode` `482` calls / `5.43ms`, `Rules.find`
  `68` calls / `0.38ms`, and static audit showed global `new-node` `321`.
- The `Map` cache raised the static audit to `new-node` `322`, so it was cut.
- The single-entry primitive-field cache restored the audit to `new-node`
  `321`, but a clean profile still showed `Reference.evalNode` `482` calls /
  `5.59ms`.
- Stable hotpath sanity with the primitive-field cache was mixed, not a win:
  `functions` `12.79ms`, `import-reference` `20.41ms`,
  `mixins-guards` `17.44ms`, `extend-chaining` `5.29ms`, `media` `6.74ms`.

Interpretation: reject a bolt-on bare static-variable cache for this path. The
failed prototype cached only binding identity for an already-cheap lookup, so
it reasoned about the cache in isolation instead of asking why reference
evaluation had to rediscover the same binding facts.

This does not reject reuse. The next model should be one binding/index system:
a reference asks for a binding handle, and the handle carries scope/version,
reference shape, resolved declaration/callable/property identity, live/static/
effect facts, and value/text reusability. A repeated path such as
`.a.b.c[@color-1]` should not rediscover the `.a.b.c` ruleset/callable path and
the `@color-1` declaration binding twice.

Future experiments should target repeated compound reference fixtures and prove
that reuse falls out of binding handles and frame/surface versions, not a
separate side cache with newly rebuilt strings, arrays, or lookup containers.

### Fallback-Frame Lookup Ownership

Date: 2026-06-06.

Change: `lookupScopeFrameVariable(...)` now owns fallback-frame variable lookup
for covered static variable reads. It searches the primary frame chain and then
the fallback frame chain before returning `miss`, so fallback live-slot hits,
fallback declaration hits, and covered fallback misses do not route through the
old `lookupRuntimeVarBinding(...)` / `findVarDeclarationFast(...)` ladder.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `12.33ms`;
- `import-reference`: usable, median `20.09ms`;
- `mixins-guards`: usable, median `17.44ms`;
- `extend-chaining`: usable, median `5.51ms`;
- `media`: usable, median `6.66ms`.

Additional status:

- `node scripts/profile-less-benchmark.mjs --file=benchmark-v39.less` reported
  `Reference.evalNode` `482` calls / `5.07ms`, `Rules.find` `68` calls /
  `0.34ms`, and `Rules.find` still only on function keys for this fixture.
- `pnpm run audit:node-creation` reported `reference.ts` `21`, global
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.

Interpretation: status only. This pass moved fallback ownership into the
binding facade for covered static variable reads. It was not a controlled
before/after performance experiment and makes no speed claim.

### Manual-Frame Declaration Coverage

Date: 2026-06-06.

Change: `ScopeFrame` now carries declaration-coverage state so
`Reference.lookupScopeFrameVariableBinding(...)` no longer checks
`targetRules.scopeFrame`, `varsByName`, `rulesIndexed`, and `value.length` on
every covered static variable lookup. `Rules` registration/indexing keeps an
existing frame's declaration buckets/pending list aligned and marks coverage
when indexing reaches the current rules length. Snapshot reads now skip
runtime live-slot fallback after an uncovered facade result.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `12.85ms`;
- `import-reference`: usable, median `20.19ms`;
- `mixins-guards`: usable, median `17.86ms`;
- `extend-chaining`: usable, median `5.47ms`;
- `media`: usable, median `6.33ms`.

Additional status:

- `node scripts/profile-less-benchmark.mjs --file=benchmark-v39.less` reported
  `Reference.evalNode` `482` calls / `5.93ms`, `Rules.find` `68` calls /
  `0.36ms`, and `Rules.find` still only on function keys for this fixture.
- `pnpm run audit:node-creation` reported `reference.ts` `21`, global
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.

Interpretation: status only. This pass deleted a reference-side branch and
fixed snapshot fallback ownership; it did not capture a clean before/after
benchmark pair and makes no speed claim.

### Production Binding Facade Step 2

Date: 2026-06-06.

Change: added the first production `ScopeFrame` variable lookup facade for
static string variable references with no explicit target, no interpolation, no
contextual `start` boundary, and pending-declaration bailout. Existing
`findVarDeclarationFast(...)`/registry fallback remains for broader cases.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: unstable, median `12.31ms`;
- `import-reference`: usable, median `19.55ms`;
- `mixins-guards`: usable, median `17.60ms`;
- `extend-chaining`: usable, median `5.19ms`;
- `media`: usable, median `6.10ms`.

Interpretation: status only. This pass did not capture a clean before/after
pair, so it makes no speed claim. The benchmark remains useful as a leash: the
facade slice stayed behavior-gated and did not obviously break the hot-path
runner.

### `$!` Source-Position Facade Route

Date: 2026-06-06.

Change: `$!name` now carries an explicit source-position read fact on
`Reference`, and covered same-frame `$!` variable reads route through the
`ScopeFrame` facade with `start` and `includeLive: false`. Ordinary `$name`
current reads and loop/live reads remain on the existing path.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `12.72ms`;
- `import-reference`: usable, median `17.15ms`;
- `mixins-guards`: usable, median `16.32ms`;
- `extend-chaining`: usable, median `4.62ms`;
- `media`: unstable, median `5.74ms`.

Interpretation: status only. This was not a clean before/after benchmark
experiment, so it makes no speed claim. The important proof for the slice is
behavioral: explicit `$!` source-position reads can use the facade without
breaking ordinary current/live `$while` reads.

### Static `:=` VarDeclaration Placement-Copy Cut

Date: 2026-06-06.

Change: static `VarDeclaration` `:=`/`setDefined` now updates the resolved
declaration value and scope-frame cell directly instead of deriving a placement
declaration, adopting it into the found `Rules`, splicing/unshifting the rules
array, and re-registering the new node. Non-variable `setDefined` remains on
the older placement path.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `14.01ms`;
- `import-reference`: usable, median `21.61ms`;
- `mixins-guards`: usable, median `18.09ms`;
- `extend-chaining`: usable, median `5.63ms`;
- `media`: usable, median `6.84ms`.

Interpretation: status only. This was not a clean before/after benchmark
experiment, so it makes no speed claim. The behavioral proof is the focused
`Rules` `setDefined`/readonly test set plus the new assertion that static
`setDefined` does not call `deriveWithOptions(...)`.

### Cross-Structure Binding Proof

Date: 2026-06-06.

Change: added real mixin and `$for` binding tests for current reads,
`$!`/snapshot reads, static `:=`, and live-slot RHS `:=`. The production fix
evaluates the assigned RHS at the `setDefined` write boundary when the
registration target already carries live slots; a broader context-through-all
registration route was rejected because it broke dynamic declaration-name
reference tests.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `13.31ms`;
- `import-reference`: usable, median `21.91ms`;
- `mixins-guards`: usable, median `18.05ms`;
- `extend-chaining`: usable, median `5.48ms`;
- `media`: usable, median `6.91ms`.

Interpretation: status only. This was not a clean before/after benchmark
experiment, so it makes no speed claim. The behavioral proof is the focused
failure and fix: `$for` live-slot RHS assignment failed with `'value' is not
defined` before the write-boundary eval and passed after gating context use to
live-slot registration surfaces.

### Reference Pass 5 Static Declaration Resolve Cut

Date: 2026-06-06.

Change: public declaration references now return static, non-important,
non-merged declaration values directly when outside calc frames. This deletes
the remaining public resolve path that copied, froze, and inherited already
static declaration containers.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `13.77ms`;
- `import-reference`: unstable, median `21.87ms`;
- `mixins-guards`: usable, median `17.59ms`;
- `extend-chaining`: usable, median `5.47ms`;
- `media`: usable, median `6.80ms`.

Interpretation: status only. This was not a clean before/after benchmark
experiment, so it makes no speed claim. The behavioral/code-path proof is that
the focused declaration-reference resolve test failed before the patch because
it returned a copied/frozen `List`; it now asserts source identity and zero
`copy(...)`/`.inherit(...)`. Calc slash-list tests rejected a broader direct
return, so the kept cut is explicitly bounded by `context.calcFrames === 0`.

### Reference Pass 6 Lookup Helper Hoist

Date: 2026-06-06.

Change: `findVarDeclarationFast(...)` no longer allocates nested helper
functions for bucket selection, candidate ordering, and deferred dynamic-name
promotion on every variable lookup. The same scans and mutations remain; they
now live in module-local helpers.

Pre-pass CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.69ms`, `Rules.find` `68` calls / `0.38ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit still showed `reference.ts` with `23` creation or
  copy surfaces, and global audit totals `new-node` `321`, `with-surface` `36`,
  `copy-leaves` `31`, `derive` `30`.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `13.09ms`;
- `import-reference`: usable, median `21.33ms`;
- `mixins-guards`: usable, median `17.54ms`;
- `extend-chaining`: usable, median `5.55ms`;
- `media`: usable, median `6.73ms`.

Interpretation: status only. This was not a clean before/after benchmark
experiment, so it makes no speed claim. The code-path proof is narrower: the
hot variable lookup path no longer constructs the bucket/order/deferred-name
helper closures per call.

### Reference Pass 7 Evaluator Options Object Cut

Date: 2026-06-06.

Change: `evaluateReferenceValueNode(...)` now uses local bit flags instead of a
fresh options object for runtime-binding evaluation, and declaration-reference
evaluation no longer goes through an argument-object wrapper before calling the
same evaluator.

Pre-pass CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.70ms`, `Rules.find` `68` calls / `0.38ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit still showed `reference.ts` with `23` creation or
  copy surfaces, and global audit totals `new-node` `321`, `with-surface` `36`,
  `copy-leaves` `31`, `derive` `30`.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `13.44ms`;
- `import-reference`: usable, median `21.38ms`;
- `mixins-guards`: usable, median `18.24ms`;
- `extend-chaining`: unstable, median `5.67ms`;
- `media`: usable, median `6.78ms`.

Interpretation: status only. This was not a clean before/after benchmark
experiment, so it makes no speed claim. The code-path proof is narrower: the
reference value evaluator no longer constructs the runtime-binding options
object or declaration wrapper argument object per call.

### Reference Pass 8 Runtime-Binding Sync Closure Cut

Date: 2026-06-06.

Change: runtime-binding reference evaluation now performs rules-context and
search-scope save/restore directly for the common sync path instead of
allocating `evaluateBinding`/`evaluateInRulesContext` closures and passing them
through `withRulesContext(...)`. Async cleanup continuations remain for actual
thenables.

Pre-pass CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `6.34ms`, `Rules.find` `68` calls / `0.41ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit still showed `reference.ts` with `23` creation or
  copy surfaces, and global audit totals `new-node` `321`, `with-surface` `36`,
  `copy-leaves` `31`, `derive` `30`.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `13.69ms`;
- `import-reference`: usable, median `20.70ms`;
- `mixins-guards`: usable, median `17.75ms`;
- `extend-chaining`: usable, median `5.30ms`;
- `media`: usable, median `6.47ms`.

Interpretation: status only. This was not a clean before/after benchmark
experiment, so it makes no speed claim. The code-path proof is narrower: the
runtime-binding sync path no longer allocates the binding-eval/rules-context
closure pair before evaluating the same binding value.

### Reference Pass 9 Rules Lookup Executor Closure Cut

Date: 2026-06-06.

Change: removed `createRulesReferenceLookupExecutor(...)` and its returned
per-lookup `performRulesLookup(scope)` closure. Rules/leaky lookup now carries
the same lookup data as explicit state and calls a module-local lookup function
directly.

Current CPU/counter status:

- `benchmark-v39.less` profiler status after the patch: `Reference.evalNode`
  `482` calls / `9.57ms`, `Rules.find` `68` calls / `0.47ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit showed `reference.ts` at `21` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`.

Interpretation: status only. This CPU/counter refresh was run after the edit,
so it is not before/after speed evidence. The code-path proof is narrower: the
rules reference lookup path no longer constructs a per-lookup executor closure.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `13.80ms`;
- `import-reference`: usable, median `22.20ms`;
- `mixins-guards`: usable, median `17.60ms`;
- `extend-chaining`: usable, median `5.40ms`;
- `media`: usable, median `6.77ms`.

### Reference Pass 10 Render-Only Finalization Copy Cut

Date: 2026-06-06.

Change: render-only declaration and runtime binding finalization now returns
the evaluated node directly for non-merged values. It no longer applies a
post-eval `copyWithReusableLeaves(...)` and `.inherit(reference)` only to stamp
public result metadata before immediate string rendering.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.27ms`, `Rules.find` `68` calls / `0.37ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit showed `reference.ts` at `21` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `6.36ms`, `Rules.find` `68` calls / `0.48ms`;
- top reference keys remained repeated variable reads: `value` `230`,
  `val` `68`, `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit remained unchanged: `reference.ts` `21`,
  global totals `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`,
  `derive` `30`.

Interpretation: status only, not speed proof. The code-path proof is narrower:
dynamic values that were already evaluated for render no longer pay a second
ownership copy/inherit just before stringification. The static audit does not
move because the deleted work was conditional runtime execution, not a removed
source line containing a creation token.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `13.58ms`;
- `import-reference`: usable, median `21.79ms`;
- `mixins-guards`: usable, median `17.61ms`;
- `extend-chaining`: usable, median `5.37ms`;
- `media`: usable, median `6.52ms`.

### Binding Step 4 Declaration-Bucket Binding Identity

Date: 2026-06-06.

Change: covered static variable declaration hits now return binding cell/value
identity through `RuntimeVarBinding` instead of returning a source
`VarDeclaration` and then bouncing through declaration-node finalization.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.54ms`, `Rules.find` `68` calls / `0.40ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit showed `reference.ts` at `21` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.62ms`, `Rules.find` `68` calls / `0.37ms`;
- `Rules.find` for this fixture is now only function lookup:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- top reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit stayed `reference.ts` `21`, global totals
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.

Interpretation: status only, not speed proof. The code-path proof is the
focused reference test that instruments `Rules.find(...)`: a covered static
variable hit for `color` renders `seen: red;` with zero declaration
`Rules.find(...)` calls. The remaining binding bridge is now more exposed:
facade `undefined` still conflates covered miss and unmodeled fallback, so the
next lookup cut is explicit `MISS` vs `UNCOVERED`, not lookup caching.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `12.69ms`;
- `import-reference`: usable, median `20.95ms`;
- `mixins-guards`: usable, median `17.33ms`;
- `extend-chaining`: usable, median `5.74ms`;
- `media`: usable, median `6.46ms`.

### Binding Step 5 Covered Miss vs Uncovered Fallback

Date: 2026-06-06.

Change: `ScopeFrame` variable lookup now returns explicit `miss` or
`uncovered` states. Covered static variable misses stop before the old
runtime-binding, fast-var, and registry fallback ladder. `uncovered` remains
only for cases whose lookup facts are not yet represented by the binding frame.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.33ms`, `Rules.find` `68` calls / `0.38ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit showed `reference.ts` at `21` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.57ms`, `Rules.find` `68` calls / `0.40ms`;
- `Rules.find` stayed only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- top reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit stayed `reference.ts` `21`, global totals
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.

Interpretation: status only, not speed proof. The code-path proof is that
covered misses now return a terminal local sentinel in `Reference`, while
pending dynamic names, fallback frames, unrepresented parent frame chains, and
manual unindexed frames stay `uncovered` and may use old lookup. Two broader
cuts were rejected by tests: terminal miss for all facade misses broke
detached rulesets, and treating all prebuilt unindexed frames as uncovered
broke `$for` snapshot reads.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `12.39ms`;
- `import-reference`: usable, median `18.77ms`;
- `mixins-guards`: usable, median `16.94ms`;
- `extend-chaining`: usable, median `5.09ms`;
- `media`: usable, median `6.35ms`.

### Binding Step 6 Parent-Frame Coverage

Date: 2026-06-06.

Change: nested `Rules` frames now build/attach their nearest ancestor
`Rules` frame on demand. Static variable lookup no longer marks a child frame
as `uncovered` just because the parent frame had not already been built.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.10ms`, `Rules.find` `68` calls / `0.36ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit showed `reference.ts` at `21` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.61ms`, `Rules.find` `68` calls / `0.38ms`;
- `Rules.find` stayed only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- top reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit stayed `reference.ts` `21`, global totals
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.

Interpretation: status only, not speed proof. The code-path proof is the
focused nested reference test: a child `Rules` surface resolves a static parent
variable with the parent frame initially unbuilt and records zero declaration
`Rules.find(...)` calls. This deletes one `uncovered` bridge by representing
the parent frame chain directly.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `12.35ms`;
- `import-reference`: usable, median `18.18ms`;
- `mixins-guards`: usable, median `16.53ms`;
- `extend-chaining`: usable, median `5.10ms`;
- `media`: usable, median `6.25ms`.

### Binding Step 7 Pending Declaration-Name Promotion

Date: 2026-06-06.

Change: already-static pending dynamic declaration names are promoted before
`lookupScopeFrameVariable(...)`, so they can resolve through the binding facade
instead of reaching old fast-var fallback first.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.44ms`, `Rules.find` `68` calls / `0.36ms`;
- top reference keys were repeated variable reads: `value` `230`, `val` `68`,
  `size` `40`, `hue` `36`, `idx` `32`;
- static node-creation audit showed `reference.ts` at `21` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- `benchmark-v39.less` profiler status: `Reference.evalNode` `482` calls /
  `5.77ms`, `Rules.find` `68` calls / `0.37ms`;
- `Rules.find` stayed only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- top reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit stayed `reference.ts` `21`, global totals
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.

Interpretation: status only, not speed proof. The code-path proof is that the
existing pending-name promotion loop now runs before the facade lookup. The
focused pending-name test asserts the promoted declaration is visible through
`lookupScopeFrameVariable(...)`; still-dynamic and async pending-name tests
remain covered and continue to avoid registry fallback.

Sanity command:

```sh
pnpm run measure:less:hotpath -- --stable
```

Result status:

- `functions`: usable, median `12.67ms`;
- `import-reference`: usable, median `18.16ms`;
- `mixins-guards`: usable, median `16.43ms`;
- `extend-chaining`: usable, median `5.11ms`;
- `media`: usable, median `6.30ms`.

### Binding Step 8 Static Compound Path Identity

Date: 2026-06-06.

Change: static compound reference keys keep their original `string[]` identity
when possible, and callable namespace lookup walks path arrays by offset instead
of allocating recursive rest arrays. This is path-fact preservation inside the
binding/index direction, not a standalone cache and not evaluated-value reuse.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status before this pass: `Reference.evalNode`
  `482` calls / `5.69ms`, `Rules.find` `68` calls / `0.42ms`;
- `Rules.find` was only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- static node-creation audit showed `reference.ts` at `21` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- clean `benchmark-v39.less` profiler status: `Reference.evalNode` `482`
  calls / `5.11ms`, `Rules.find` `68` calls / `0.37ms`;
- top repeated reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- `Rules.find` stayed only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- static node-creation audit stayed `reference.ts` `21`, global totals
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.

Interpretation: status only, not speed proof. The code-path proof is a focused
reference test that monkey-patches `Rules.find(...)` and proves a static
mixin-ruleset array-path lookup receives the original key array instance. The
remaining binding-handle work is still to stop rediscovering binding facts
across repeated lookups, and any evaluated value/text reuse still needs explicit
static/effect facts plus benchmark proof.

### Reference Step 11 Declaration Finalization Helper Cut

Date: 2026-06-06.

Change: declaration-reference finalization deleted four single-use helper/
predicate layers and keeps the same search-scope cleanup directly in
`finalizeDeclarationReferenceResult(...)`. This is a helper/function-hop cut,
not a new materialization strategy.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status before this pass: `Reference.evalNode`
  `482` calls / `5.20ms`, `Rules.find` `68` calls / `0.35ms`;
- `Rules.find` was only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- static node-creation audit showed `reference.ts` at `21` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- clean `benchmark-v39.less` profiler status: `Reference.evalNode` `482`
  calls / `5.32ms`, `Rules.find` `68` calls / `0.38ms`;
- top repeated reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit dropped `reference.ts` from `21` to `20` and
  global `with-surface` from `34` to `33`; `new-node` stayed `321`,
  `copy-leaves` stayed `31`, and `derive` stayed `30`.

Interpretation: status only, not speed proof. The code-path proof is the
deleted wrapper stack:
`withReferenceSearchScope(...)`,
`finalizeEvaluatedDeclarationReference(...)`,
`hasImportantDeclarationValue(...)`, and
`isMergedAssignDeclaration(...)`. The remaining
`copyWithReusableLeaves(...)`/`.inherit(...)` public declaration-reference
boundary is still queued for evidence-backed removal or isolation.

### Reference Step 12 Finalizer Options-Object Cut

Date: 2026-06-06.

Change: Reference finalizers pass the render-only `textOnly` state as a boolean
instead of building private option/args objects. This deletes object plumbing in
the finalization ladder; it does not change fallback/runtime binding/
declaration/direct/callable materialization semantics.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status before this pass: `Reference.evalNode`
  `482` calls / `6.13ms`, `Rules.find` `68` calls / `0.36ms`;
- `Rules.find` was only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- static node-creation audit showed `reference.ts` at `20` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `33`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- clean `benchmark-v39.less` profiler status: `Reference.evalNode` `482`
  calls / `5.65ms`, `Rules.find` `68` calls / `0.37ms`;
- top repeated reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit stayed `reference.ts` `20`, global totals
  `new-node` `321`, `with-surface` `33`, `copy-leaves` `31`, `derive` `30`.

Interpretation: status only, not speed proof. The code-path proof is that
`reference.ts` no longer contains `{ textOnly }`, `options.textOnly`, or
`finalizeReferenceLookupResult({ ... })`/fallback args-object patterns. The
remaining item-14 work is still the actual copy/materialization boundary, not
more option plumbing.

### Reference Step 13 Public Resolve Post-Eval Copy Cut

Date: 2026-06-06.

Change: runtime-binding and non-merged declaration public resolve now return the
evaluated node from `evaluateReferenceValueNode(...)` directly instead of
copying that evaluated node again and stamping `.inherit(reference)`. Merged
declaration references still keep their explicit normalization/inherit path.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status before this pass: `Reference.evalNode`
  `482` calls / `5.58ms`, `Rules.find` `68` calls / `0.40ms`;
- `Rules.find` was only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- static node-creation audit showed `reference.ts` at `20` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `33`,
  `copy-leaves` `31`, `derive` `30`.

Post-edit CPU/counter status:

- clean `benchmark-v39.less` profiler status: `Reference.evalNode` `482`
  calls / `5.27ms`, `Rules.find` `68` calls / `0.35ms`;
- top repeated reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit dropped `reference.ts` from `20` to `18` and
  global `copy-leaves` from `31` to `29`; `new-node` stayed `321`,
  `with-surface` stayed `33`, and `derive` stayed `30`.

Interpretation: status only, not speed proof. The code-path proof is that two
post-eval public-resolve ownership copies are gone, with focused tests proving
dynamic runtime-binding and dynamic declaration containers no longer inherit
from the reference while canonical source parents remain intact.

### Reference Step 14 Fallback Pre-Copy Cut

Date: 2026-06-06.

Change: fallback public resolve no longer pre-copies the fallback source
container before eval. This removes one Reference-local
`copyWithReusableLeaves(fallbackValue)` boundary. It does not claim that dynamic
fallback public materialization is solved, because `List.eval(...)`/
`Sequence.eval(...)` can still create owned public containers when evaluated
children differ.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status before this pass: `Reference.evalNode`
  `482` calls / `5.61ms`, `Rules.find` `68` calls / `0.41ms`;
- `Rules.find` was only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- static node-creation audit showed `reference.ts` at `18` creation or copy
  surfaces and global totals `new-node` `321`, `with-surface` `33`,
  `copy-leaves` `29`, `derive` `30`.

Post-edit CPU/counter status:

- clean `benchmark-v39.less` profiler sanity after the patch:
  `Reference.evalNode` `482` calls / `6.00ms`, `Rules.find` `68` calls /
  `0.42ms`;
- top repeated reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit dropped `reference.ts` from `18` to `17` and
  global `copy-leaves` from `29` to `28`; `new-node` stayed `321`,
  `with-surface` stayed `33`, and `derive` stayed `30`.

Interpretation: status only, not speed proof. The code-path proof is one
Reference-local fallback pre-copy deletion plus focused tests proving dynamic
fallback render and public resolve do not call `List.copy` on the fallback
source container. The exposed next target is shared public container
materialization in `List.eval(...)`/`Sequence.eval(...)`, not another Reference
wrapper.

### List/Sequence Eval Wrapper Cut

Date: 2026-06-06.

Change: `List.evalNode(...)` and `Sequence.evalNode(...)` no longer pay private
evaluation-wrapper calls before evaluating child arrays. `List.evalNode(...)`
also replaced `Array.every(...)` callback checks with direct loops. This is
function-call/callback deletion only; it does not remove the owned
`List.withResolvedValue(...)` or `Sequence.withValue(...)` public
materialization boundary.

Pre-edit CPU/counter status:

- `benchmark-v39.less` profiler status before this pass: `Reference.evalNode`
  `482` calls / `7.24ms`, `Rules.find` `68` calls / `0.65ms`;
- `Rules.find` was only function lookup for this fixture:
  `function:hsl` `36`, `function:percentage` `24`, `function:range` `8`;
- static node-creation audit showed `sequence.ts` at `18`, `reference.ts` at
  `17`, and global totals `new-node` `321`, `with-surface` `33`,
  `copy-leaves` `28`, `derive` `30`.

Post-edit CPU/counter status:

- clean `benchmark-v39.less` profiler sanity after the patch:
  `Reference.evalNode` `482` calls / `5.60ms`, `Rules.find` `68` calls /
  `0.41ms`;
- top repeated reference keys stayed `value` `230`, `val` `68`, `size` `40`,
  `hue` `36`, `idx` `32`;
- static node-creation audit stayed flat: `sequence.ts` `18`, `reference.ts`
  `17`, global `new-node` `321`, `with-surface` `33`, `copy-leaves` `28`,
  `derive` `30`.

Interpretation: status only, not speed proof. The code-path proof is that
`evaluateItems`, `evaluateValues`, and `.every(...)` are gone from
`list.ts`/`sequence.ts`. The remaining target is still the owned public
container materialization boundary, not another local wrapper.

### Comment/QueryCondition Writer Pass Leash

Date: 2026-06-08.

Change: `Comment` gained a direct scalar `writeSyntax(...)`; `QueryCondition`
split source syntax writing from dynamic value render, removed the source
writer closure, and cut static child writer-mark probes. `BasicSelector`
source serialization now emits authored `value` while keeping `valueOf()` as
normalized key text.

Hotpath status:

- `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `10.23ms` unstable, `import-reference` median `16.10ms`
  usable, `mixins-guards` median `14.46ms` usable,
  `extend-chaining` median `4.45ms` usable, and `media` median `4.37ms`
  usable.

Interpretation: status only, not speed proof. This pass did not capture a
clean before/after pair. The code-path proof is direct source writing for
comments/query conditions, static query-condition probe removal, and rejection
of invented source writers for JS host wrappers whose tests define no source
syntax contract.

### Flat RenderBuffer / OutputWriter Sharing Leash

Date: 2026-06-09.

Change: internally owned `renderNodeToString(...)` flat buffers can lend their
`parts` array to `OutputWriter`, so flat string rendering can share one chunk
array instead of writing to a writer chunk array and then pushing the same
rendered text into a separate flat buffer. Explicit caller-owned flat buffers
keep their old observable `parts` grouping; segmented render buffers remain
semantic segment buffers and do not share with `OutputWriter`.

Hotpath status:

- `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `9.88ms` usable, `import-reference` median `15.79ms`
  usable, `mixins-guards` median `14.26ms` usable,
  `extend-chaining` median `4.31ms` usable, and `media` median `4.38ms`
  unstable.

Interpretation: status only, not speed proof. The code-path proof is shared
flat writer chunks for internally owned string renders plus converted
prepare/write boundaries in `Node`, `List`, `Sequence`, `Declaration`,
`Block`, `Url`, `Quoted`, and `QueryCondition`. The rejected broader version
changed caller-visible `buffer.parts` chunk shape, so it was narrowed before
keeping the patch.

### Output Writer / RenderBuffer Finishing Leash

Date: 2026-06-09.

Change: extended the shared flat writer finish path to
`AttributeSelector`, escaped-list `Paren`, `Interpolated`, plain `Call`,
evaluated `Ruleset`, and evaluated/body `AtRule` container serialization.
`Rules.writeRulesRenderOutput(...)` was tried and rejected because its writer
output and returned fragment string intentionally differ around body
separators/newlines.

Hotpath status:

- `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `9.89ms` usable, `import-reference` median `16.28ms`
  usable, `mixins-guards` median `14.77ms` usable,
  `extend-chaining` median `4.32ms` usable, and `media` median `4.36ms`
  unstable.

Interpretation: status only, not speed proof. The code-path proof is more
node-local prepare/write pairs using the already introduced shared flat writer
finish path. The remaining `Rules` bridge needs a staging-separation pass,
not a blind shared-writer conversion.

### Call Evaluated Arg/Content Writer Leash

Date: 2026-06-12.

Change: plain/finalized `Call` rendering now writes already-evaluated argument
and content nodes through `writeSyntax(...)` instead of public
`toTrimmedString(...)` transport. The cut covers normal arguments,
escaped-paren argument inners, and call content.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `8099e114` reported:
  `functions` median `13.05ms` unstable, `import-reference` median `20.80ms`
  unstable, `mixins-guards` median `17.10ms` usable,
  `extend-chaining` median `5.10ms` usable, and `media` median `5.85ms`
  usable.
- Post-pass dirty `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `12.87ms` unstable, `import-reference` median `20.64ms`
  unstable, `mixins-guards` median `17.28ms` unstable,
  `extend-chaining` median `5.30ms` unstable, and `media` median `5.81ms`
  noisy.

Interpretation: status only, not speed proof. The code-path proof is the
removal of public string API transport for evaluated `Call` arg/content nodes,
with focused tests that trip if `toTrimmedString(...)` is called. Remaining
`Call` work is ownership/copy pressure, whole-call mark/readback, and helper
ladder reduction.

### EvalSync / MaybePromise Narrowing Leash

Date: 2026-06-12.

Change: added `Node.evalSync(context)` for `!F_MAY_ASYNC`-proven sync eval
paths and removed local `as Node`/`as Promise<Node>` casts where
`isThenable(...)` already narrows `MaybePromise<Node>`. Initial call sites are
`Call`, `Paren`, and `Operation`.

Hotpath status:

- Dirty `pnpm run measure:less:hotpath -- --stable` from `d0bd3717` reported:
  `functions` median `12.41ms` usable, `import-reference` median `19.15ms`
  usable, `mixins-guards` median `17.03ms` usable,
  `extend-chaining` median `4.84ms` usable, and `media` median `5.35ms`
  usable.

Interpretation: status only, not speed proof. There was no clean before/after
pair for this exact patch. The code-path proof is a narrower sync assertion
boundary for flag-proven paths and deletion of casts after existing thenable
checks.

### Full MaybePromise Narrowing / Sync Child Eval Sweep

Date: 2026-06-12.

Change: extended the `evalSync(...)`/`MaybePromise` narrowing rule to
`Expression`, `Block`, `Url`, `PseudoSelector`, `Declaration`, `Interpolated`,
and the shared node-array evaluator. Non-async child paths in expression/block
/url now use `evalSync(...)`; generic maybe-async branches delete local
`as Node`/`as Promise<Node>` casts where `isThenable(...)` already narrows the
value.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `6963d319` reported:
  `functions` median `13.65ms` unstable, `import-reference` median `21.15ms`
  unstable, `mixins-guards` median `17.46ms` unstable,
  `extend-chaining` median `5.43ms` usable, and `media` median `5.71ms`
  noisy.
- Post-pass dirty `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `12.88ms` usable, `import-reference` median `22.18ms`
  unstable, `mixins-guards` median `18.12ms` usable,
  `extend-chaining` median `5.32ms` noisy, and `media` median `5.62ms`
  unstable.

Interpretation: status only, not speed proof. The pre/post signals are too
mixed for a runtime claim. The code-path proof is fewer generic thenable
branches on non-async child eval paths and deletion of unsafe local casts after
existing type guards.

### Second MaybePromise Narrowing / Sync Child Eval Sweep

Date: 2026-06-12.

Change: extended the same narrowing rule to `Negative`, `Quoted`, `Condition`,
`AttributeSelector`, `Selector`, `InterpolatedSelector`, `Extend`, `Log`,
`Operation`, `Node` base registration/eval helpers, `Interpolated`,
`SelectorList`, `CompoundSelector`, and `ComplexSelector`. `Negative` now uses
`evalSync(...)` for non-async child render/eval; the other touched paths delete
local assertions where `isThenable(...)` already proves the branch.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `1726d33c` reported:
  `functions` median `13.56ms` usable, `import-reference` median `21.48ms`
  usable, `mixins-guards` median `17.14ms` usable,
  `extend-chaining` median `5.15ms` usable, and `media` median `5.47ms`
  usable.
- Final dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `12.99ms` usable, `import-reference` median `19.78ms`
  usable, `mixins-guards` median `16.72ms` usable,
  `extend-chaining` median `5.24ms` usable, and `media` median `5.85ms`
  usable.

Interpretation: status only, not a runtime win claim. The code-path proof is
deleted assertion scaffolding and a narrower sync assertion boundary on
`Negative`; remaining casts should be attacked by tightening ownership/API
types, not by sprinkling more branch-local assertions.

### Final Broad MaybePromise Assertion Sweep

Date: 2026-06-12.

Change: removed the remaining `as Promise<...>` assertion scaffolding under
`packages/core/src/tree` where `isThenable(...)` already narrows a
`MaybePromise<T>` branch. Touched paths include `List`, `Sequence`,
`QueryCondition`, `Paren`, `CustomDeclaration`, `Declaration`, `AtRule`,
`Ruleset`, `Rules`, and the internal render-buffer adapter. No helper,
traversal, materialization, copy, or metadata mutation was added.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `c6c4d0c` reported:
  `functions` median `14.21ms` usable, `import-reference` median `22.67ms`
  usable, `mixins-guards` median `18.16ms` usable,
  `extend-chaining` median `5.90ms` usable, and `media` median `6.41ms`
  noisy.
- Final dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `11.60ms` usable, `import-reference` median `18.82ms`
  unstable, `mixins-guards` median `16.43ms` usable,
  `extend-chaining` median `5.07ms` usable, and `media` median `5.39ms`
  unstable.

Interpretation: status only, not a runtime win claim. The code-path proof is
the deletion of branch-local assertions after existing thenable checks. The
remaining cast sites are structural identity/value casts and should be handled
by tightening ownership/API types or node-family contracts.

### Ampersand Append Placement State Cut

Date: 2026-06-12.

Change: removed unused ampersand append placement text fields
(`inputItemTexts`, `inputItemCount`, `resultItemTexts`, `resultItemCount`,
`resultText`) and their `toTrimmedString()` array builder. Replaced
`appendValue.split('&')`/`templateParts` with direct `indexOf` scanning, and
replaced selector-list `for...of` plus spread-push with indexed loops.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `acc3a910` reported:
  `functions` median `12.37ms` usable, `import-reference` median `19.95ms`
  unstable, `mixins-guards` median `16.96ms` usable,
  `extend-chaining` median `5.04ms` usable, and `media` median `5.35ms`
  usable.
- Final dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `11.88ms` usable, `import-reference` median `19.60ms`
  usable, `mixins-guards` median `16.21ms` usable,
  `extend-chaining` median `4.82ms` unstable, and `media` median `4.81ms`
  usable.

Interpretation: status only, not a runtime win claim. The code-path proof is
deleted placement string arrays and deleted split/iterator/spread allocation on
ampersand append/template evaluation.

### Mixin / Interpolated / QueryCondition Writer Cut

Date: 2026-06-12.

Change: `Mixin.deriveMixin(...)` now builds its owned value object directly
instead of allocating conditional object-spread fragments for optional fields.
`Interpolated.writeReplacement(...)` writes replacement nodes through
`writeSyntax(...)` plus the existing trim window instead of calling public
`toTrimmedString(...)` as writer transport. `QueryCondition` dynamic render now
uses a straight sync loop and only enters an async rest method after a thenable
is observed, deleting the per-render local closure/rest scaffold from the sync
path.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `9f5b8b43`
  reported: `functions` median `12.64ms` usable, `import-reference` median
  `20.24ms` usable, `mixins-guards` median `16.94ms` usable,
  `extend-chaining` median `4.93ms` unstable, and `media` median `5.22ms`
  usable.
- Final dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `13.18ms` usable, `import-reference` median `20.62ms`
  usable, `mixins-guards` median `17.49ms` usable,
  `extend-chaining` median `5.12ms` usable, and `media` median `5.35ms`
  usable.

Interpretation: status only, not a runtime win claim. The post-pass medians
were slower across the leash, so this pass is kept only as behavior-preserving
machinery deletion. Next performance-sensitive cuts should prioritize larger
measured buckets rather than more local polish unless the code path is
obviously wrong.

### List / Sequence Async Render Scaffold Cut

Date: 2026-06-12.

Change: `List` async-capable render no longer allocates a local
`renderNode(...)` closure or nested async `renderRest(...)` function on the
sync path, and `List[Symbol.iterator]` now returns the array iterator directly
instead of using a generator wrapper. `Sequence` async-capable render no longer
allocates local render-node/rest closures on the sync path; async rest work is
isolated behind private methods only used after a thenable is observed.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `78a26349`
  reported: `functions` median `12.93ms` usable, `import-reference` median
  `20.57ms` usable, `mixins-guards` median `16.32ms` usable,
  `extend-chaining` median `4.80ms` usable, and `media` median `5.31ms`
  usable.
- Final dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `12.19ms` usable, `import-reference` median `19.46ms`
  usable, `mixins-guards` median `16.64ms` usable,
  `extend-chaining` median `5.61ms` usable, and `media` median `5.69ms`
  usable/noisy.

Interpretation: status only, not a runtime win claim. The leash was mixed:
functions/import improved, mixins-guards moved slightly slower, and
extend/media regressed. Keep only as behavior-preserving scaffold deletion;
future passes should keep pressure on larger measured buckets before polishing
more local helper shape.

### Reference Lookup Closure Hoist

Date: 2026-06-13.

Change: hoisted the recursive `findVarWithinScopeSurface(...)` helper out of
`findVarDeclarationFast(...)`, and hoisted `lookupRuntimeVarBinding(...)`'s
local `searchChain(...)` helper to module scope. The same lookup state is now
passed explicitly; traversal and lookup behavior are unchanged.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `8b4c1073`
  reported: `functions` median `12.06ms` usable, `import-reference` median
  `18.18ms` usable, `mixins-guards` median `16.46ms` usable,
  `extend-chaining` median `5.02ms` unstable, and `media` median `5.10ms`
  usable.
- Final dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `12.58ms` usable, `import-reference` median `19.25ms`
  usable, `mixins-guards` median `16.45ms` usable,
  `extend-chaining` median `5.33ms` usable, and `media` median `5.54ms`
  usable.

Interpretation: status only, not a runtime win claim. The post-pass leash was
slower for functions, import-reference, extend-chaining, and media, while
mixins-guards was roughly flat. Keep only as code-path deletion of per-lookup
closure allocation; do not sell it as a speedup.

### Reference Lookup Utility Placement Correction

Date: 2026-06-13.

Change: moved the heavy Reference lookup helper bodies from
`packages/core/src/tree/reference.ts` to
`packages/core/src/tree/util/reference-lookup.ts`. This is a file-boundary and
node-file cleanup pass; traversal and lookup behavior are unchanged.

Hotpath status:

- Dirty post-correction `pnpm run measure:less:hotpath -- --stable` at
  `327f3a2e` reported: `functions` median `12.34ms` usable,
  `import-reference` median `19.23ms` usable, `mixins-guards` median
  `17.02ms` usable, `extend-chaining` median `4.95ms` usable, and `media`
  median `5.34ms` usable.

Interpretation: status only, not a runtime win claim. Keep as architecture
placement cleanup: node files should not carry heavy reusable utility bodies.

### Control-Flow Iteration Scaffold Cut

Date: 2026-06-13.

Change: removed `$for` async-generator entry iteration, per-entry tuple arrays,
the `sourceRules.value.map(...)` iteration child copy path,
`rules.value.some(...)` state-mutation probing, the constructor
`getBindingDeclarations(...)` allocation path, and the public control-render
callback wrapper. `$for` now uses a direct async visitor for resolved entries;
`$if`/`$for`/`$while` public render overloads pass a flat `RenderBuffer`
directly to their existing render routines.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `4cd3718f`
  reported: `functions` median `12.49ms` usable, `import-reference` median
  `20.14ms` usable, `mixins-guards` median `17.28ms` usable,
  `extend-chaining` median `5.15ms` usable, and `media` median `5.44ms`
  usable.
- Dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `12.12ms` usable, `import-reference` median `18.53ms`
  usable, `mixins-guards` median `15.90ms` usable,
  `extend-chaining` median `4.64ms` unstable, and `media` median `5.00ms`
  unstable.

Interpretation: keep as machinery deletion with favorable usable hotpath
signals, but do not call it a proven speedup because two lower medians were
marked unstable and this was not a controlled performance-only run.

### Immediate Callable Wrapper Cut

Date: 2026-06-13.

Change: `Call` direct `Rules`/`Collection` callable render/eval paths and
`Func.evalCall(...)` now call `evaluateCallableCollection(...)` directly
instead of allocating one-entry `MixinCollection` wrappers only to immediately
call `.evalCall(...)`. `MixinCollection` remains live as a callable-value
handoff surface; this pass only cut eval-only wrapper construction.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `af2c6955`
  reported: `functions` median `10.37ms` usable, `import-reference` median
  `15.40ms` usable, `mixins-guards` median `14.67ms` usable,
  `extend-chaining` median `4.56ms` unstable, and `media` median `4.35ms`
  noisy.
- Dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `11.09ms` unstable, `import-reference` median `16.35ms`
  unstable, `mixins-guards` median `14.43ms` usable,
  `extend-chaining` median `4.36ms` usable, and `media` median `4.35ms`
  usable.

Interpretation: status only, not a speed claim. Keep as a small wrapper-node
deletion backed by focused callable tests; the hotpath leash was mixed/noisy.

### Cast/Cloning Callback Scaffold Cut

Date: 2026-06-13.

Change: `packages/core/src/tree/util/cast.ts` now casts JS arrays with a
pre-sized indexed loop instead of `.map(...)`; `packages/core/src/tree/util/cloning.ts`
now scans/copies child arrays and render-frame metadata with indexed loops
instead of `.some(...)`, `.map(...)`, and `[...frames]`. Copy ownership
semantics are unchanged.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `b237feb5`
  reported: `functions` median `14.11ms` unstable,
  `import-reference` median `20.90ms` unstable,
  `mixins-guards` median `17.36ms` unstable,
  `extend-chaining` median `5.44ms` usable, and `media` median `5.67ms`
  usable.
- Dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `13.94ms` unstable,
  `import-reference` median `22.13ms` unstable,
  `mixins-guards` median `17.82ms` unstable,
  `extend-chaining` median `5.56ms` noisy, and `media` median `5.77ms`
  unstable.

Interpretation: status only, not a speed claim. Keep as callback/spread
scaffold deletion in shared cast/copy utilities; the hotpath leash was
unstable/noisy and mixed.

### Reusable-Leaf Child-Flag Trust Cut

Date: 2026-06-13.

Change: deleted the recursive `hasNodeChild(...)` value crawl from
`packages/core/src/tree/util/cloning.ts`; `canReuseLeaf(...)` now trusts
`F_HAS_NODE_CHILD`, which constructor/adoption already maintains. Hardened
`Node.set(null, ...)` so whole-value replacement clears and re-processes that
flag instead of leaving it stale.

Hotpath status:

- Dirty `pnpm run measure:less:hotpath -- --stable` at `8e5281f1` reported:
  `functions` median `13.35ms` unstable,
  `import-reference` median `21.47ms` unstable,
  `mixins-guards` median `17.04ms` unstable,
  `extend-chaining` median `5.56ms` noisy, and `media` median `5.91ms`
  unstable.

Interpretation: status only, not a speed claim. Keep as a code-path deletion:
reusable-leaf checks no longer pay a recursive child scan to rediscover a flag
already carried by node construction/adoption.

### Callable Arguments Binding Flag/Allocation Cut

Date: 2026-06-13.

Change: `createArgumentsBindingValue(...)` now marks its intentionally
unadopted child contents with `F_HAS_NODE_CHILD`, preserving the child-flag
contract without reparenting caller argument nodes. `getArgumentsBindingValues(...)`
now returns the original arg array when no rest `Sequence` needs flattening,
deleting the unconditional intermediate `@arguments` array allocation on the
common path.

Hotpath status:

- Pre-pass `pnpm run measure:less:hotpath -- --stable` at `bc3e4884`
  reported: `functions` median `13.87ms` noisy,
  `import-reference` median `23.07ms` unstable,
  `mixins-guards` median `18.10ms` noisy,
  `extend-chaining` median `5.60ms` unstable, and `media` median `5.67ms`
  noisy.
- Dirty post-pass `pnpm run measure:less:hotpath -- --stable` reported:
  `functions` median `14.13ms` usable,
  `import-reference` median `22.01ms` usable,
  `mixins-guards` median `17.20ms` unstable,
  `extend-chaining` median `5.52ms` usable, and `media` median `5.70ms`
  unstable.

Interpretation: status only, not a speed claim. Keep as a flag-invariant fix
and unconditional allocation deletion in callable binding; the hotpath leash was
mixed.

### Callable Rest Match-Time Array Cut

Date: 2026-06-13.

Change: `matchCallableParams(...)` no longer builds a rest-only array during
candidate matching. It carries `restStart` into `createRestBindingValue(...)`
and `getCallableRestSignature(...)`, so the original arg surface is read
directly and the actual rest `Sequence` materializes only when the binding value
is prepared. The same pass collapsed the separate rest-detection scan into the
required-position scan. A rejected empty `Call.evalArgNodes(...)` reuse attempt
proved that empty arg-list reuse still needs an ownership split: the canonical
empty args list was reparented during resolve, so no code from that experiment
was kept.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `50406d10` reported: `functions` median `13.59ms` noisy,
  `import-reference` median `23.24ms` unstable, `mixins-guards` median
  `18.22ms` unstable, `extend-chaining` median `5.64ms` unstable, and `media`
  median `6.02ms` unstable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `15.38ms` unstable,
  `import-reference` median `89.22ms` noisy, `mixins-guards` median `19.76ms`
  usable, `extend-chaining` median `6.17ms` usable, and `media` median
  `6.28ms` unstable.

Interpretation: status only, not a speed claim. Keep as an obvious match-time
array/copy deletion plus one removed param scan; the hotpath leash was too
mixed/noisy for performance conclusions.

### Ampersand Template Placement Comma-Scan Cut

Date: 2026-06-13.

Change: `Ampersand` merge-template placement no longer serializes a scalar
parent selector, checks `includes(',')`, and then scans again to split top-level
commas. `splitTopLevelCommas(...)` now performs the single fallback scan and
allocates its result array only after the first top-level comma. Structured
`SelectorList` and generated `:is(...)` parents now feed their existing child
arrays directly into selector-list template merging instead of first copying
them into a temporary replacement array. Raw scalar comma parents still
materialize placement selectors because the source shape is a single selector
string containing commas.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `b356ce19` reported: `functions` median `15.50ms` unstable,
  `import-reference` median `24.40ms` unstable, `mixins-guards` median
  `30.05ms` noisy, `extend-chaining` median `12.03ms` noisy, and `media`
  median `10.00ms` noisy.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `17.52ms` noisy,
  `import-reference` median `24.83ms` usable, `mixins-guards` median `19.05ms`
  usable, `extend-chaining` median `5.84ms` usable, and `media` median
  `8.08ms` noisy.

Interpretation: status only, not a speed claim. Keep as an Ampersand placement
machinery deletion; the hotpath leash was mixed/noisy.

### Ampersand Placement State/Construction Cut

Date: 2026-06-13.

Change: `AmpersandAppendPlacementState` no longer carries dead `source`,
`selector`, `result`, or `selectorBits` fields, and its factory no longer takes
unused selector/context arguments. The common BasicSelector append placement
path now constructs `BasicSelector` directly instead of paying the generic
`Reflect.construct(...)` fallback plus spread options.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `f00f1368` reported: `functions` median `16.26ms` usable,
  `import-reference` median `21.84ms` usable, `mixins-guards` median `18.09ms`
  usable, `extend-chaining` median `11.62ms` noisy, and `media` median
  `34.36ms` noisy.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `14.53ms` usable,
  `import-reference` median `21.06ms` usable, `mixins-guards` median `18.17ms`
  usable, `extend-chaining` median `5.86ms` usable, and `media` median
  `5.99ms` unstable.

Interpretation: status only, not a speed claim. Keep as a dead-field and
generic-construction deletion in Ampersand placement; no performance conclusion
is claimed from the bounded leash.

### Call Arg Serialization And Sequence Separator Probe Cut

Date: 2026-06-13.

Change: `Call.serializeRenderedArgs(...)` no longer allocates per-call nested
recursive helper closures for CSS-call argument serialization. It uses a
straight sync loop and resumes through one private continuation method only
after a thenable appears. CSS-call content eval/write now shares the same
node-local `writeEvaluatedSyntax(...)` helper instead of duplicating the
eval/write branch in two call renderers. `Sequence` separator checks now use
numeric character tests, an indexed trivia-token scan, and one shared spacer
predicate instead of regex/callback probes.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `36e16f73` reported: `functions` median `14.16ms` usable,
  `import-reference` median `21.17ms` usable, `mixins-guards` median `18.21ms`
  usable, `extend-chaining` median `6.83ms` unstable, and `media` median
  `6.01ms` usable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `14.15ms` usable,
  `import-reference` median `20.55ms` usable, `mixins-guards` median `17.98ms`
  usable, `extend-chaining` median `5.79ms` usable, and `media` median
  `5.46ms` unstable.

Interpretation: status only, not a speed claim. Keep as closure, callback, and
regex-probe deletion in Call/Sequence serialization paths.

### Ruleset/AtRule Render Closure And Selector Array-Factory Cut

Date: 2026-06-13.

Change: `Call.serializeRenderedArgs(...)` no longer opens a writer mark for
zero-argument calls. `AtRule.render(...)` and `Ruleset.render(...)` no longer
allocate their sync-path local render/result helper closures on every render;
the same staging now lives on class methods, with async continuations only
after a thenable appears. `Ruleset` ampersand composition replaced selector
`slice(...)`, spread merge, and push-spread flattening with indexed loops and
pre-sized arrays.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `0fa37690` reported: `functions` median `16.65ms` unstable,
  `import-reference` median `29.40ms` usable, `mixins-guards` median
  `21.04ms` unstable, `extend-chaining` median `7.11ms` unstable, and `media`
  median `6.92ms` usable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `15.07ms` usable,
  `import-reference` median `24.23ms` usable, `mixins-guards` median
  `19.35ms` usable, `extend-chaining` median `5.83ms` usable, and `media`
  median `5.96ms` unstable.

Interpretation: status only, not a speed claim. Keep as writer-capture,
sync-path closure, and selector array-factory deletion; the sample is bounded
and not a stable benchmark proof.

### AtRule Header Direct Syntax Cut

Date: 2026-06-13.

Change: `AtRule` now has a direct `writeSyntax(...)` source writer, and
`AtRule.getHeaderString(...)` writes name/prelude syntax directly instead of
calling child public `toString(...)` inside local capture helper functions.
Prelude boundary trivia is emitted explicitly through the existing trivia
consumption path so comment placement stays intact. `Ruleset` header compose
also counts ampersands with a character loop instead of `valueOf().match(...)`
array allocation.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `3f641b78` reported: `functions` median `14.97ms` unstable,
  `import-reference` median `23.39ms` usable, `mixins-guards` median
  `17.71ms` usable, `extend-chaining` median `5.87ms` usable, and `media`
  median `6.33ms` unstable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `14.79ms` usable,
  `import-reference` median `24.00ms` usable, `mixins-guards` median
  `17.62ms` usable, `extend-chaining` median `5.78ms` usable, and `media`
  median `6.08ms` unstable.

Interpretation: status only, not a speed claim. Keep as public-string transport
and regex-result allocation deletion; the bounded leash is mixed but not
regressive enough to reject the simpler path.

### Declaration Formatting Regex/Iterator Cut

Date: 2026-06-13.

Change: `Declaration.formatNonCustomValue(...)` no longer uses regex
`match(...)` arrays to measure line indentation or closing-line shape, and
custom fallback rendering no longer uses `valueOut.match(...)` to preserve
leading horizontal whitespace. The same formatting now uses small character
scans. `evalCustomInterpolatedRenderValue(...)` also uses an indexed loop
instead of `replacements.entries()`.

Micro-operation check: a local Node `v24.11.1` microbench over
declaration-shaped strings showed the character loops faster for these exact
operations: leading trim median `29.49ms` vs regex replace `55.53ms`, leading
whitespace length median `20.62ms` vs regex match `55.14ms`, and closing-line
predicate median `34.46ms` vs regex test `50.41ms` over `2,000,000`
iterations. This supports keeping the formatting predicate rewrite, but it is
not a whole-render speed claim.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `9a5488a4` reported: `functions` median `15.02ms` usable,
  `import-reference` median `22.22ms` usable, `mixins-guards` median
  `18.14ms` usable, `extend-chaining` median `6.06ms` unstable, and `media`
  median `5.55ms` unstable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `15.05ms` usable,
  `import-reference` median `22.62ms` usable, `mixins-guards` median
  `18.59ms` usable, `extend-chaining` median `5.85ms` usable, and `media`
  median `5.72ms` usable.

Interpretation: status only, not a speed claim. Keep as regex-result and
iterator deletion in declaration formatting/render staging.

### Call Empty-Arg Mark Cut

Date: 2026-06-13.

Change: explicit empty call argument lists now use the same empty-call fast
path as missing args. `Call.serializeRenderedArgs(...)` returns before opening
a writer mark for `args.value.length === 0`, `Call.toTrimmedString(...)`
recognizes empty lists as no rendered args, and `Call.writeSyntax(...)` skips
the argument mark/trim window for empty lists.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `71da758a` reported: `functions` median `15.93ms` unstable,
  `import-reference` median `21.74ms` usable, `mixins-guards` median
  `18.46ms` usable, `extend-chaining` median `6.79ms` noisy, and `media`
  median `6.50ms` unstable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `15.72ms` unstable,
  `import-reference` median `23.82ms` usable, `mixins-guards` median
  `18.77ms` unstable, `extend-chaining` median `6.53ms` unstable, and `media`
  median `6.63ms` usable.

Interpretation: status only, not a speed claim. Keep as a dead writer
mark/trim-window deletion for explicit empty argument lists.

### Call/AtRule Render Closure Scaffold Cut

Date: 2026-06-13.

Change: `Call.renderPlainFunctionCall(...)` and
`Call.renderFinalizedCallSyntax(...)` no longer allocate per-call
`finishCall` closures; finish logic is private class-method staging reached
directly on the sync path and by async continuations only after rendered args
settle. `AtRule.renderLeafValue(...)` no longer allocates a local render-node
closure for each leaf render. A tempting `QueryCondition` static
shared-flat-buffer `getSince(...)` deletion was rejected: current tests require
the buffer render path to return the full string while keeping shared flat
buffer parts split, so that needs a render-buffer contract change rather than
a local cleanup.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `e575d35d` reported: `functions` median `14.73ms` usable,
  `import-reference` median `23.89ms` usable, `mixins-guards` median
  `17.86ms` usable, `extend-chaining` median `5.87ms` usable, and `media`
  median `5.41ms` usable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `15.87ms` unstable,
  `import-reference` median `24.90ms` usable, `mixins-guards` median
  `18.06ms` unstable, `extend-chaining` median `6.40ms` unstable, and `media`
  median `6.49ms` usable.

Interpretation: status only, not a speed claim. Keep as per-render closure
scaffold deletion. The leash is mixed/noisy and does not prove a speed win;
watch the next full benchmark/profile before treating this as performance
movement.

### Control Node Eval Callback Scaffold Cut

Date: 2026-06-13.

Change: `If.evalNode(...)`, `For.evalNode(...)`, and `While.evalNode(...)`
execute directly as async methods instead of allocating local `run` closures.
`While.evalNode(...)` and `While.renderIterations(...)` also inline the
`context.rulesContext` save/restore guard, deleting the generic
`runWithRulesContext(...)` async callback wrapper. `For.evalNode(...)`
collapses a duplicated push branch after clearing `Rules.scopeFrame`.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `05461114` reported: `functions` median `13.91ms` unstable,
  `import-reference` median `19.60ms` usable, `mixins-guards` median
  `17.48ms` unstable, `extend-chaining` median `5.39ms` usable, and `media`
  median `5.11ms` usable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `14.40ms` usable,
  `import-reference` median `19.80ms` usable, `mixins-guards` median
  `17.15ms` usable, `extend-chaining` median `5.19ms` usable, and `media`
  median `5.32ms` usable.

Interpretation: status only, not a speed claim. This is control-family
callback/helper deletion under the node rewrite task. `If` is complete for the
tracker lane; `For` and `While` still need loop state/body-surface placement
work before their node-family checkboxes can close.

### Loop-Control Node Rewrite Audit

Date: 2026-06-13.

Change: no runtime code changed in this audit. The node rewrite tracker now
closes `For` and `While` for the `writeSyntax`/render lane because the
remaining owned iteration `Rules` surfaces are semantic placement/eval state,
not render/string transport. Existing focused tests prove direct render,
render-buffer output, no public resolve/eval wrapper, no `Rules.clone`, scalar
leaf reuse, canonical body parenting, live/stateful loop bindings,
render/eval output alignment, and rules-context restoration on throw.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `8e0142fb` reported: `functions` median `14.62ms` unstable,
  `import-reference` median `22.32ms` unstable, `mixins-guards` median
  `17.54ms` usable, `extend-chaining` median `5.98ms` usable, and `media`
  median `5.77ms` unstable.

Interpretation: status only, not a speed claim. No post-pass leash is required
for the docs-only audit; preserve the pre-pass snapshot as the latest queue
starting state.

### Sync Immediate Eval Materialization Split

Date: 2026-06-13.

Change: non-test tree code no longer calls public `evalSync(...)` from routine
sync render/value paths. `Node.evalImmediateSync(...)` is the render-only sync
boundary for immediate stringification; it evaluates through the base eval node
path and skips public `.inherit(...)` finalization. `Block`, `Url`, `Negative`,
`Expression`, `Call`, and `Paren` now use it for their non-async immediate
paths. Public `eval(...)` and `evalSync(...)` semantics remain unchanged. A
first direct-only helper attempt was rejected because focused `Call` tests
proved API-mutated node instances can override `eval(...)`; the helper keeps a
cold override fallback for that case.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `7ebd04f2` reported: `functions` median `15.16ms` usable,
  `import-reference` median `23.60ms` usable, `mixins-guards` median
  `17.84ms` usable, `extend-chaining` median `5.78ms` usable, and `media`
  median `5.88ms` unstable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `15.14ms` unstable,
  `import-reference` median `20.19ms` usable, `mixins-guards` median
  `17.13ms` usable, `extend-chaining` median `6.11ms` usable, and `media`
  median `5.37ms` usable.

Interpretation: status only, not a speed claim. Keep this as a public
materialization boundary cut. The next measured profile should watch whether
`.inherit(...)` and `Node._evalStaticSync(...)` fall out of sync render stacks
before broadening the split to async/public materialization boundaries.

### Operation Operand Closure/Catch Scaffold Cut

Date: 2026-06-13.

Change: `Operation.render(...)`, `Operation.evalNode(...)`, and
`Operation.resolve(...)` no longer allocate local `finalize`, `handleLeft`,
`renderOperands`, `finish`, or `combine` closures on each operand evaluation.
Non-preserve arithmetic also no longer wraps `operate(...)` in
`try/catch { throw error }`. Preserve-mode dimension arithmetic still catches
`TypeError` because that is the existing semantic boundary for producing the
`calc(...)` fallback.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `c92f5dfd` reported: `functions` median `15.36ms` unstable,
  `import-reference` median `23.46ms` usable, `mixins-guards` median
  `18.96ms` usable, `extend-chaining` median `5.91ms` usable, and `media`
  median `5.93ms` usable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `16.09ms` usable,
  `import-reference` median `22.55ms` unstable, `mixins-guards` median
  `18.43ms` usable, `extend-chaining` median `5.95ms` unstable, and `media`
  median `6.01ms` unstable.

Interpretation: status only, not a speed claim. Keep this as a node-family
closure/error-control cleanup. The mixed/noisy leash does not prove a speed
movement; Operation's remaining real debt is `withOperands(...)` copying and
calc fallback ownership.

### Reusable-Leaf Location Allocation Cut

Date: 2026-06-13.

Change: `canReuseLeaf(...)` now reads `_location` directly instead of calling
the public `location` getter, so copy/reuse predicates no longer allocate an
empty location array on source-free scalar leaves merely to prove they are
source-free. Focused cloning coverage proves `_location` stays undefined after
the reusable-leaf check.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `0ff63689` reported: `functions` median `13.95ms` unstable,
  `import-reference` median `22.90ms` usable, `mixins-guards` median
  `19.91ms` unstable, `extend-chaining` median `5.39ms` usable, and `media`
  median `5.28ms` usable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `14.49ms` usable,
  `import-reference` median `21.61ms` usable, `mixins-guards` median
  `17.55ms` usable, `extend-chaining` median `5.65ms` usable, and `media`
  median `5.36ms` usable.

Interpretation: status only, not a speed claim. Keep this as a hidden
allocation deletion in the measured copy stack. It does not complete
`copyWithReusableLeaves(...)`, `constructCopy(...)`, or `.inherit(...)`
removal.

### Generic Copy Options Descriptor-Probe Cut

Date: 2026-06-13.

Change: `constructCopy(...)` no longer calls
`Object.getOwnPropertyDescriptor(node, '_options')` for every generic copy. It
reads the owned `_options` slot directly through the non-allocating node slot,
keeping the existing no-lazy-options behavior without a defensive descriptor
helper. Focused cloning coverage proves optionless source containers stay
optionless after `copyWithReusableLeaves(...)`.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `0406552f` reported: `functions` median `17.00ms` noisy,
  `import-reference` median `26.61ms` noisy, `mixins-guards` median
  `18.38ms` usable, `extend-chaining` median `6.08ms` unstable, and `media`
  median `6.05ms` usable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `16.23ms` unstable,
  `import-reference` median `22.79ms` usable, `mixins-guards` median
  `17.93ms` usable, `extend-chaining` median `6.11ms` unstable, and `media`
  median `5.90ms` usable.

Interpretation: status only, not a speed claim. Keep this as a helper/probe
deletion in the measured copy stack. It does not complete
`copyWithReusableLeaves(...)`, `constructCopy(...)`, or `.inherit(...)`
removal.

### Callable Copy Wrapper And Lazy Metadata Cut

Date: 2026-06-13.

Change: `copyCallableRulesNode(...)` now handles ampersand, comment, and
reusable-leaf cases directly instead of bouncing through three one-call helper
wrappers. Callable copy construction now reads `_options` and `_location`
directly instead of allocating through the public `options` and `location`
getters merely to pass constructor metadata.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `3eba2742` reported: `functions` median `16.12ms` usable,
  `import-reference` median `24.51ms` usable, `mixins-guards` median
  `17.66ms` unstable, `extend-chaining` median `6.24ms` unstable, and `media`
  median `5.19ms` unstable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `15.60ms` usable,
  `import-reference` median `20.42ms` usable, `mixins-guards` median
  `18.08ms` usable, `extend-chaining` median `5.87ms` unstable, and `media`
  median `5.85ms` unstable.

Interpretation: status only, not a speed claim. Keep this as helper-call and
lazy metadata allocation deletion inside the measured callable/copy stack. It
does not remove the `copyCallableRulesValue(...)` recursive copy boundary.

### Callable Reuse Lazy Metadata Cut

Date: 2026-06-13.

Change: callable reuse predicates now read existing node metadata slots instead
of public lazy getters. `canReuseStaticScalarLeaf(...)` checks `_location`
instead of `location`, and `canReuseStaticCallableChildren(...)` checks
`_options?.assign` instead of `options?.assign`.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `9227bb6b` reported: `functions` median `14.95ms` usable,
  `import-reference` median `22.93ms` unstable, `mixins-guards` median
  `17.30ms` unstable, `extend-chaining` median `5.70ms` usable, and `media`
  median `5.32ms` unstable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `14.72ms` usable,
  `import-reference` median `20.23ms` usable, `mixins-guards` median
  `19.45ms` usable, `extend-chaining` median `6.52ms` unstable, and `media`
  median `6.56ms` unstable.

Interpretation: status only, not a speed claim. Keep this as lazy metadata
allocation deletion in callable reuse decisions. It does not remove copied
callable surfaces.

### Rules Registration Scan Lazy Metadata Cut

Date: 2026-06-13.

Change: `Rules._scanRegistrationNodes(...)` now reads existing metadata slots
for registration bookkeeping. Charset detection uses `_options?.role`, charset
and CSS-import placeholders use `_location` instead of `location`, and canonical
declaration reuse checks use `_options?.assign` /
`_options?.normalizedFromAssign` instead of public `options`.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `ea4770b6` reported: `functions` median `15.06ms` unstable,
  `import-reference` median `22.40ms` usable, `mixins-guards` median
  `17.62ms` unstable, `extend-chaining` median `5.95ms` unstable, and `media`
  median `5.21ms` unstable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `14.10ms` usable,
  `import-reference` median `21.81ms` usable, `mixins-guards` median
  `16.32ms` usable, `extend-chaining` median `5.87ms` usable, and `media`
  median `5.39ms` unstable.

Interpretation: status only, not a speed claim. Keep this as lazy metadata
allocation deletion in registration scanning. It does not remove
registration-prep expected-miss `try/catch` control flow.

### Ruleset Serializer Array/Callback Cut

Date: 2026-06-14.

Change: `serialize-helper.ts` removed callback-array machinery from Ruleset
render serialization. Transparent bare-ampersand flattening now uses one
indexed pass with rollback instead of `filter(...)`, `some(...)`, and a third
leaf pass. Hoisted parent lookup composes directly over the existing frame
array instead of allocating a filtered ruleset-frame array. Renderable-child
checks and trivia token checks use indexed loops. Hoisted frame reset compacts
the existing frame array instead of allocating `atRulesOnly`, and source-chain
scan no longer pays `queue.shift()`.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `9c49832` reported: `functions` median `15.42ms` usable,
  `import-reference` median `22.09ms` usable, `mixins-guards` median
  `19.76ms` usable, `extend-chaining` median `5.88ms` usable, and `media`
  median `5.95ms` unstable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `12.14ms` usable,
  `import-reference` median `17.97ms` usable, `mixins-guards` median
  `14.20ms` usable, `extend-chaining` median `4.69ms` unstable, and `media`
  median `4.51ms` unstable.

Interpretation: sanity status only, not a speed claim. Keep this as render-path
array/callback deletion inside the Ruleset serialization lane. It does not
remove header string comparison keys or duplicate declaration pre-rendering.

### Duplicate Declaration Pre-Render Gate

Date: 2026-06-14.

Change: duplicate declaration suppression in `serialize-helper.ts` now does a
cheap declaration-property pre-scan and only opens detached declaration
writers for properties that repeat in the visible render list. Unique
declaration properties render once at normal leaf emission instead of first
being pre-rendered into `declarationOutputCache` with a detached
`OutputWriter`, emitted-trivia `Set`, and serialized string.

Hotpath status:

- Pre-pass bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup
  5` at `3562f9a6` reported: `functions` median `12.11ms` usable,
  `import-reference` median `18.08ms` usable, `mixins-guards` median
  `14.79ms` usable, `extend-chaining` median `4.80ms` usable, and `media`
  median `4.29ms` unstable.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `12.52ms` usable,
  `import-reference` median `17.12ms` usable, `mixins-guards` median
  `14.90ms` usable, `extend-chaining` median `4.74ms` usable, and `media`
  median `4.26ms` unstable.

Interpretation: sanity status only, not a speed claim. Keep this as deletion
of routine declaration prerender/materialization for unique properties. It
does not remove the same-property duplicate comparison boundary.

### AtRule Scalar Header Readback Cut

Date: 2026-06-14.

Change: `AtRule.getHeaderString(...)` now reads scalar no-trivia `Any`
name/prelude text directly instead of opening writer `mark/getSince/restore`
windows to recover the same string. The common no-trivia header path also
skips the post-prelude writer probe because no trivia map exists. Non-scalar
and trivia-backed headers stay on the existing direct `writeSyntax(...)`
readback path.

Hotpath status:

- Focused `pnpm --filter @jesscss/core test -- at-rule` passed with a
  `CountingWriter` proof that scalar headers use zero mark/getSince/restore
  calls and non-scalar prelude headers use one localized readback window.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `14.76ms` usable,
  `import-reference` median `20.08ms` usable, `mixins-guards` median
  `18.98ms` unstable, `extend-chaining` median `5.95ms` noisy, and `media`
  median `5.14ms` unstable.
- Dirty post-pass `node scripts/profile-less-benchmark.mjs --file=benchmark.less`
  still reported broad `OutputWriter.mark` `50044` and
  `OutputWriter.getSince` `45048`.

Interpretation: machinery deletion only, not a speed claim. The focused writer
counters prove the selected AtRule path is cleaner, but the broad profile did
not move at decision-quality resolution. Keep `AtRule` open for non-scalar
header/leaf readback, body-state staging, and custom eval/import/render
branches.

### SelectorList Direct Flattened Emission

Date: 2026-06-14.

Change: `SelectorList.writeSyntax(...)` no longer builds a temporary flattened
selector array before serializing top-level `:is(...)` selector-list
expansions. Normal writes emit candidates directly from the source list and
existing nested selector-list arrays. Reference-mode target filtering keeps the
old "filter only when at least one extended non-target exists" behavior with a
pre-scan only when reference filtering is active, then writes matching
candidates directly.

Hotpath status:

- Focused `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/selector-list.test.ts --run` passed.
- Broader selector-focused `vitest --run` suite passed 9 files / 189 tests.
- Dirty post-pass bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` reported: `functions` median `14.81ms` unstable,
  `import-reference` median `21.89ms` usable, `mixins-guards` median
  `17.64ms` usable, `extend-chaining` median `6.03ms` unstable, and `media`
  median `6.26ms` unstable.
- Dirty post-pass `node scripts/profile-less-benchmark.mjs --file=benchmark.less`
  still reported broad `OutputWriter.mark` `50044` and
  `OutputWriter.getSince` `45048`.

Interpretation: machinery deletion only, not a speed claim. The selected writer
path no longer materializes a flatten/filter array, but broad benchmark
signals were mixed/noisy and the writer counters did not move.

### ExtendList Direct Effect Render

Date: 2026-06-14.

Change: `ExtendList.render(...)` now runs child `Extend.runEffect(...)`
directly with a sync-first loop instead of calling each child public
`render(...)` through `serialForEach(...)`. This keeps extend-list rendering on
the invisible side-effect boundary and removes a generic callback/child-render
ladder for the selected node family.

Hotpath status:

- Focused `pnpm exec vitest run packages/core/src/tree/__tests__/extend.test.ts
  packages/core/src/tree/__tests__/node-render-buffer.test.ts` passed before
  final gates. `extend.test.ts` now proves `ExtendList.render(...)` does not
  call child `render(...)`.
- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `16.70ms` unstable, `import-reference` median
  `22.22ms` usable, `mixins-guards` median `17.08ms` usable,
  `extend-chaining` median `5.86ms` unstable, and `media` median `6.19ms`
  usable.
- Final `node scripts/profile-less-benchmark.mjs --file=benchmark.less`
  reported broad `OutputWriter.mark` `50002`, `OutputWriter.getSince` `45006`,
  `Reference.evalNode` `3619` calls / `67.46ms`, and `Rules.find` `1013`
  calls / `25.74ms`.

Interpretation: accept only if final gates stay green and the bounded
benchmark/profile leash does not expose a regression. Broader extend matching,
selector stringification, and wrapper existence remain outside this
serialization pass.

### Call Rendered Args Readback Cut

Date: 2026-06-14.

Change: `Call.serializeRenderedArgs(...)` now writes argument syntax and returns
only completion (`void` or promise), because callers only awaited it before
finishing call syntax. This removes the args-level `mark/getSince` readback
whose string was immediately discarded by plain and finalized call rendering.

Hotpath status:

- Focused `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/call.test.ts --run` passed. The call test now asserts a
  rendered non-empty CSS call has one whole-call readback, not an extra
  discarded args readback.
- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `14.89ms` unstable, `import-reference` median
  `21.67ms` usable, `mixins-guards` median `16.73ms` usable,
  `extend-chaining` median `5.87ms` unstable, and `media` median `6.05ms`
  usable.
- Final `node scripts/profile-less-benchmark.mjs --file=benchmark.less`
  reported broad `OutputWriter.mark` `49969`, `OutputWriter.getSince` `44973`,
  `Reference.evalNode` `3619` calls / `76.68ms`, and `Rules.find` `1013`
  calls / `32.53ms`.

Interpretation: machinery deletion only, not a speed claim. Keep `Call` open:
whole-call readback, callable output, `evalArgNodes(...)` copy pressure, async
path shape, helper ladders, and repeated eval remain.

### VarDeclaration Bare Parameter Name Transport Cut

Date: 2026-06-14.

Change: `VarDeclaration.writeSyntax(...)` no longer calls public
`String(name)`/`toString(...)` to print bare parameter variable names. `Any`
names read owned scalar text directly; non-`Any` names write syntax into the
existing writer and trim that writer range.

Hotpath status:

- Focused `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/var-declaration.test.ts --run` passed. The test now proves
  direct bare-parameter `writeSyntax(...)` does not call name `toString(...)`.
- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `14.89ms` usable, `import-reference` median
  `18.28ms` usable, `mixins-guards` median `19.87ms` usable,
  `extend-chaining` median `5.29ms` usable, and `media` median `5.61ms`
  unstable.
- Final `node scripts/profile-less-benchmark.mjs --file=benchmark.less`
  reported broad `OutputWriter.mark` `49969`, `OutputWriter.getSince` `44973`,
  `Reference.evalNode` `3619` calls / `73.62ms`, and `Rules.find` `1013`
  calls / `27.87ms`.

Interpretation: accept as a small node-family serialization completion slice.
Broader declaration body rendering, raw custom property source, merge state,
and duplicate declaration materialization remain on the `Declaration` row.

### Rest Scalar Wrapper Completion

Date: 2026-06-15.

Change: `Rest` now handles string, empty, and `Any` scalar rest values through
direct writer emission in public capture and render paths. `rest(any("items"))`
no longer falls through the inherited base render path that wrote syntax and
then read it back through `mark/getSince`; `Rest.name` also reads `Any.value`
directly instead of public `toString(...)` or `valueOf()` transport.

Hotpath status:

- Focused `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/rest.test.ts --run` passed. Tests prove scalar capture and
  render avoid writer readback, and `Any` names avoid public string/value
  transport.
- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `15.29ms` unstable, `import-reference` median
  `26.70ms` usable, `mixins-guards` median `18.60ms` usable,
  `extend-chaining` median `5.83ms` noisy, and `media` median `5.91ms` usable.
- Final `node scripts/profile-less-benchmark.mjs --file=benchmark.less`
  reported broad `OutputWriter.mark` `49969`, `OutputWriter.getSince` `44973`,
  `Reference.evalNode` `3619` calls / `72.61ms`, and `Rules.find` `1013`
  calls / `31.78ms`.

Interpretation: accept as serialization machinery deletion only, not a speed
claim. `Rest` scalar syntax is complete; arbitrary node-valued rest remains on
the existing child writer fallback boundary.

### Block Scalar Wrapper Cut

Date: 2026-06-15.

Change: `Block` now writes nil and `Any` scalar block syntax through one direct
writer path for public capture and direct render. Resolved `Any` block output
no longer captures with `mark/getSince` just to return `{value}`. Trivia-backed
and non-scalar block values remain on the existing writer fallback boundary.

Hotpath status:

- Focused `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/block.test.ts --run` passed. Tests prove scalar block
  capture/render avoid writer readback and existing nil delimiter paths still
  avoid marks/readbacks.
- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `14.79ms` usable, `import-reference` median
  `21.34ms` usable, `mixins-guards` median `17.42ms` usable,
  `extend-chaining` median `5.52ms` usable, and `media` median `5.61ms`
  usable.
- Final `node scripts/profile-less-benchmark.mjs --file=benchmark.less`
  reported broad `OutputWriter.mark` `49969`, `OutputWriter.getSince` `44973`,
  `Reference.evalNode` `3619` calls / `78.86ms`, and `Rules.find` `1013`
  calls / `32.33ms`.

Interpretation: accept as a bounded serialization-path deletion only, not a
speed claim. Broad benchmark counts did not move, which indicates the
benchmark does not exercise this scalar block path materially.

### Comment Scalar Wrapper Completion

Date: 2026-06-15.

Change: `Comment` now writes owned comment text directly in public capture and
render paths. Visible comments no longer inherit the base source-render path
that writes text and reads it back through `mark/getSince`; line comments still
stay hidden from render unless `fullRender` is set.

Hotpath status:

- Focused `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/comment.test.ts --run` passed. Tests prove public capture
  and render avoid writer marks/readbacks while existing line-comment visibility
  and trivia preservation behavior remains intact.
- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  was noisy for every fixture: `functions` median `25.18ms`,
  `import-reference` median `68.45ms`, `mixins-guards` median `31.68ms`,
  `extend-chaining` median `7.54ms`, and `media` median `8.05ms`. Treat this
  run as leash/inconclusive, not performance evidence.
- Final `node scripts/profile-less-benchmark.mjs --file=benchmark.less`
  reported broad `OutputWriter.mark` `49903`, `OutputWriter.getSince` `44907`,
  `Reference.evalNode` `3619` calls / `91.71ms`, and `Rules.find` `1013`
  calls / `35.93ms`.

Interpretation: accept as a concrete serialization-path deletion only, not a
speed claim. The profiler count delta from the prior pass is consistent with
removing visible comment render/capture readbacks in `benchmark.less`, while
the real benchmark timing run was too noisy to use.

### Scalar Leaf Render-Buffer Mark Cut

Date: 2026-06-15.

Change: `Any`/`Keyword`/`Anonymous`, `Bool`, `Combinator`, `Dimension`, and
scalar `Color` now write direct string/buffer output in `render(...)` instead
of inheriting the base render-buffer mark window. Node-backed `Color` remains
on the existing source fallback boundary.

Hotpath status:

- Focused `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/any.test.ts src/tree/__tests__/bool.test.ts
  src/tree/__tests__/combinator.test.ts src/tree/__tests__/dimension.test.ts
  src/tree/__tests__/color.test.ts src/tree/__tests__/node-render-buffer.test.ts
  --run` passed. Tests prove direct-writer and flat-buffer render avoid writer
  marks/readbacks for the touched scalar leaves while preserving render-buffer
  alignment.
- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `13.87ms` unstable, `import-reference` median
  `19.80ms` usable, `mixins-guards` median `16.72ms` usable,
  `extend-chaining` median `5.81ms` usable, and `media` median `4.95ms`
  usable.
- Final `node scripts/profile-less-benchmark.mjs --file=benchmark.less`
  reported broad `OutputWriter.mark` `49903`, `OutputWriter.getSince` `44907`,
  `Reference.evalNode` `3619` calls / `67.77ms`, and `Rules.find` `1013`
  calls / `27.13ms`.

Interpretation: accept as a focused serialization cleanup only, not a speed
claim. Broad `benchmark.less` writer counts did not move from the previous
pass, which means this cut mostly affects focused scalar flat-buffer paths not
materially represented by the broad benchmark.

### Paren Any Wrapper Cut

Date: 2026-06-15.

Change: `Paren` now writes no-trivia `Any` child wrapper syntax directly in
public capture and non-escaped render paths. `(foo)` and `[foo]` no longer fall
through the paren source capture path just to read back the wrapper string.
Escaped render, trivia-backed source, and non-`Any` children remain on existing
semantic fallback boundaries.

Hotpath status:

- Focused `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/paren.test.ts --run` passed. Tests prove no-trivia `Any`
  paren source/render paths avoid writer marks/readbacks while existing nil,
  dynamic, default guard, trivia, and escaped-list behavior remains green.
- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `15.90ms` unstable, `import-reference` median
  `21.61ms` usable, `mixins-guards` median `18.69ms` unstable,
  `extend-chaining` median `5.92ms` usable, and `media` median `5.68ms`
  usable.
- Final `node scripts/profile-less-benchmark.mjs --file=benchmark.less`
  reported broad `OutputWriter.mark` `49903`, `OutputWriter.getSince` `44907`,
  `Reference.evalNode` `3619` calls / `74.86ms`, and `Rules.find` `1013`
  calls / `29.61ms`.

Interpretation: accept as a bounded serialization cleanup only, not a speed
claim. Broad writer counts did not move, indicating this scalar paren path is
not materially represented in `benchmark.less`.

### DefaultGuard Negative Scalar Wrapper Readback Cut

Date: 2026-06-15.

Change: `DefaultGuard.render(...)` now writes resolved boolean text to the
supplied writer when no render buffer is passed, and `Negative.toTrimmedString`
now writes simple `Any` child source text directly. No helper, traversal,
copy/materialization, or shared abstraction was added.

Hotpath status:

- Focused `pnpm --filter @jesscss/core test -- --run
  src/tree/__tests__/default-guard.test.ts
  src/tree/__tests__/negative.test.ts` passed. Tests prove the touched writer
  paths avoid mark/getSince readback while preserving render/buffer/eval
  behavior.
- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `15.52ms` noisy, `import-reference` median
  `27.54ms` unstable, `mixins-guards` median `18.49ms` usable,
  `extend-chaining` median `5.94ms` usable, and `media` median `6.02ms`
  unstable.
- Final `node scripts/profile-less-benchmark.mjs --file=benchmark.less`
  reported broad `OutputWriter.mark` `49903`, `OutputWriter.getSince` `44907`,
  `Reference.evalNode` `3619` calls / `67.24ms`, and `Rules.find` `1013`
  calls / `27.10ms`.

Interpretation: accept as a local serialization cleanup only, not a speed
claim. Broad writer counts did not move from the prior pass, so these scalar
paths are not materially represented in `benchmark.less`; the bounded timing
run had too much noisy/unstable signal for a performance claim.

### List Sequence Compare String Transport Cut

Date: 2026-06-15.

Change: `List.compare(Any)` and `Sequence.compare(Any)` now use their
node-local direct syntax renderers for the left operand instead of calling the
public `toString(...)` wrapper just to normalize text for a decision predicate.
No helper, traversal, copy/materialization, or API surface was added.

Hotpath status:

- Focused `pnpm --filter @jesscss/core test -- --run
  src/tree/__tests__/list.test.ts src/tree/__tests__/sequence.test.ts` passed.
  Tests prove both the `Any` operand and the `List`/`Sequence` operand avoid
  public `toString(...)` transport during compare.
- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  was run twice because the first pass showed a usable `extend-chaining`
  median above the rough regression leash. Run 1 reported: `functions` median
  `16.98ms` unstable, `import-reference` median `26.88ms` usable,
  `mixins-guards` median `20.86ms` unstable, `extend-chaining` median `6.66ms`
  usable, and `media` median `6.52ms` usable. Run 2 reported: `functions`
  median `17.68ms` noisy, `import-reference` median `21.54ms` unstable,
  `mixins-guards` median `17.11ms` usable, `extend-chaining` median `6.56ms`
  unstable, and `media` median `6.11ms` unstable.
- Final `node scripts/profile-less-benchmark.mjs --file=benchmark.less`
  reported broad `OutputWriter.mark` `49903`, `OutputWriter.getSince` `44907`,
  `Reference.evalNode` `3619` calls / `95.47ms`, and `Rules.find` `1013`
  calls / `40.21ms`.

Interpretation: accept as a local decision-path serialization cut only, not a
speed claim. The timing leash was noisy/unstable across repeat runs; the one
initial usable `extend-chaining` concern did not remain decision-quality on the
rerun. Broad writer counts did not move, which is expected because this cuts a
compare path rather than the main `benchmark.less` render path.

### Range Scalar Bound Readback Cut

Date: 2026-06-15.

Change: `Range` now emits simple `Any` and non-compound `Dimension` bounds as
known scalar text in public source and render paths. Common numeric ranges no
longer open a writer mark/readback window just to return or buffer the same
`1 to 3 step 2` text. Trivia-backed or non-scalar bounds remain on the existing
writer fallback.

Hotpath status:

- Focused `pnpm --filter @jesscss/core test -- --run
  src/tree/__tests__/range.test.ts` passed. Tests prove scalar source/render
  avoids mark/getSince, render avoids public resolve, and flat-buffer output
  remains correct.
- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `15.61ms` unstable, `import-reference` median
  `24.55ms` usable, `mixins-guards` median `18.01ms` usable,
  `extend-chaining` median `5.87ms` usable, and `media` median `5.62ms`
  unstable.
- Final `node scripts/profile-less-benchmark.mjs --file=benchmark.less`
  reported broad `OutputWriter.mark` `49903`, `OutputWriter.getSince` `44907`,
  `Reference.evalNode` `3619` calls / `77.68ms`, and `Rules.find` `1013`
  calls / `34.10ms`.

Interpretation: accept as a local scalar serialization cleanup only, not a
speed claim. Broad writer counts did not move, which means this range scalar
path is not materially represented in `benchmark.less`; the bounded leash did
not show a usable regression.

### Quoted Any Wrapper Readback Cut

Date: 2026-06-15.

Change: non-escaped `Quoted` values backed by `Any` now write
quote/value/quote directly in public source and render paths. They no longer
open a writer mark/readback window just to return or buffer `"value"`.
Escaped values, interpolated values, and non-`Any` node values stay on their
existing boundaries.

Hotpath status:

- Focused `pnpm --filter @jesscss/core test -- --run
  src/tree/__tests__/quoted.test.ts` passed. Tests prove non-escaped `Any`
  source/render avoids mark/getSince and public child string transport while
  preserving render-buffer output and resolve behavior.
- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `14.69ms` usable, `import-reference` median
  `23.45ms` unstable, `mixins-guards` median `17.56ms` unstable,
  `extend-chaining` median `5.94ms` usable, and `media` median `5.48ms`
  unstable.
- Final `node scripts/profile-less-benchmark.mjs --file=benchmark.less`
  reported broad `OutputWriter.mark` `49883`, `OutputWriter.getSince` `44887`,
  `Reference.evalNode` `3619` calls / `69.45ms`, and `Rules.find` `1013`
  calls / `26.95ms`.

Interpretation: accept as a local scalar serialization cleanup only, not a
speed claim. Broad profiler counters moved by 20 fewer `mark/getSince` calls,
which is consistent with this exact quoted scalar path appearing in
`benchmark.less`; real benchmark timing remains only leash evidence.

### Cross-Queue Direct Syntax Cleanup

Date: 2026-06-15.

Change: `AtRule`, `Declaration`, `Reference`, `StyleImport`, and base
`Node.writeSyntax` removed internal public stringification or detached-writer
hops in selected serialization/key/render paths. The pass is cleanup only; it
did not complete any whole queue item.

Hotpath status:

- Final dirty bounded `pnpm run measure:less:hotpath -- --iterations 15
  --warmup 5` at HEAD `c111aaa8` reported: `functions` median `16.00ms`
  unstable, `import-reference` median `22.38ms` usable, `mixins-guards`
  median `16.62ms` usable, `extend-chaining` median `5.36ms` unstable, and
  `media` median `5.50ms` unstable.

Interpretation: status only, not a speed claim. This is a dirty-worktree leash
for direct serialization cleanup; no before/after decision-quality performance
conclusion is claimed.

### Direct Child Source Serialization Cleanup

Date: 2026-06-15.

Change: base `Node.toTrimmedString`, `Block`, `Url`, `RawRules`, and
`Ampersand` removed child/parent public `toString(...)` transport from direct
source syntax paths. Trivia-backed child emission now uses the existing
source-trivia writer instead of public stringification.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `15.16ms` usable, `import-reference` median
  `22.92ms` usable, `mixins-guards` median `19.50ms` usable,
  `extend-chaining` median `5.96ms` usable, and `media` median `6.66ms`
  unstable.

Interpretation: leash status only, not a speed claim. The pass is a direct
public-string-transport cleanup; no benchmark comparison was used to claim a
win.

### Scalar Attribute And Operation Sync Cleanup

Date: 2026-06-15.

Change: `AttributeSelector` common scalar non-bare forms avoid writer
mark/getSince and direct buffer re-write. `Operation` uses
`evalImmediateSync(...)` for non-`F_MAY_ASYNC` operands during render/resolve
evaluation instead of public `eval(...)` plus thenable checks.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `15.38ms` unstable, `import-reference` median
  `27.40ms` usable, `mixins-guards` median `17.77ms` usable,
  `extend-chaining` median `5.38ms` usable, and `media` median `6.12ms`
  unstable.

Interpretation: leash status only, not a speed claim. `import-reference` is
usable but the pass was not a before/after performance experiment, and two
fixtures were unstable.

### Block Negative Scalar Render-Buffer Print-State Cut

Date: 2026-06-15.

Change: `Negative` simple dimension render-buffer output and `Block` scalar
`Any` render-buffer output now write known text directly after value selection,
without setting up render print state, opening writer mark/readback, or copying
detached writer output back into the buffer. Public string paths and non-scalar
wrapper paths remain on their existing syntax/capture boundaries.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `14.17ms` unstable, `import-reference` median
  `18.05ms` usable, `mixins-guards` median `16.28ms` usable,
  `extend-chaining` median `5.40ms` unstable, and `media` median `5.12ms`
  usable.

Interpretation: leash status only, not a speed claim. The change is accepted
as a direct render-buffer staging cleanup; no before/after performance
conclusion is claimed, and two fixtures were unstable.

### Url Scalar Render Readback Cut

Date: 2026-06-15.

Change: `Url.render(...)` now resolves/selects the child first and writes
scalar `Any` URL render output directly as normalized `url(...)` text. Flat
render-buffer output skips prepared print-state setup, writer mark/getSince,
replaceSince, and writer-to-buffer copy for this scalar path. Non-scalar URL
normalization remains on the localized capture boundary.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `15.68ms` usable, `import-reference` median
  `51.60ms` noisy, `mixins-guards` median `17.93ms` usable,
  `extend-chaining` median `5.79ms` unstable, and `media` median `5.84ms`
  unstable.

Interpretation: leash status only, not a speed claim. The
`import-reference` sample was too noisy to use as decision-quality evidence;
the patch is accepted as a direct scalar render cleanup, not as a measured
performance win.

### Paren Dynamic Wrapped Render Sink Fix

Date: 2026-06-15.

Change: `Paren.renderEvaluatedNode(...)` now keeps dynamically resolved child
render output out of explicit caller writers until the paren has wrapped the
returned string. Explicit writer render now writes `(child)` instead of letting
the child write `child`, and buffer render with a writer option writes only the
final wrapped string to the buffer.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `15.33ms` unstable, `import-reference` median
  `23.27ms` usable, `mixins-guards` median `18.81ms` usable,
  `extend-chaining` median `6.52ms` usable, and `media` median `5.34ms`
  unstable.

Interpretation: leash status only, not a speed claim. This is a
sink-correctness and staging cleanup; two fixtures were unstable.

### Quoted Escaped Literal Render Sink Fix

Date: 2026-06-15.

Change: `Quoted.renderResolvedQuotedValue(...)` now writes escaped literal
render output to explicit writers when no render buffer is passed, and keeps
buffer render output out of those writers. This aligns the returned render
string and requested sink for the escaped literal scalar path.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `15.16ms` unstable, `import-reference` median
  `21.61ms` usable, `mixins-guards` median `19.32ms` usable,
  `extend-chaining` median `5.91ms` usable, and `media` median `5.93ms`
  unstable.

Interpretation: leash status only, not a speed claim. This is a
sink-correctness and staging cleanup; two fixtures were unstable.

### AttributeSelector ValueOf Name Stringification Cut

Date: 2026-06-15.

Change: `AttributeSelector.valueOf()` now builds comparison keys for
node-valued names from `String(name.valueOf())` instead of public
`name.toTrimmedString()` source rendering. This removes public stringification
transport from the attribute key path without changing render behavior.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `14.93ms` usable, `import-reference` median
  `24.12ms` unstable, `mixins-guards` median `18.28ms` usable,
  `extend-chaining` median `6.20ms` usable, and `media` median `6.40ms`
  unstable.

Interpretation: leash status only, not a speed claim. This is a public
stringification transport cut; two fixtures were unstable.

### Quoted Compare Stringification Cut

Date: 2026-06-15.

Change: `Quoted.compare(...)` fallback now compares `valueOf()` results instead
of calling public `toString()` on either operand. This removes public
stringification transport from a comparison path without changing render
behavior.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `14.57ms` usable, `import-reference` median
  `20.91ms` unstable, `mixins-guards` median `16.10ms` usable,
  `extend-chaining` median `5.68ms` unstable, and `media` median `5.26ms`
  unstable.

Interpretation: leash status only, not a speed claim. This is a public
stringification transport cut; three fixtures were unstable.

### Sequence Single-Item Buffer Sink Fix

Date: 2026-06-15.

Change: `Sequence.renderResolvedValue(...)` no longer passes an explicit caller
writer into single-child render when a render buffer is the requested sink. The
child render result is written once to the buffer, keeping buffer-only render
from also mutating an unrelated writer. `List` was checked for the same leak;
its buffer path already strips explicit writers through
`prepareBufferPrintState(...)`.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `15.32ms` unstable, `import-reference` median
  `20.29ms` usable, `mixins-guards` median `16.24ms` usable,
  `extend-chaining` median `5.40ms` usable, and `media` median `5.30ms`
  unstable.

Interpretation: leash status only, not a speed claim. This is a
sink-correctness and staging cleanup; two fixtures were unstable.

### Call Token Argument Scalar Render Cut

Date: 2026-06-15.

Change: `Call.serializeRenderedArgsFrom(...)` now sends owned static token
arguments (`Any`, `Anonymous`, `Keyword`) through the existing scalar
`writeSyntax(...)` fast path when no trivia is active, matching the already
direct numeric/color/bool contracts. `Call.writeEvaluatedSyntax(...)` also
writes those token scalar contracts directly instead of calling
`evalImmediateSync(...)` first.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `15.78ms` usable, `import-reference` median
  `22.02ms` usable, `mixins-guards` median `17.10ms` usable,
  `extend-chaining` median `5.59ms` usable, and `media` median `5.24ms`
  unstable.

Interpretation: leash status only, not a speed claim. This is a Call
render/stringification staging cut; one fixture was unstable.

### Interpolated Embedded Scalar Selector Materialization Cut

Date: 2026-06-15.

Change: `Interpolated.createSelector(...)` now reads owned scalar token text
directly for embedded selector replacements (`Any`, `Anonymous`, `Keyword`)
instead of calling public `toTrimmedString(...)` before assembling selector
text. Non-scalar embedded replacements still use the existing boundary for
generated `:is(...)` wrapping, compound token splitting, and public
selector/generic materialization.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `23.22ms` noisy, `import-reference` median
  `42.06ms` noisy, `mixins-guards` median `18.89ms` unstable,
  `extend-chaining` median `6.37ms` usable, and `media` median `6.43ms`
  usable.

Interpretation: selector materialization transport cut only; do not claim a
speed win from the focused test. The two largest fixtures were noisy and one
fixture was unstable.

### Call Finalized Empty Fallback Readback Cut

Date: 2026-06-15.

Change: `Call.renderFinalizedCallSyntax(...)` now writes and returns known
empty finalized string-name fallback syntax directly when there are no args and
no content. This avoids opening a call-level writer mark/readback for optional
fallback output such as `bad()`.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `14.96ms` unstable, `import-reference` median
  `20.52ms` unstable, `mixins-guards` median `17.04ms` usable,
  `extend-chaining` median `5.56ms` unstable, and `media` median `5.37ms`
  unstable.

Interpretation: fallback syntax staging cut only; do not claim a speed win from
the focused test. Four fixtures were unstable.

### Declaration Direct Writer Outer-Readback Cut

Date: 2026-06-16.

Change: `Declaration.writeSyntax(...)` now calls a direct writer body instead of
calling the string-return `declValueTrimmedString(...)` wrapper and discarding
its result. Public `toTrimmedString(...)` and render string-return boundaries
still keep the wrapper.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `12.54ms` unstable, `import-reference` median
  `23.59ms` usable, `mixins-guards` median `14.74ms` usable,
  `extend-chaining` median `4.77ms` usable, and `media` median `4.55ms`
  unstable.

Interpretation: declaration writer staging cut only; do not claim a speed win
from the focused test. Two fixtures were unstable.

### Rules Root Charset Direct Syntax Cut

Date: 2026-06-16.

Change: root-aware `Rules.toString(...)` now emits `context.currentCharset`
through direct `writeSyntax(...)` instead of detached public
`toTrimmedString(...)` transport. Root imports remain on the existing detached
stringification path.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `13.88ms` unstable, `import-reference` median
  `17.15ms` usable, `mixins-guards` median `16.97ms` usable,
  `extend-chaining` median `5.98ms` noisy, and `media` median `5.39ms`
  usable.

Interpretation: root serializer transport cut only; do not claim a speed win
from the focused test. One fixture was unstable and one was noisy.

### Operation Buffer Writer Leak Cut

Date: 2026-06-16.

Change: preserved-operation flat-buffer render now strips caller-supplied
explicit writers before rendering evaluated operands to the intermediate
operation string. The final combined operation text is written to the render
buffer once, so buffer render no longer also mutates the caller writer with
operand fragments.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `12.41ms` unstable, `import-reference` median
  `16.80ms` usable, `mixins-guards` median `14.42ms` usable,
  `extend-chaining` median `4.56ms` usable, and `media` median `4.33ms`
  unstable.

Interpretation: render-buffer ownership cut only; row 15 remains open for
`withOperands(...)` copy pressure and preserve-mode `calc(...)` fallback
ownership. Do not claim a speed win; two fixtures were unstable.

### Reference Buffer Writer Leak Cut

Date: 2026-06-16.

Change: buffer `Reference.render(...)` now strips caller-supplied explicit
writers before rendering resolved child nodes. Reference buffer output writes
only the returned child text to the requested render buffer, instead of also
mutating the caller writer during child rendering.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `12.33ms` unstable, `import-reference` median
  `17.65ms` usable, `mixins-guards` median `16.67ms` usable,
  `extend-chaining` median `5.91ms` noisy, and `media` median `5.32ms`
  unstable.

Interpretation: render-buffer ownership cut only; the Reference row remains
open for rules-like surfaces, public value materialization, merged assign
normalization, and key conversion. Do not claim a speed win; two fixtures were
unstable and one was noisy.

### Interpolated Scalar Replacement Capture Cut

Date: 2026-06-16.

Change: public `Interpolated.replace(...)` now reads owned scalar replacement
text directly for `Any`/`Anonymous`/`Keyword` replacements instead of routing
through public `toTrimmedString(...)` on a detached writer.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `13.81ms` unstable, `import-reference` median
  `18.01ms` usable, `mixins-guards` median `16.45ms` usable,
  `extend-chaining` median `4.71ms` usable, and `media` median `4.99ms`
  usable.

Interpretation: cold scalar replacement capture cut only; the Interpolated row
remains open for non-scalar embedded selector assembly, generic
materialization, non-scalar cold replacement capture, and replacement arrays.
Do not claim a speed win; one fixture was unstable.

### Interpolated Generic Output String Transport Cut

Date: 2026-06-16.

Change: `Interpolated.createGeneric(...)` now builds the public `Any` result
value by writing evaluated replacements directly through
`writeWithReplacements(...)` instead of calling public
`Interpolated.toTrimmedString(...)` on itself.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `19.74ms` noisy, `import-reference` median
  `27.43ms` usable, `mixins-guards` median `19.59ms` unstable,
  `extend-chaining` median `7.40ms` usable, and `media` median `7.00ms`
  unstable.

Interpretation: generic-materialization string transport cut only; the
Interpolated row remains open for non-scalar embedded selector assembly,
remaining generic materialization boundaries, non-scalar cold replacement
capture, and replacement arrays. Do not claim a speed win; two fixtures were
unstable and one was noisy.

### Interpolated Generated Selector-List Wrapper Cut

Date: 2026-06-16.

Change: embedded selector-list interpolation still uses the generated
`PseudoSelector` wrapper for `:is(...)` semantics, but now writes the wrapper
through `PseudoSelector.writeSyntax(...)` on the detached selector assembly
boundary instead of calling public `PseudoSelector.toTrimmedString(...)`.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `16.78ms` unstable, `import-reference` median
  `23.37ms` usable, `mixins-guards` median `17.77ms` usable,
  `extend-chaining` median `6.57ms` usable, and `media` median `6.57ms`
  unstable.

Interpretation: selector-materialization string transport cut only. Do not
claim a speed win; keep the `Interpolated` row open for remaining generic
materialization boundaries, non-scalar cold replacement capture, and
replacement arrays. Two fixtures were unstable.

### Interpolated Non-Scalar Replacement String Transport Cut

Date: 2026-06-16.

Change: public `Interpolated.replace(...)` still owns a cold string
materialization boundary, but non-scalar replacements now write through direct
`replacement.writeSyntax(...)` on a detached writer instead of calling public
replacement `toTrimmedString(...)`.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `18.10ms` unstable, `import-reference` median
  `29.04ms` usable, `mixins-guards` median `18.64ms` usable,
  `extend-chaining` median `6.09ms` usable, and `media` median `6.47ms`
  usable.

Interpretation: cold public replacement string transport cut only. Do not claim
a speed win; keep the `Interpolated` row open for remaining selector/generic
materialization boundaries and replacement arrays. One fixture was unstable.

### Interpolated Non-Scalar Selector Assembly String Transport Cut

Date: 2026-06-16.

Change: whole and embedded non-scalar selector interpolation now reuse the
direct replacement syntax writer instead of calling public replacement
`toTrimmedString(...)` before building selector output.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `16.50ms` noisy, `import-reference` median
  `25.75ms` unstable, `mixins-guards` median `18.15ms` usable,
  `extend-chaining` median `5.91ms` usable, and `media` median `5.99ms`
  usable.

Interpretation: selector assembly string-transport cut only. Do not claim a
speed win; keep the `Interpolated` row open for replacement-array and selector
ownership boundaries. One fixture was noisy and one was unstable.

### Rules Root Import Direct Syntax Cut

Date: 2026-06-16.

Change: root `Rules.toString(...)` now writes plain no-trivia top imports
through direct `AtRule.writeSyntax(...)` instead of calling public
`AtRule.toString(...)` on a detached writer. Complex/trivia-backed imports
remain on the existing detached stringification path.

Hotpath status:

- Final bounded `pnpm run measure:less:hotpath -- --iterations 15 --warmup 5`
  reported: `functions` median `16.01ms` noisy, `import-reference` median
  `21.43ms` usable, `mixins-guards` median `17.67ms` usable,
  `extend-chaining` median `5.84ms` usable, and `media` median `5.63ms`
  unstable.

Interpretation: root serializer transport cut only; the Rules row remains open
for body eval/render, complex imports, placement state, merge output, duplicate
declaration materialization, and broader root serializer capture. Do not claim
a speed win; one fixture was unstable and one was noisy.

## Parked Lessons

- Declaration pre-render caching regressed enough real benchmarks that it should
  not be retried broadly without a tighter profile target.
- Virtual callable-output wrappers passed focused tests but slowed real
  hot-path samples; do not replace owned children with wrapper objects on the
  hot path.
- Local copy-loop polishing is not a destination. Delete the reason for the
  copy or move ownership behind a cold materialization boundary.
- `profile-less-benchmark.mjs` elapsed time is profiler overhead. Do not report
  it as a user-facing speed result unless debugging the profiler itself.
