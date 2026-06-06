# Core Architecture Performance Handoff

This file is the benchmark/profile doctrine and evidence log for Jess core
architecture work.

Use `HANDOFF.md` for active integration: current mode, next pass, and the
specific benchmark leash applied to the queue. Use
`AGGRESSIVE-CUTTING-REVIEW.md` for the hardline cutting doctrine. Use this file
for benchmark protocol, measured targets, rejected experiments, historical
evidence, active performance queues, and reactivation thresholds.

Current mode: **benchmark-leashed aggressive cutting**. Performance is no
longer merely parked. The active handoff decides the next target, but the
target must be tied back to this file's benchmark/profile evidence rules.

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

Performance is active again as a leash on aggressive cutting. The next broad
eval/render/lookup/copy/rules/render-buffer change must start from a current
benchmark or profile target and end with the same benchmark/profile rerun.

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
