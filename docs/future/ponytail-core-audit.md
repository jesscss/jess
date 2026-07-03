# Ponytail Audit: @jesscss/core Slimming Plan

Date: 2026-07-03 · Branch context: `feature/parseman` · Status: plan only, nothing applied.

Method: [ponytail](https://github.com/DietrichGebert/ponytail) decision ladder — YAGNI →
reuse → stdlib/platform → existing deps → minimal expression → full implementation last.
Code gets small because it is *necessary*, not golfed; correctness/safety cuts are off the
table. This plan complements (does not replace) the aggressive-cutting program in
`docs/future/core-architecture/HANDOFF.md`; every item below is meant to be executed as a
prosecutable pass under that regime.

Snapshot: `packages/core/src` = 145 non-test files, ~55k LOC. Largest:
`tree/rules.ts` 6,247 · `tree/util/extend.ts` 4,287 · `tree/reference.ts` 3,825 ·
`tree/ruleset.ts` 2,437 · `tree/util/selector-match-core.ts` 2,111 · `tree/node-base.ts` 1,623.

---

## A. Slim the API (no back-compat constraints)

### Findings

1. **Everything is public.** `src/index.ts` is ~15 `export *` lines and
   `src/tree/index.ts` re-exports **every node module** (~55 `export *` lines). The
   public surface is effectively all 145 files: internal flags (`F_EXTEND_TARGET`,
   `F_IMPLICIT_AMPERSAND`), lookup internals, print-state helpers, scope-frame guts.
2. **The real consumer surface is small.** `packages/css-parser/src/builders.ts:20-44`
   imports ~35 names: node classes + a handful of types (`TriviaMap`, `LocationInfo`,
   `CompoundSelectorComponent`…) + `makeTrivia`/`nil`. The other parsers are the same
   shape. `fns`/plugins additionally need `defineFunction`, value-node classes,
   `Context`, and the error/diagnostic types.
3. **Node's public method surface is enormous** (`node-base.ts`): `toString`,
   `toTrimmedString`, `writeSyntax`, `render` (2 overloads), `renderSource`,
   `renderOutput`, `resolve`, `eval`, `evalNode`, `valueOf`, `compare`, `operate`,
   `clone`, `cloneForPlacement`, `accept`, `walk`, `nodes`, `adopt`, `inherit`,
   `detachTrivia`, `prepareRegistration`, `parentChildren`, flag methods… Most exist for
   core-internal eval/render plumbing, not for consumers.

### Plan

- **A1. Replace `export *` with explicit export lists.** *Status 2026-07-03:
  first pass LANDED — `src/index.ts` is explicit for all util/infra modules;
  compare/cast/find-extendable-locations/collections fully internalized (census:
  zero external consumers). Remaining: the tree barrel itself, and per-module
  explicit lists for plugin/jess-error/define-function/types/visitor. Census
  data: 145 unique names consumed across 12 packages; conversions.ts exports
  `clamp`/`lengthToPx`/`timeToMs`/`frequencyToHz`/`angleToRadians` with zero
  consumers anywhere → C-item deletion candidates. `getValues` is imported by
  language-service but does not exist in core (pre-existing breakage, task
  chip filed).* Derive the list empirically:
  `grep -rhoE "import[^;]*from '@jesscss/core[^']*'" packages --include='*.ts' | grep -v packages/core/`
  (blocked during this audit by a tooling outage — run it as the first step). Expected
  tiers: (i) node classes + factories + `Node`/`TreeContext`/`Context`; (ii) plugin/diagnostic
  types (`PluginInterface`, `ErrorDiagnostic`, `WarningDiagnostic`, `JessError`,
  `defineFunction`); (iii) a small `@jesscss/core/internal` (or non-exported deep path)
  for the language-service/tests. Everything else becomes module-private.
- **A2. Stop exporting flag bits and print/lookup internals** from the barrel. External
  code reaching for `F_*` constants is a missing abstraction — give parsers/plugins the
  one or two predicates they actually need instead.
- **A3. Shrink Node's public contract** to: construction, `clone()`, `eval/resolve`,
  `render`, `toString`, `compare`, `valueOf`, `walk`. Mark eval/render plumbing
  (`renderSource`, `renderOutput`, `evalNode`, `prepareRegistration`, `parentChildren`,
  `adopt`, `inherit`, `propagateFlagsFrom`, `detachTrivia`) `protected`/`@internal`.
  HANDOFF already states the rule: an unreleased public-looking method kept "for
  compatibility alone" gets deleted or reshaped.
- **A4. Delete deprecated option aliases** once the grep confirms no consumer:
  `disablePluginRule` (`context.ts:66`), `leakyRules`/`bubbleRootAtRules` are marked
  `@deprecated - a Less feature` but still plumbed through three layers
  (`ContextOptions` → `TreeContext` → `Context` getters at `context.ts:481-489`). If
  the less-compat plugin needs them, keep exactly one storage location (Context),
  not three.

## B. Proper abstraction

### Findings

1. **`Context` is a god object** (`context.ts:239-861`): eval state (frames, stacks,
   extend registry, selector bits) *plus* file-path resolution (`_getPath`, ~100 lines
   incl. `createRequire` fallback), plugin parser dispatch, JSON module importing,
   `parseString`, `getModule`, and CSS-module class hashing. Two unrelated lifetimes in
   one class.
2. **Three coexisting child-ownership regimes** (`node-base.ts:392-398`): `childKeys ===
   undefined` (legacy `.value` introspection), `null` (migrated leaf), `string[]`
   (direct fields). Every traversal primitive (`parentChildren`, `_visitEntries`,
   `_visitValues`, `walk`, `clone`, `detachTrivia`) branches on all three, and the
   generic array/plain-object walkers (`visitValueEntries`, `visitLeafValues`,
   `_walkFromValue`, `_mapChildNodes`, `cloneValue`) each reimplement
   array/object/node recursion — five copies of the same shape-dispatch.
3. **Four type-checking idioms in simultaneous use**: `instanceof Node`, `isNode(x,
   N.Foo)` bitmask, string compare (`possibleRules.type !== 'Rules'`,
   `node-base.ts:759`, inside a loop that *also* calls `isRulesNode`), and duck-typing
   (`isSelectorLike` in `tree/index.ts:89`, `'frames' in node` at `node-base.ts:123`).
4. **Circular-dependency patches are load-bearing**: `node.ts` patches
   `Node.prototype.nil`/`operate`; `tree/index.ts:96` patches
   `Selector.prototype.compare` after all exports. Module layering is inverted (base
   class needs leaf classes).
5. **Two construction paths with different semantics**: raw `new Foo()` shares children;
   the `defineType`-generated lowercase factory `Reflect.construct`s then calls
   `parentChildren()` (invariant 7, `node-base.ts:230-236`). Subtle, and `Reflect.construct`
   defeats inlining. HANDOFF already flags `defineType` for a separate audit.
6. **Serialization has ~8 entry points** (`toString`, `toTrimmedString`, `writeSyntax`,
   `render`×2, `renderSource`, `renderOutput`, `valueOf`) with per-family
   `getWriterTextSincePosition` helpers now duplicated in `control.ts`,
   `declaration-var.ts`, `function.ts`, `operation.ts`, `ampersand.ts` (per HANDOFF, one
   copy each — reuse rung violation).
7. **Visitor over-abstraction**: `accept()` (`node-base.ts:1001`) supports three visitor
   protocols via runtime reflection (`getTreeVisitMethod`/`getVisitMethod`/
   `getTypeVisitMethod` + `ABORT` symbol) on every node visit. Ponytail rung 1: does more
   than one protocol need to exist?
8. **`rules.ts` (6,247 lines) is four subsystems in one file**: registration/prep,
   scope-frame lookup (mixin/ruleset namespace machinery with sentinel symbols,
   `rules.ts:124-130`), render-state management, and import handling. Same story in
   `reference.ts` (3,825) and `ruleset.ts` (2,437).

### Plan

- **B1. Split `Context`**: keep `Context` as pure eval state; extract
  `ImportResolver` (path resolution + plugin dispatch + module import — everything
  `async`) behind one field. `hashClass`/`generateId` move with the module-output
  concern. No behavior change; the split makes D/E work reviewable.
- **B2. Finish the `childKeys` migration and delete the legacy regime.** Target state:
  `childKeys` is `string[] | null` only. Then delete `visitValueEntries`'
  plain-object branch, `visitLeafValues`' object branch, `_walkFromValue`'s object
  branch, `cloneValue`'s object recursion, and `parentChildren`'s `undefined` arm.
  This is the single highest-leverage abstraction cut: five shape-dispatch walkers
  collapse into one `childKeys` loop.
- **B3. One type-check idiom.** `isNode` + `N.*` everywhere hot; `instanceof` only where
  identity matters and the bitmask is shared (`AtRuleStatement`, `RelativeSelector`,
  `Stylesheet` — `node-type.ts:53,95,115`). Delete string-compare and duck-type checks.
  The 32-bit mask is exhausted; if a new concrete type ever needs a bit, move `flags`
  runtime bits out of the way first (see E4) rather than adding a second mechanism.
- **B4. Fix the layering instead of patching prototypes**: `Nil`/`Any` are leaves with no
  real dependency on the tree — move the `nil()`/string-`operate` defaults into a tiny
  `node-leaves.ts` that `node-base.ts` may import directly, and delete the `node.ts`
  patch file and the `Selector.compare` patch (give `Selector` its own `compare` in
  `selector.ts`; `selectorCompare` already lives in `util/compare.ts`).
- **B5. One construction path.** Make constructors own one-level parenting (call
  `parentChildren()` at the end of each concrete constructor, or make eval-time sharing
  the explicit opt-in) and delete the `Reflect.construct` factory wrapper in
  `defineType`. Keep the lowercase factories as plain `(…) => new Foo(…)` sugar for
  parsers.
- **B6. Two serialization entry points**: `writeSyntax(printOptions)` (authored source,
  writer-owned) and `render(context, buffer)` (evaluated output). `toString`/
  `toTrimmedString` become thin cold wrappers on `writeSyntax`; `renderSource`/
  `renderOutput` fold into `render`. Hoist the five duplicated
  `getWriterTextSincePosition` helpers into `util/print.ts` (or better: give
  `OutputWriter` the tail-text reader HANDOFF says it's missing, deleting the
  `Reflect.get(writer, 'chunks')` boxes).
- **B7. One visitor protocol.** Inventory actual visitors (grep `accept(` /
  `TreeVisitor`); keep the one used, delete the reflection fallbacks and the
  `ABORT`/`REMOVE`/`IS_PROXY` symbols (`node-base.ts:54-56` — `IS_PROXY` in particular
  looks orphaned post-proxy-removal; verify).
- **B8. Split `rules.ts`** along its existing seams: `rules-registration.ts`,
  `rules-lookup.ts` (the callable/namespace machinery, already helper-shaped),
  `rules-render.ts`. Pure file moves, no new abstraction — do this *after* dead-code
  passes so we don't reorganize code that's about to be deleted.

## C. Remove dead code

Verification for each: repo-wide grep for the identifier (excluding its own file and
tests), then delete; confidence noted. (Shell was blocked during this audit — every item
below is from direct reading and needs the grep pass as its proof surface.)

- **C1. Legacy extend (`tree/util/extend.ts`, 4,287 lines).** Walk-and-consume
  (`extend-walk.ts`) already handles Simple/Compound application and Complex find for
  diagnostics; legacy remains reachable via `canUseWalkAndConsumeForExtend`. This is the
  single largest deletion available (~8% of core). Queue: extend walk to Complex
  application parity → flip the gate → delete `extend.ts` and its test twin. Not
  deletable today; make it the explicit target so no new code lands in the legacy file.
- **C2. Commented-out and `@todo`-delete debris in `node-base.ts`**: `collectRoots`
  (975-989), `toModule` block (1614-1619), `Primitive`/`PrimitiveOrFunc` + the three
  symbols (49-56), `Mutable`/`ValueBearingNode` types (283-291), `NodeMapArray` (79-83),
  `GeneratedNodeValue` (192-195), commented flag reserves (276-281). Also
  `context.ts`: `isRuntime` comment block (466-469), `exports` set marked `@todo remove`
  (460-464), `parentScope` marked `@todo remove` (`context.ts:114-119`). Certain-dead
  after grep: delete.
- **C3. `Node.create` static factory** (`node-base.ts:740-755`) — a third construction
  path ("marks generated"). If B5 lands, `generated` becomes a constructor
  option/flag and `create` dies. Verify callers first (likely only eval sites that can
  set the flag directly).
- **C4. Vestigial node classes.** Suspects: `combinator.ts` (recent commits flipped
  combinator construction to string leaves — once parsers stop constructing
  `Combinator`, delete the class and its `N` bit), `selector-capture.ts`,
  `selector-interpolated.ts`, `rules-raw.ts`, `range.ts`, `log.ts`, `any.ts`-adjacent
  leftovers. For each: check the three parser `builders.ts` files + core constructors
  before concluding dead (builders currently still import `Combinator`,
  `css-parser/src/builders.ts:32`).
- **C5. Top-level modules with unclear consumers**: `use-webpack-resolver.ts`,
  `debug-log.ts`, `conversions.ts` (root copy — `dimension.ts` has its own private
  `conversions` table at 401-421; if the root one is the only "reuse", inline or delete),
  `logger/deprecation-processing.ts` + `deprecation.ts` (registry exists but parser
  deprecations are not emitted — either wire it for v5 or cut it until needed; don't
  carry half-wired infra).
- **C6. `accept()`/visitor fallbacks and `IS_PROXY`** — see B7.
- **C7. Duplicated `getWriterTextSincePosition`** ×5 — see B6 (delete four copies).
- **C8. `Dimension.unitToGroup` getter + `isConversionUnit`** (`dimension.ts:89-95`)
  exist only to indirect a module constant — inline the constant; the getter is also a
  per-operate megamorphic read for no benefit.

## D. Reduce object creation

Hot paths: per-render node eval, selector composition/matching, serialization.
(Benchmark baseline 1,122ms vs Less 4.x 49ms — allocation churn is a first-order cost.
Every item here needs the before/after benchmark per `PERFORMANCE-HANDOFF.md` protocol —
no defensive slowdowns, but also no unmeasured speed claims.)

**Micro-pattern guidance (from parseman profiling, 2026-07):** hoisting a repeated
cheap access (`s.charCodeAt(pos)`, plain monomorphic field reads) into a local was
measured MUCH slower in parseman hot loops. V8 already GVN-eliminates redundant
effect-free inlined loads, so the manual local only adds register pressure (spills) —
and if any closure in scope captures the local, it gets context-allocated: every read
becomes a heap context-slot load and the captured value's lifetime extends (the GC
angle). Rules for D/E passes: (i) repeat plain field reads freely, don't hoist by
habit; (ii) DO hoist (or better, restructure away) side-effecting/megamorphic accesses
V8 must re-execute — lazy `??=` getters, `.options` probes; (iii) audit hot eval/render
loops for closures that capture loop locals — context allocation is the variant that
actually bites; (iv) decide disputed cases with the benchmark, not intuition, in either
direction.

- **D1. Generator-based traversal on hot paths.** `walk()`/`nodes()`/`_walkFromValue`
  (`node-base.ts:873-970`) allocate generator frames per node per traversal; `accept()`
  spins a generator per visit. HANDOFF already names generators an audit target. Replace
  hot-path uses with `_visitEntries`-style callback loops (already exists — reuse rung);
  keep the generator API only if a cold consumer genuinely needs laziness.
- **D2. `toString` mark/readback windows.** `Node.toString` (`node-base.ts:1476-1495`)
  does `w.mark()`/`w.getSince(mark)` per node — string slicing per node per render.
  HANDOFF has been deleting these family-by-family; finish the sweep (the base method is
  the last and biggest copy), so interior nodes write straight through and only true
  public boundaries read back.
- **D3. Per-serialization array rebuilds in `SelectorList.writeSyntax`**
  (`selector-list.ts:107-141`): every render allocates a new `value[]` and re-runs the
  `:is()` unwrap over the same immutable list. Compute once (the unwrap is a function of
  the parsed shape, not of print options) and cache on the node, or do the unwrap at
  construction/eval time.
- **D4. Clone-chain churn in selector eval**: `withSelectors` → `ownSelector` →
  `cloneForPlacement` → `clone` (+ `{ ...this._options }` spread per clone,
  `node-base.ts:1118`) allocates several objects per selector per eval. Options are
  usually absent or shared-immutable: stop copying `_options` on clone (treat as frozen),
  and let `withSelectors` return `this` when no item changed (common case).
- **D5. `forEachNode` async bookkeeping** (`node-base.ts:782-834`) allocates
  `nodes/keys/collections` arrays whenever `F_MAY_ASYNC` — verify the flag isn't
  over-set (it propagates up via `adopt`, so one async leaf taints the whole spine
  forever). A cheap win: re-derive the flag after imports resolve, or key the async path
  off actual thenables encountered.
- **D6. Accessors that allocate per read**: `span` and `location` are both subsumed by
  E6 (store parseman's `Span` directly; shared frozen empty for generated nodes);
  `options` (allocates a null-proto object on
  first *read*, even read-only probes like `rules.options.importBoundary` at
  `rules.ts:163` — split a cheap `hasOption`/direct-field read from the mutable getter).
- **D7. `valueOf()` string building** (`node-base.ts:1443-1464`) concatenates via
  `_visitValues` per comparison; selector compare paths call it repeatedly. Cache on
  immutable nodes or compare structurally (the `keySet`/bitset machinery already exists
  for selectors — reuse it instead of string keys).
- **D8. `Context` eager fields**: `extendRoots`, `selectorBits`, `frames`,
  `rulesetFrames`, `allRoots`, `rulesEvalStack`, `parenFrames`, `errors`, `warnings` are
  allocated per Context even for tiny evals; several already use the lazy-`??=` pattern —
  make it uniform (cheap, mechanical).

## E. Optimize class shapes for V8

- **E1. Kill post-construction field creation.** Fields written outside constructors
  create hidden-class transitions or dictionary fallback: `_closureScope` (written in
  `inherit`, `node-base.ts:1427-1431`), `frames` (written cross-class in
  `_copyPlacementMetadataTo`, 1147-1163, on `Node`s that never declared it),
  `fieldSpans`/`valueSpans` (`declare`d, assigned by scanners), `_scopeFrame` (Rules),
  error tagging `_isPathResolutionError` (`rules.ts:89`). Rule: every field a class can
  ever hold is assigned (at least `undefined`) in its constructor; `declare` +
  late-assign is exactly the anti-pattern. Where a field is rare/cold (closureScope,
  frames), prefer a `WeakMap` side table over widening every node.
- **E2. `_createMinimalNil`** (`node-base.ts:1224-1233`) mutates `type`/`shortType`/
  `nodeType`/`value` onto a raw `Node` instance — instant shape divergence *and* it
  shadows prototype fields. B4's layering fix (base can construct a real `Nil`) deletes
  this entirely.
- **E3. Slim the per-node field count.** Base `Node` initializes ~17 own fields; at
  millions of nodes this is both memory and constructor time. Fold the booleans into the
  existing `flags` bitmask: `generated`, `frozen`, `registrationPrepared`, `allowRoot`,
  `allowRuleRoot` → `F_GENERATED`, `F_FROZEN`, `F_REG_PREPARED`, … (flags already has
  spare bits; `fullRender` is already prototype-resident — same trick). `hoistToRoot`
  (tri-state) can be two bits. Net: 6 fields → 0.
- **E4. Parséman overhead on every node**: `state` (unknown, per-node), `_tag` (constant
  string — move to prototype), `_cstChildren` (array-typed field, initialized to a fresh
  `[]`-typed constant per class load but an own field per instance… it's a class field
  initializer, so it *is* per-instance shape-stable but forces the field on all nodes),
  `span` getter. If incremental re-parse state is only needed on parse-owned roots, move
  `state`/`_cstChildren` to a side table keyed by node; at minimum share one frozen empty
  array and put `_tag` on the prototype.
- **E5. Mixed-type fields are now deliberate — contain them.** `SelectorListItem =
  Selector | string` (and compound/complex equivalents) makes every consumer site
  polymorphic (`typeof item === 'string'` ladders throughout `selector-list.ts`). The
  string-backing decision is sound (fewer nodes); the shape cost is confined so long as
  loops stay monomorphic per-branch. Guard: no *new* `X | string | undefined` unions on
  hot node fields; normalize `unit?: string` style fields to `string | ''`-or-`undefined`
  consistently (Dimension holds `unit: string | undefined` — fine, it's always assigned).
- **E6. One location representation, chosen by measurement (user-directed: most
  performant wins).** *Status 2026-07-03: core-side step LANDED on
  `feature/parseman` — `_location` is now a prototype accessor whose setter
  denormalizes `spanStart`/`spanEnd` inline number fields on `Node`; all hot core
  reads (`location[0]`/`location[3]` in trivia/serialize/list/sequence/selector
  paths, `canReuseAsLeaf`/`canReuseLeaf`, the `span` getter) read the fields
  directly. The tuple is retained solely because parser packages assign and
  mutate it post-construction (out of core-only scope); the parser-side pass
  below finishes the job. Core test failure set unchanged vs baseline, plus one
  previously-failing test now passes (cloning.test.ts "inherits source-free
  nodes without allocating empty location arrays"). No speed claim: the jess
  benchmark harness does not build in this worktree (pre-existing
  rolldown-plugin-dts/typescript-rc failure), so run the ref-compare A/B once
  the branch commits.* Today the same source range exists in up to THREE forms: the
  parser's `Span {start, end, startLine?, …}`, a fresh 6-tuple `LocationInfo` array
  allocated per node by the builders (`spanToLocation`,
  `css-parser/src/builders.ts:98-100`), and a fresh `{start, end}` object allocated on
  *every* `span` getter access (`node-base.ts:459-464`) for Parséman's `NodeLike`.
  Deleting the conversions is unconditional; the storage form is decided by a cheap A/B
  (per the no-unmeasured-claims rule), between:
  - **(a) Two inline numeric fields** `spanStart`/`spanEnd` assigned in the base
    constructor — the theoretical ceiling: SMIs in-object, zero extra heap objects, zero
    pointer chase on the hot reads (`location[0]`/`location[3]` today), and the GC never
    sees a location object. `NodeLike.span` becomes a lazily *cached* materialization
    (`_span ??= {start, end}`) — cold, only touched by incremental re-parse. Offsets
    stay SMI up to 2^30 (a 1GB file), so no heap-number risk in practice.
  - **(b) Store the parser-created `Span` object as a plain field** — zero *marginal*
    allocation (parseman allocated it anyway), satisfies `NodeLike` directly, but keeps
    one live object per node and costs a dereference per location read.
  Expected winner is (a) for eval/render-heavy workloads (reads dominate) with (b) as
  the fallback if the benchmark says the pointer chase is noise. Either way:
  line/column columns are derived lazily via parseman's own `buildLineIndex` /
  `offsetToLineCol` / `annotateSpan` on cold error/diagnostic paths only (rung 5: the
  dependency already solves this), retiring the `TreeContextOptions.file.lines` cache;
  the `LocationInfo` 6-tuple and `spanToLocation` are deleted; generated nodes get the
  no-location representation for free ((a): `-1/-1` sentinel or 0-width; (b): one shared
  frozen empty span) instead of the lazy `[]` allocation in the `location` getter
  (`node-base.ts:401-403`). If (b) wins, shape guard: parser-minted spans keep one
  consistent field set so the shared Span hidden class stays monomorphic.
- **E7. Constructor discipline for subclasses.** Good model already exists:
  `Dimension` assigns `number`/`unit` unconditionally in constructor order
  (`dimension.ts:71-74`). Bad model: options-object spread/iteration into `this`
  (`TreeContext` destructure-and-assign is cold, fine; verify no node class does
  `Object.assign(this, value)`). Add a lint/test that every concrete node class assigns
  the same field set on every construction path.
- **E8. Delete the `value`-record + direct-fields double-store.** `Dimension` still
  passes the `{number, unit}` record to `super(value…)` which stores… nothing now
  (base `void value`), good — but nodes not yet migrated store children in a generic
  `value` record *and* readers use typed getters, keeping both shapes alive. Completing
  B2 makes every node direct-field only; the base constructor's `value` param then
  disappears, shrinking every constructor call site.

---

## Execution queue (ordered, each item = one prosecutable pass)

Ordering principle: delete before you reorganize; reorganize before you optimize;
measure everything in D/E against the benchmark protocol.

1. **A1+A2** explicit exports (grep-driven) — makes all later deletions safe to verify.
2. **C2/C3/C5/C6/C7** small certain-dead deletions (one pass, grep proof each).
3. **B2+E8** finish childKeys migration; delete legacy `.value` walkers.
4. **B4+E2** layering fix; delete prototype patches + `_createMinimalNil`.
5. **B5+C3** single construction path; delete `defineType` Reflect wrapper + `create`.
6. **B3** type-check idiom unification.
7. **E1+E3+E4+E6** shape hygiene (constructor-complete fields, flags-bitmask fold,
   Parséman fields to prototype/side-table, parseman `Span` as the single location
   object) — benchmark before/after.
8. **D1–D7** allocation passes, one hot path each, benchmark-gated.
9. **B1** Context split; **B8** rules.ts split (mechanical, after deletions).
10. **C1** extend-walk parity → delete legacy `extend.ts` (biggest single win, longest
    lead time — start the parity work early, land the deletion last).
11. **A3/A4** Node method surface + deprecated options, once consumers are pinned by A1.

Gates per pass (repo convention): focused tests first, `git diff --check`,
`pnpm run verify:aggressive-cutting-review`, benchmark protocol for D/E claims,
`pnpm --filter @jesscss/core build` before dependent-package tests.

## Open verification items (blocked by tooling outage during audit)

- Repo-wide import census from `@jesscss/core` (A1) — command in §A.
- Caller counts for: `Node.create`, `accept`/visitor protocols, `IS_PROXY`/`REMOVE`/
  `ABORT`, `use-webpack-resolver`, `debug-log`, root `conversions.ts`, `Combinator`
  construction sites, `selector-capture`/`selector-interpolated`/`rules-raw`/`range`/`log`
  node classes, deprecated context options.
- Confirm no remaining `Proxy` creation in core (perf-roadmap listed ~1.2% Proxy
  overhead; only the `IS_PROXY` symbol was seen in this read).
