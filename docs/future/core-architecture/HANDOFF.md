# Core Architecture Handoff

This is the live **cut aggressively** handoff for getting Jess back to a
credible alpha. Keep it short, current, and operational. Do not store detailed
completed-pass summaries here.

Use this file for the active reduction queue: deleting unnecessary node
creation, materialization, wrappers, helper arrays, iterator/generator state,
promise scaffolding, copied ownership, and hot-path function-call ladders.

Use `docs/future/core-architecture/PERFORMANCE-HANDOFF.md` for parked
benchmark/profile protocol, historical performance evidence, reactivation
thresholds, and performance-specific target lists.

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

Performance work is temporarily in **sanity-check mode**, not abandoned. Preserve
parked benchmark/profile protocol, measured targets, rejected experiments, and
reactivation thresholds in
`docs/future/core-architecture/PERFORMANCE-HANDOFF.md`. Bring full
performance rounds back when that file's threshold trips; until then, queue
passes may keep cutting obvious hot-path waste, but must not claim speed wins
without real benchmark evidence.

The controlling product goal is the fastest credible path from parsed Less to
CSS output. Every other goal is secondary unless it preserves real Less/Jess
semantics needed by real users. Do not protect internal API convenience,
owned-result aesthetics, copied-tree identity, or speculative mutability at the
expense of the hot path.

Branch-count and dispatch-depth reduction are architectural goals, not cosmetic
cleanup. The target is the fewest necessary branches, function hops, property
lookups, object lookups, temporary objects, and serialization passes from parsed
Less input to CSS bytes. Removing `.map(...)`, `pipe(...)`, or a copy helper is
only valuable when it shortens that A-to-Z execution path or deletes the reason
the hot path needed a generic classification ladder in the first place. Do not
optimize the current maze; remove the reasons a node has to walk through the
maze.

SCSS support still matters, and Node/runtime choices should not deliberately
paint it out. But this is primarily a Less project right now: optimize the hot
path for real Less workloads first. Preserve SCSS-enabling seams only when they
are concrete and cheap, or when isolating them behind cold extension boundaries
keeps the Less path clean.

## Runtime Direction

- Preserve one canonical source tree.
- Do not mutate or corrupt canonical nodes during eval, resolve, or render.
- Reuse canonical nodes by default. New nodes in hot eval/render need strong
  proof: a real semantic requirement, a measured speed win, or a cold API
  boundary. "It is convenient", "the old result looked owned", and "a test
  asserted parent identity" are not valid reasons.
- Default to **eval then serialize immediately**. If an evaluated value is only
  being rendered to CSS bytes, it must not receive replacement ownership:
  no `.inherit(...)`, no `frozen`, no parent/index rewrite, and no copied
  container. Render the canonical value with the active scope/placement state
  and move on.
- A value may be materialized only if it escapes immediate serialization:
  JS/plugin function arguments that can inspect or mutate nodes, explicit public
  `eval`/compat APIs that promise a node result, or a real transformed syntax
  node whose structure is different from the source and cannot be represented
  as live binding / placement / render state. Even then, materialization belongs
  behind a named cold boundary, not in the default render path.
- `.inherit(...)` is no longer a valid generic "replacement" primitive for hot
  eval/render. It conflates source metadata, parent placement, visibility flags,
  generated state, and index. Split remaining uses into explicit narrow actions:
  source diagnostics, selector flags, public materialization, or delete them.
- `frozen` is a symptom of copied ownership. Treat every remaining `frozen`
  write as temporary proof that a source node is being reused in an owned-result
  path. Replace that path with live binding / placement state or push it behind
  cold materialization.
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
- Hot internal eval/render/lookup/traversal APIs should be boring JavaScript:
  direct calls, explicit branches, indexed `for` loops, and simple mutable local
  state. Avoid generators, iterator protocols, Array helper methods
  (`map/filter/some/every/flatMap/reduce`), tuple arrays, spread copies,
  generic promise adapters, and promise-aware wrappers unless the path is a
  cold public convenience API or `F_MAY_ASYNC` proves the subtree can actually
  suspend. A generator is not free; it is just another hidden state machine.
- Do not use `Object.hasOwn(...)`, `Reflect.get(...)`, `Reflect.set(...)`, or
  `Reflect.has(...)` on shapes Jess owns and has already narrowed. This is not
  a hostile proxy boundary. Direct property reads/writes are the default. Keep
  reflective access only for genuinely unknown external objects, cold visitor /
  plugin compatibility probes, or documented third-party internals.
- Use existing node state as the hot-path dispatch contract; do not invent a
  second declaration graph, kind graph, or side-channel taxonomy unless a fact
  truly does not exist. The repo already carries many branch facts:
  `F_STATIC`, `F_MAY_ASYNC`, `registrationPrepared`, `evaluated`,
  `Reference.options.type`, node type bits, `AtRule.value.rules`,
  interpolated/static name shape, and context state such as
  `inReferenceImportScope`. A valid aggressive cut is deleting branches that
  rediscover those facts through repeated `instanceof`, `isNode`, optional-chain
  probing, or broad finalizer ladders. First audit and reuse existing state;
  only add state after proving the fact is absent and repeatedly re-derived on a
  hot path.
- Prefer dispatch once, then run straight-line code. If a hot render/eval path
  repeatedly asks broad questions like "is this callable, rules-like, fallback,
  declaration, materialized, owned, hoisted, import, reference-mode, async, or
  public API output?", the path is wrong. Split by existing state at the
  earliest honest boundary, then keep the selected path small and direct.
- Merge the `resolve(...)` and `eval(...)` concepts and reduce the method
  footprint. Use the classic name `eval` for semantic value computation. Base
  `Node.resolve(context)` is currently just `this.eval(context)`, so
  `resolve(...)` is guilty until proven necessary. Render paths should either
  render directly or call a narrow internal helper with an honest name; function
  and tooling paths should use narrow semantic evaluators. If an override is
  only "eval but named less scary", delete it, inline it, or rename the real
  operation to `eval`.
- Treat per-node lifecycle/helper explosion as architecture debt, not local
  style. Core nodes should not become mini-runtimes with separate custom methods
  for render eval, body eval, leaf eval, public resolve materialization,
  registration prep, ownership adaptation, hoist/import/layer bookkeeping, and
  cold compatibility output. `AtRule` is the current clearest example, but the
  same audit applies to `Rules`, `Call`, `Declaration`, and `Reference`. Collapse
  methods that only shuttle state between phases, move cold public
  materialization behind explicit boundaries, and keep hot node methods close to
  the minimum: evaluate the semantic value or render the value directly.
- Move policy to the owner that actually owns it. A node should not carry root
  output-order policy merely because it can be recognized locally. Plain CSS
  `@import` hoisting is a `Rules`/root output-order concern, not an `AtRule`
  eval/registration responsibility. Similar misplaced policies should be moved
  to container/output-order/lookup layers so hot node methods do not pay through
  unrelated compatibility branches.
- Generator APIs like `Node.children(...)` / `Node.nodes(...)` may survive only
  as cold compatibility/convenience surfaces. They are not the desired internal
  traversal model. Hot traversal should use callback/indexed-loop helpers or
  inline loops that do not allocate iterator state, yielded wrapper objects, or
  temporary arrays.
- Replacing a helper-array path with a generator path is not a real cut. The
  target is no materialization and no iterator state: plain loops over known
  arrays/fields, with explicit may-async fallback only where required.
- Tests that assert copied eval output identity, rewritten output-child
  `.parent`, or owned mutable result shape are suspect. Keep them only if they
  document a real public contract. Otherwise rewrite them around rendered CSS,
  lookup behavior, source diagnostics, source maps, or explicit cold
  materialization APIs.

## Render-First Reduction Queue

This queue supersedes speculative serializer/cache micro-rounds and copy-loop
polishing. Start from the minimum render contract:

1. After eval/render, the canonical tree must still be renderable.
2. Rendering an evaluated/lookup value should be lookup plus direct emission:
   normalized pre-trivia, node output, normalized post-trivia.
3. Render-only work must not require an owned result node, `.copy()`,
   `.clone()`, `.inherit()`, or `frozen`.
4. Live bindings sit on top of the original lookup/fallback model. They must
   make common lookups cheaper without losing legacy Less/Jess resolution
   semantics.

New rule: do not make `copyWithReusableLeaves` faster as a destination. Treat
it as transitional scaffolding to delete, bypass, or push behind cold
materialization. If a change leaves the same routine copy architecture in place,
it is not a core architecture win.

Active lanes, in order:

1. **Split `Reference.render` from `Reference.evalNode`.**
   `Reference` already records syntax kind in `options.type`, but the current
   runtime still funnels variable, function, mixin, mixin-ruleset, property,
   declaration, and index references through one broad resolver/finalizer stack:
   `resolveInitialReferenceTarget` -> `evaluateReferenceKey` ->
   `resolveReferenceTargetValue` -> `lookupResolvedReference` ->
   `finalizeReferenceLookupResult`. Make the render path dispatch by known
   reference kind first, starting with variable references. The first target is
   the common Less shape `margin: @space`: resolve the live/declaration binding
   and render that value directly. Do not copy, clone, inherit, freeze, or
   materialize a public owned result for this render-only case.
2. **Shrink the reference finalization ladder.**
   `finalizeReferenceLookupResult` re-classifies lookup output as fallback,
   runtime binding, declaration, or direct result after the lookup kind is
   already known. Keep that flexibility only where semantics require it. Split
   variable, callable, index, function-fallback, and rules-like preservation
   paths into small typed helpers so hot cases do not repeatedly branch through
   callable/materialization/fallback machinery.
3. **Remove ownership cruft from render/eval hot paths.**
   Audit `.copy()`, `.clone()`, `.inherit()`, and `frozen` call sites by purpose:
   API-boundary ownership, real mutation isolation, source-location/trivia
   preservation, or obsolete convenience. Anything in normal render/eval that is
   only there to manufacture an owned result should be deleted or moved behind a
   cold API boundary. Extend `scripts/verify-node-copy-frontier.mjs` or add a
   render-ownership frontier before removing public methods.
4. **Delete copy-based callable output placement.**
   Eval'd mixin/callable output children do not need `.parent === result`.
   Canonical/source nodes keep real parentage; output placement records carry
   source child, output rules, index, scope, trivia, and diagnostic context.
   Rewrite tests that require copied output children or distinct children across
   repeated calls unless a public materialization API explicitly promises that
   shape.
5. **Cut public/internal APIs that mainly preserve old owned-tree habits.**
   `.copy()`, `.clone()`, `.inherit()`, `frozen`, public owned eval results,
   and broad materialization helpers should survive only with named real-world
   callers. If an API exists mostly for tests, historical Less.js parity, or
   imagined mutation by downstream callers, remove it or move it behind an
   explicit cold `materializeOwnedTree`-style boundary.
6. **Stop throwaway string rendering.**
   Audit `OutputWriter.mark()`, `getSince()`, `capture()`, `preview()`,
   `restore()`, and ad-hoc `new OutputWriter()` call sites. Many `toString`
   implementations use mark/getSince simply to return text after writing to the
   same writer; that is acceptable at public `toString` boundaries but suspect
   inside eval/render loops. `preview(...)` is only acceptable when the previewed
   string is emitted, cached for reuse, or replaces a more expensive structural
   walk.
7. **Revisit lookup with live binding evidence.**
   Profile variable references separately from function, mixin, declaration,
   property, and index references. `findVarWithinScopeSurface` and
   `Rules.find(...)` should not be optimized generically until the reference
   kind split shows which lookup types still hit the heavy scope/registry path.
8. **Split sync/static and `F_MAY_ASYNC` paths.**
   `pipe(...)` is convenience glue, not a hot-path contract. Jess already has
   the two flags needed for static dispatch: `F_STATIC` means source/direct
   rendering can bypass eval work, and `F_MAY_ASYNC` means a node or child can
   genuinely return a promise. Use that matrix explicitly:
   static+sync nodes render source directly; dynamic sync nodes evaluate in a
   direct sync path with no promise adapters; only `F_MAY_ASYNC` nodes enter
   maybe-async `pipe(...)`/`isThenable(...)` fallback paths. Public
   compatibility adapters may stay generic, but internal render/eval hot paths
   should not pay generic continuation overhead when flags prove the subtree is
   sync. Start with small expression/value surfaces that still pipe mostly
   static or sync children: `List`, `Sequence`, `Expression`, `Paren`,
   `Negative`, selector containers, declaration values, and at-rule/ruleset
   header/body helpers.
9. **Replace hot generic traversal with boring loops.**
   `Node.children(...)` was improved by removing a temporary `Node[]`, but it
   is still a generator and therefore still not the target hot-path shape.
   Audit eval/render/registration/lookup walkers for generator use,
   Array-method traversal, tuple arrays, and spread copies. Keep generators only
   for cold public inspection APIs; internal walkers should be specialized
   indexed loops or callback helpers with no per-child allocation.

Other render/eval smells to keep visible:

- `copyWithReusableLeaves` uses `Reflect.construct`, recursive child copying,
  `.inherit(...)`, and `frozen = true`; this is not an acceptable routine render
  strategy. Do not defend it as architecture. It is a bridge to remove.
- `createRulesLikeReferenceSurface` constructs shallow owned rules-like nodes,
  calls `.inherit(...)`, and mutates parent/source metadata. Treat this as a
  callable/API boundary candidate, not as a model for normal value rendering.
- `createOwnedCallableRulesSurface` copies callable body children so result
  children can have output parent identity. That invariant is not valuable for
  hot eval/render. Replace it with placement state.
- `context.pushReference()` / `context.popReference()` cleanup is spread across
  many finalize branches in `reference.ts`. The split render path should have
  one obvious cleanup boundary per resolver.
- `evaluateReferenceValueNode` and declaration/runtime-binding finalization mix
  evaluation, ownership decisions, render-only reuse, rules-context switching,
  and frozen/copy behavior. Split those responsibilities before trying more
  local predicates.
- Error construction is now mostly exceptional in the current reference path,
  but candidate matching and fallback paths must stay under the no-hot-path
  `Error` allocation rule from `AGENTS.md`.

### CPU-Profile-Derived Smells

Use these as the current evidence-backed smell map. They come from the
`2026-06-03-v8` broad benchmark CPU profiles, especially
`.profiles/2026-06-03-v8/broad-benchmark-runner-after-light-error.cpuprofile`
after the hot `ExtendError` allocation was removed.

- **Copy recursion is the largest remaining self-time signal.** The
  after-light-error profile shows `copyChild` as the top self frame
  (`1,286` samples), with `constructCopy` (`68`), `copyWithReusableLeaves`
  (`42`), and `copyCallableRulesValue` (`69`) nearby. This points to ownership
  creation, not string formatting, as the first real reduction target.
- **`Node` construction is still high self-time.** The same profile shows
  `Node` construction at `345` self samples plus GC at `136`, and inclusive
  stacks put copy/eval/render under the same run. Treat new nodes as a budgeted
  architectural resource, not a convenience.
- **Callable guard/body surfaces are concrete copy hot paths.** Before the
  guard-eval deletion, `copyGuardForEval` delegated directly to
  `copyWithReusableLeaves`; callable body ownership still uses
  `copyCallableRulesValue` with recursive arrays, records, `Reflect.construct`,
  `.inherit(...)`, and comment/ampersand special cases. Do not locally polish
  those loops; first ask why the candidate needs a copied body at all, and
  whether output can run against placement context instead.
- **Variable lookup is hot, but not as generic `Rules.find` self-time.**
  The profile shows `findVarWithinScopeSurface` (`152` self samples) and
  `findWithinScopeSurface` (`80`) after the error fix, while the old
  instrumented counter showed `Rules.find` at only about `31-34ms`. That means
  the smell is the variable scope surface walk: repeated `Set<Rules>` visited
  allocation, recursive lexical/child/fallback walks, pending-declaration
  promotion, visibility checks, and boundary/import/mixin-output rules.
- **`evaluateReferenceNode` is an inclusive stack, not a single method fix.**
  The after-light-error profile has `evaluateReferenceNode` in inclusive stacks
  (`738` samples), while self-time sits in copy, lookup, render, and writer
  helpers. Do not optimize `Reference.evalNode` by adding another predicate to
  the broad pipeline; split the path so variable render never enters callable,
  rules-like, index, or owned-result finalization machinery.
- **Extend matching remains a measured separate lane.** `wouldMatchNode`,
  `processExtends`, `applyExtendsToSelector`, `isSameOrDescendantRoot`, and
  `getHeaderString` all appear in the top profile frames. Keep extend work
  separate from reference/copy reduction; it needs selector-shape caching or
  match-state reduction, not render-copy cleanup.
- **Writer `getSince` is a real but secondary signal.** `getSince` remains in
  the top self frames (`40` after the error fix), and `OutputWriter.getSince`
  uses `chunks.slice(mark).join('')`. Fix this only where CPU evidence shows
  repeated preview/capture/return-string work in eval/render loops; public
  `toString` boundaries can still return strings.
- **Render body/header emission is not free.** Inclusive stacks include
  `_emitRulesBody`, `emitNode`, `renderRulesBody`,
  `serializeRulesContainerInternal`, `getHeaderString`, and
  `withScratchEmittedTrivia`. This supports direct/static render segments, but
  previous declaration pre-render cache attempts regressed real benchmarks, so
  do not add broad string caches before deleting copy/eval detours.
- **`pipe(...)` and `isThenable(...)` show up because hot paths are promise-aware
  even when most values are sync.** The profile does not prove `pipe` is the
  first target, but new split paths should avoid adding more generic
  maybe-async ladders around synchronous variable render. Do not treat
  `pipe(...)` removal as cosmetic cleanup: use `F_STATIC` and `F_MAY_ASYNC` to
  choose source-direct, dynamic-sync, or maybe-async code before calling any
  generic awaitable helper.
- **Condition guards were still taking public eval detours.** The copied-guard
  path is gone, but callable/ruleset/control guards were still capable of
  routing simple `Condition` nodes through public `eval()` wrappers that
  allocate `Bool` output nodes before immediately unboxing them. That is exactly
  the kind of function-call ladder and short-lived node creation the CPU
  profile says to stop adding. Hot guard consumers should ask conditions for a
  boolean, not ask them to materialize a public node and then inspect it.

### Multi-Agent Smell Survey

A read-only multi-agent survey of the current core changes and neighboring
eval/render code found the same priority stack from four angles: V8/allocation,
call-ladder complexity, lookup, and owned-tree/API design. Treat this as the
current cut list until fresher profile evidence contradicts it.

1. **Reference render must split before the generic evaluator.**
   `Reference.render(...)` still calls `evaluateReferenceNode(...)`, which
   pushes reference state and walks target resolution, key evaluation, target
   materialization, typed lookup, and finalization before the static direct
   render shortcut can escape. The next cut is a first-class variable-render
   path for the common Less shape: no explicit target, static string key, no
   filter, no rules-like preservation. It should look up a live/declaration
   binding and render its value directly, with one cleanup boundary and no
   callable/index/rules-like/fallback finalization ladder.
2. **Callable output copied children are the highest-value copy deletion.**
   `copyCallableRulesValue(...)`, `copyCallableRulesNode(...)`, and
   `createOwnedCallableRulesSurface(...)` still recursively copy arrays,
   records, and nodes through `Reflect.construct(...)` so emitted children can
   have output-local parent identity. That is not a hot-path invariant. Replace
   copied output children with canonical source child plus placement records
   carrying output rules, index, scope/trivia, and diagnostic facts.
3. **`copyWithReusableLeaves(...)` is not an optimization target.**
   It recursively maps arrays, allocates record objects, spreads options,
   constructs nodes, inherits metadata, and freezes. Keep it only as cold
   materialization scaffolding while deleting render/eval call sites. Tests
   should prove no routine copy on render paths, not celebrate leaf reuse inside
   a copied tree.
4. **Arrays, tuple arrays, Sets, and tiny result records count.**
   The old `List`/`Sequence` render shape resolved children into temporary node
   arrays before stringifying. That specific dynamic sync render path is now cut,
   but similar patterns remain: async list/sequence fallbacks build
   `[node,index]` tuple arrays, variable lookup creates fresh `Set<Rules>` and
   result records, `Paren` emits `{ node, wrap }` records, and declaration
   render builds state/merge arrays. These are objects on hot paths.
5. **Sync/static paths are still paying maybe-async convenience tax.**
   `Expression`, `Paren`, `Negative`, `Reference`, and callable candidate
   helpers still use `pipe(...)`, `isThenable(...)`, or unconditional `async`
   machinery where `F_STATIC`/`F_MAY_ASYNC` can split source-direct,
   dynamic-sync, and maybe-async execution. Do not route sync render through
   promise-aware adapters unless a child actually has `F_MAY_ASYNC`.
6. **Writer capture/string helpers are secondary but real.**
   `OutputWriter.getSince()` slices chunks and joins strings; `preview`,
   `replaceSince`, and `capture` build on that. Use them at public `toString`
   and transforming capture boundaries, but remove them from render-buffer and
   body/header loops when a streaming emitter or structural predicate can avoid
   the throwaway string.
7. **Ruleset/AtRule/Declaration body render still carries owned-state habits.**
   Dynamic ruleset/at-rule render can still evaluate or own body rules for
   render, and declaration render builds transient state before stringifying.
   Split plain static/direct render, dynamic sync value render, merge/custom
   declaration behavior, and public resolve/materialization paths. Render state
   belongs in placement/context records, not owned result nodes, unless mutation
   isolation is proven.
8. **`frozen`, `.inherit(...)`, `.copy()`, and `.clone()` are one API smell.**
   `frozen` exists because copied/owned result APIs rely on parent identity to
   carry lookup state while also reusing canonical nodes. The target model is
   explicit lookup/placement state over one canonical source tree. Public
   materialization can survive only behind cold, named APIs with real callers.

Immediate ordered cuts from the survey:

1. Split direct variable reference render before `evaluateReferenceNode(...)`.
2. Replace copied callable output children with source child plus placement
   records; rewrite parent-identity tests around render/output/source facts.
3. Split `Expression`, `Paren`, `Negative`, and condition render/eval into
   sync and `F_MAY_ASYNC` paths.
4. Remove tuple-array async fallbacks in `List`/`Sequence`; use indexed async
   loops when materialization is unavoidable.
5. Convert render-buffer/body/header paths away from `getSince()`/`preview()`
   where the emitted text can stream directly.

### Current Open Cut / Audit Backlog

Use this as the next restocking surface before mining completed history. Every
item should either become a focused cut queue with tests, or be crossed off with
repo evidence showing the path is cold/public/semantic.

1. [ ] Audit `createOwnedCallableRulesSurface(...)`,
   `copyCallableRulesValue(...)`, `copyCallableRulesNode(...)`, and
   `getMixinOutputChildSegments(...)` together. Goal: delete copied callable
   output children from normal eval/render and keep only source child +
   placement records.
   Progress: simple static callable bodies now reuse canonical source children
   through placement state instead of recursively copying. The first attempted
   full source-backed body reuse broke dynamic mixins, detached/local-var
   output, nested selector collapse, and declaration merge chains; the current
   cut therefore keeps the copy fallback only for non-static bodies, nested
   rulesets/at-rules, and assignment/merge declaration bodies. Keep shrinking
   that semantic boundary; do not polish recursive copy as the destination.
2. [ ] Rewrite mixin/callable tests that currently require output children to
   be distinct owned nodes or require `child.parent === result`. Keep tests for
   rendered CSS, source-child mapping, source index, diagnostics, and any cold
   materialization API that remains.
3. [ ] Audit every remaining `copyWithReusableLeaves(...)` call by purpose:
   public materialization, mutation isolation, trivia/source preservation, or
   obsolete ownership habit. Add a focused frontier that fails if render/eval
   reintroduces routine leaf-copy scaffolding.
4. [ ] Audit `.inherit(...)` plus `frozen` in `reference.ts`,
   `callable-binding.ts`, `callable-surface.ts`, `cloning.ts`, and
   `node-base.ts`. Goal: move copied-result metadata behind explicit placement
   state or a cold materialization boundary.
5. [ ] Split the common variable-reference render path so static direct
   `@name` rendering does not enter `evaluateReferenceNode(...)`,
   callable/index/rules-like finalization, or owned-result metadata helpers.
6. [ ] Split `finalizeReferenceLookupResult(...)` by reference kind. Variable,
   function fallback, callable, declaration/property, index, and rules-like
   preservation should not all branch through one ladder on hot render.
7. [ ] Audit `Rules.find(...)` variable lookup for fresh `Set<Rules>` visited
   allocation and recursive scope walks. Do not repeat the rejected micro-change;
   first classify which reference kinds still hit `findVarWithinScopeSurface`
   and which can use direct live/declaration slots.
8. [ ] Replace `Node.forEachNode(...)` may-async tuple-array traversal with an
   indexed ordered loop that mutates child slots without `[node, key,
   collection]` wrapper allocation.
   Progress: the `F_MAY_ASYNC` branch no longer prebuilds a tuple array or calls
   `serialForEach(...)`. It now walks entries directly, mutates sync results in
   place, and only stores parallel continuation slots after the first real
   suspension. Keep cutting the remaining generator/public traversal callers in
   item 9; this pass deliberately left `children(...)` / `nodes(...)` as public
   convenience APIs.
9. [ ] Keep `Node.children(...)` / `Node.nodes(...)` as cold public convenience
   only. Audit internal eval/render/registration/lookup callers and replace hot
   generator traversal with field-specific loops or no-allocation callbacks.
   Progress: removed internal generator traversal from callable recursion
   candidate checks (`rules.children(true)`), custom declaration value
   classification (`node.children(true)`), and import final-rules descendant
   ruleset registration (`finalRules.nodes()`). Remaining live production
   `nodes()` callers are in `extend.ts` and should stay in the extend-specific
   lane unless fresh profile evidence says to mix that work into render/copy
   reduction. Sanity measurement after the traversal pass, not a speed claim:
   functions `17.30ms`, import-reference `27.13ms`, mixins-guards `23.30ms`,
   extend-chaining `8.20ms`, media `7.54ms` medians over 15 iterations /
   5 warmup.
10. [x] Audit `List` and `Sequence` may-async fallback materialization. The sync
    render path no longer resolves children into arrays; the async fallback
    should not build tuple arrays or resolved node arrays unless a public
    materialization boundary requires them.
    Progress: may-async `List.render(...)` and `Sequence.render(...)` no longer
    call `resolveItems(...)` / `evaluateValues(..., 'resolve')` and no longer
    materialize resolved node arrays before stringification. They now stream the
    items one at a time: non-async children render directly, while
    `F_MAY_ASYNC` children resolve one child and render that result before
    moving to the next item. This preserves async value semantics without
    restoring whole-container resolved arrays. Explicit `eval(...)` still
    materializes node arrays because that is the current value/result boundary;
    `resolve(...)` is now a merge target, not a defended second API. Sanity
    measurement after the render-array cut, not a speed claim: functions `17.05ms`, import-reference `30.16ms`
    median with noisy `82.7%` RSD/outliers, mixins-guards `23.02ms`,
    extend-chaining `8.39ms`, media `8.05ms` medians over 15 iterations /
    5 warmup.
    Completed follow-up: `eval(...)` materialization still allocates one result
    array because that is the current value boundary, but the convenience
    iterator scaffolding is gone. `List.resolveItems(...)` remains only as
    transitional naming and should be folded into classic eval/value helpers;
    `Sequence.evaluateValues(...)` now uses direct indexed loops, switches to an
    async rest loop only after the first real suspension, and no longer imports
    or calls `serialForEach(...)`.
    DRY follow-up: the shared materialization pattern now lives in
    `util/evaluate-node-array.ts` as `evaluateNodeArraySync(...)` and
    `evaluateNodeArrayMaybe(...)`; `List` and `Sequence` no longer carry
    duplicate `resolveItemsRest(...)` / `evaluateValuesRest(...)` methods.
11. [ ] Audit `Paren`, `Expression`, `Negative`, selector containers, and
    declaration/at-rule/ruleset value helpers for `pipe(...)` /
    `isThenable(...)` in subtrees where `F_MAY_ASYNC` proves sync rendering.
    Progress: `Paren.render(...)`, `Expression.render(...)`, and
    `Negative.render(...)` now keep sync child values on direct sync branches
    when `F_MAY_ASYNC` proves the child cannot suspend. The may-async fallback
    remains for flagged children, default guard semantics, paren frame cleanup,
    compound negative dimensions, and buffer/string alignment. Next item-11
    targets are selector containers plus declaration/at-rule/ruleset value
    helpers that still wrap sync child work in generic `pipe(...)` or
    `isThenable(...)` ladders. Sanity measurement after this value-wrapper
    split, not a speed claim: functions `18.14ms`, import-reference `34.14ms`
    median with noisy `84.1%` RSD/outliers, mixins-guards `25.00ms` median with
    noisy `97.5%` RSD/outliers, extend-chaining `8.02ms`, media `8.30ms`
    medians over 15 iterations / 5 warmup.
    Follow-up cut: `QueryCondition.renderQueryConditionSyntax(...)` now streams
    directly over condition parts and only resumes with an async loop after a
    real async child render. It no longer uses `serialForEach(...)` or a
    resolved-node array during render. Selector containers remain intentionally
    open because `SelectorList`, `CompoundSelector`, and `ComplexSelector` still
    combine `pipe(...)`, `serialForEach(...)`, flatten/collapse logic, selector
    sorting, and warning emission; split those with focused selector tests
    rather than a blind mechanical patch.
    Selector follow-up: `SelectorList` is now split with indexed eval/resolve
    loops, shared flatten/finalization, and no `pipe(...)`, `serialForEach(...)`,
    `.map(...)`, `.filter(...)`, `.some(...)`, `.entries(...)`, or
    `.includes(...)`. `CompoundSelector` now has the same indexed eval/resolve
    shape and no `pipe(...)`, `serialForEach(...)`, `.map(...)`, `.filter(...)`,
    `.some(...)`, `.entries(...)`, `.includes(...)`, `.flatMap(...)`,
    `.reduce(...)`, or `.join(...)`. `ComplexSelector` now has the same
    no-`pipe(...)` / no-`serialForEach(...)` indexed shape, with shared
    evaluation/finalization and explicit warning, nil, combinator, collapse,
    and ownership steps. Selector container cutting is complete enough to move
    the next queue to remaining render wrappers in `Selector`, `Declaration`,
    `AtRule`, and `Ruleset`.
12. [x] Audit `OutputWriter.getSince(...)`, `preview(...)`, `capture(...)`,
    `replaceSince(...)`, and detached `new OutputWriter()` callers. Classify
    each as public `toString`, sourcemap transform, final emitted value, or
    throwaway render/header/body fragment.
    Completed by the writer object-reduction subplan below. Remaining
    `getSince(...)` callers are not all good, but the current hot detached
    writer/header/body capture pass is complete and further work should be
    restocked from fresh caller classification.
13. [x] Delete remaining hot render/header/body `getSince()` callers where a
    streaming active-writer path or structural spacing predicate can avoid
    slice/join string creation.
    Completed for at-rule/ruleset header/body surfaces covered by the writer
    subplan. Do not broaden this checkbox into a claim that every public
    `toString()` boundary or selector/color string helper is optimized.
14. [x] Audit `serializeRulesContainerInternal(...)`, `renderRulesBody(...)`,
    `_emitRulesBody(...)`, and `emitNode(...)` for preview-then-rerender,
    duplicate stringification, helper arrays, and repeated static body
    serialization.
    Completed for the active writer/header/body pass. No broad static-template
    cache was added; previous cache attempts regressed real benchmarks.
15. [ ] Audit `extend.ts`, `extend-walk.ts`, and `extend-roots.ts` separately
    from render-copy work. Extend still has real `Set`, array, sort, selector
    copy, and full-tree match costs, but changes there need extend-specific
    profile evidence.
16. [ ] Audit hot tests for parent/frozen/owned-result assertions. Keep source
    tree parent invariants; delete or rewrite tests that only defend eval'd
    output parent identity.
17. [ ] Collapse the `resolve(...)` / `eval(...)` split. Base `resolve`
    currently aliases `eval`, and the repo has dozens of overrides. The target
    is classic `eval` naming for semantic value computation, plus narrow
    internal helpers for direct render/function/tooling needs. Classify each
    `resolve` override and caller as direct render helper, semantic eval,
    tooling/function helper, or bogus renamed eval. Collapse bogus wrappers,
    delete public `resolve` tests that only defend method existence, and stop
    adding helper APIs that preserve the old evaluated-tree model.
    Progress: `List`, `Sequence`, `Expression`, `Operation`, `Condition`,
    `Paren`, `Quoted`, `Block`, and `Url` now use eval/direct-render semantics
    internally instead of carrying a `mode: 'eval' | 'resolve'` branch or
    render-only `resolveValue` wrapper. `resolve(context)` remains a temporary
    compatibility alias on these nodes where tests still call it and require
    non-stamping source behavior. Evidence-backed caveat: forcing
    `SelectorCapture` and `InterpolatedSelector` render/resolve through
    `evalNode(...)` currently mutates canonical selector children; focused
    selector tests caught `a[data=$capture-attr]` becoming `a[data=foo]`.
    Collapse those selector paths only after selector eval is canonical-safe.
18. [ ] Add small proof tests as cuts land: render path does not call
    `copyWithReusableLeaves`, `copyCallableRulesValue`, public `Condition.eval`,
    child `resolve(...)`, `OutputWriter.preview`, or generator traversal where
    that absence is the point of the cut.
19. [x] Run a performance sanity check after any batch touching reference,
    callable output, rules/ruleset body render, at-rule render, extend,
    `OutputWriter`, base `Node` traversal, or clone/copy/inherit/frozen.
    Latest sanity check used the stable hot-path harness on the two formerly
    noisy fixtures: `pnpm run measure:less:hotpath -- --stable --fixture
    tests-unit/import/import-reference.less --fixture
    tests-unit/mixins-guards/mixins-guards.less`. Results were usable signals,
    not a speed claim: import-reference median `25.02ms`, trimmedRSD `10.5%`,
    roundRSD `4.2%`; mixins-guards median `22.76ms`, trimmedRSD `9.6%`,
    roundRSD `3.2%`.

Consensus acceptance rules:

- A cut is valid only if it removes real work from render/eval: node creation,
  copied ownership, arrays/tuples/Sets/result records, promise adapters, writer
  slice/join strings, or repeated recursive walks. Renaming or hiding the same
  allocation behind a helper is not progress.
- Arrays are objects. Do not dismiss `new Array(...)`, `.map(...)`,
  `.filter(...)`, tuple arrays, spread copies, or `Set` creation as harmless in
  hot paths. If a render path creates an array only to immediately stringify or
  iterate it once, the default answer is deletion.
- Optimize writer internals only after classifying the caller. Public
  `toString()` boundaries may return strings; render-buffer/body/header paths
  should stream when possible. Mechanical writer improvements are welcome, but
  they do not replace deleting hot `capture`/`preview`/`getSince` callers.

Writer object-reduction subplan:

1. **Mechanical no-regression cuts.** `OutputWriter.getSince(mark)` must not use
   `chunks.slice(mark).join('')`; keep empty and single-chunk fast paths and
   concatenate manually for multi-chunk output. Next mechanical candidates are
   replacing `_queuedSpacer = { text, shouldAdd }` with two fields and replacing
   `_positions` object records with parallel numeric arrays.
2. **Call-site deletion.** Replace render-buffer, declaration, at-rule header,
   ruleset header, and list/sequence render call sites that write into a writer,
   call `getSince()`/`preview()`, then write that string elsewhere. Prefer direct
   emission into the active writer/buffer and structural predicates such as
   `lastChar()`/spacing flags.
3. **Cold capture boundary.** Keep `capture`, `preview`, `replaceSince`, and
   detached `OutputWriter` creation only for public `toString()` surfaces,
   sourcemap-preserving transforms, or cases where the captured string is the
   actual final value. Every remaining hot call site needs a comment or test
   proving why direct streaming cannot preserve behavior yet.

Next 15 writer object-reduction queue items, performance still shelved:

1. [x] Replace `_positions` object records with parallel numeric arrays for
   line, column, segment count, and output length.
2. [x] Add one internal position-recording helper so `add()` does not allocate
   per-chunk metadata objects.
3. [x] Route the no-newline `add()` path through the parallel position arrays.
4. [x] Route the newline `add()` path through the parallel position arrays.
5. [x] Update `replaceSince()` to read the mark's segment count directly from
   the segment-count array.
6. [x] Update `restore()` to restore line, column, segment count, and length
   from parallel arrays.
7. [x] Update `restore()` to truncate every position array together.
8. [x] Update `refreshPositions()` to preserve existing segment counts without
   allocating `{ line, column, segments, length }` records.
9. [x] Update `refreshPositions()` to rebuild parallel arrays in place.
10. [x] Update `refreshPositions()` final segment truncation to read the last
    segment count from the numeric array.
11. [x] Replace `_queuedSpacer = { text, shouldAdd }` with scalar queued-spacer
    fields.
12. [x] Update `add()` queued-spacer consumption to read scalar fields and clear
    them before inserting spacer text.
13. [x] Move the default queued-spacer predicate out of the method parameter so
    calling `queueSpacer(text)` does not allocate a fresh closure.
14. [x] Update `restore()` to clear scalar queued-spacer fields.
15. [x] Update writer tests so the old `_positions` and `_queuedSpacer` object
    shapes cannot silently come back.

Next 15 header-fragment caller-deletion queue items, performance still shelved:

1. [x] Treat at-rule/ruleset header fragment stringification as a caller
   deletion lane, not as more writer-internal polishing.
2. [x] Keep public `toString()` boundaries cold; this batch targets render/header
   callers that allocate detached writers or `preview(...)` closures.
3. [x] Replace at-rule leaf name `writer.preview(...)` with direct active-writer
   mark/getSince/restore fragment capture.
4. [x] Replace at-rule leaf prelude `writer.preview(...)` with the same direct
   fragment capture.
5. [x] Ensure at-rule leaf fragment capture restores the active writer before
   spacing decisions append the final rendered leaf text.
6. [x] Replace at-rule header name `new OutputWriter()` detached capture with the
   active final writer.
7. [x] Replace at-rule header prelude `new OutputWriter()` detached capture with
   the active final writer.
8. [x] Replace at-rule header post-prelude trivia detached capture with the
   active final writer.
9. [x] Preserve at-rule `withoutComments` trivia swapping while deleting detached
   writer allocation.
10. [x] Replace ruleset header selector `new OutputWriter()` detached capture with
    the active final writer.
11. [x] Preserve ruleset header reference-filter and visible-selector forcing
    state while deleting detached writer allocation.
12. [x] Preserve ruleset header comment stripping and leading block-trivia
    normalization.
13. [x] Add/strengthen at-rule tests proving header/leaf paths do not call
    `preview(...)` or `capture(...)` on the active writer.
14. [x] Add/strengthen ruleset tests proving header selector serialization uses
    the active writer and not a detached writer.
15. [x] Record verification in the handoff with an explicit no-benchmark/no-speed
    claim caveat.

### Latest 15-Item Queue Completion Pass

1. [x] Added a focused dynamic CSS-name render test that counts dynamic-name
   evaluation for a non-extended, non-silent call name.
2. [x] Corrected the first attempted proof after it counted the source
   variable reference instead of the render-local evaluated name.
3. [x] Verified the red failure on the corrected proof was the intended final
   fallback signal: `nameEvaluations` was `4`, expected `1`.
4. [x] Widened the non-extended render-local branch so ordinary dynamic CSS
   call names use the already-created state.
5. [x] Reused the single evaluated dynamic name for non-silent CSS call-name
   rendering.
6. [x] Preserved optional CSS fallback behavior from the previous pass on the
   same branch.
7. [x] Preserved callable/mixin/rules-like exclusions before direct CSS
   rendering.
8. [x] Kept dynamic `calc` on the older path for now because calc-frame
   semantics need a separate proof before deletion.
9. [x] Rendered direct CSS-name output as text through
   `renderFinalizedCallSyntax(...)` instead of materializing a replacement
   `Call`.
10. [x] Wrote direct CSS-name text into render buffers without creating a node.
11. [x] Preserved render-only behavior: the source call remains unevaluated and
    unprepared after render.
12. [x] Left mixin/rules-like dynamic names, stylesheet-defined `Func` names,
    dynamic `calc`, and final `evalState(...)` fallback on the older path until
    separate proof covers those branches.
13. [x] Re-ran the red test and saw it pass with one dynamic-name evaluation.
14. [x] Ran the full `call.test.ts` file (`68` passed).
15. [x] No benchmark/profile was run, so make no speed claim from this queue
    completion. This was another Call render probe-reduction pass.

### Next 15-Item Queue

1. [ ] Continue `Call.renderDynamicFunctionOutput(...)`: mixin/rules-like
   dynamic names, stylesheet-defined `Func` dynamic names, dynamic `calc`, and
   final `evalState(...)` fallback still fall through older helper probes. Add
   focused proof before collapsing each branch.
2. [ ] Audit remaining `Call.markCallOutput(...)` call sites around CSS/mixin
   eval branches and classify each as immediate render, public materialization,
   or escaping plugin value; no generic ownership by default.
3. [ ] Split `Reference` render-only variable lookup from public
   materialization so common `@var` render never calls
   `applyReferenceResultMetadata(...)`, `.inherit(...)`, or `frozen`.
4. [ ] Replace `Reference.createRulesLikeReferenceSurface(...)` inherited
   shallow owned surface with explicit public materialization state or a live
   rules-like binding.
5. [ ] Replace `Reference` fallback/direct-value `frozen` and `.inherit(...)`
   metadata paths with a render-only value path and a separate public-value
   materializer.
6. [ ] Revisit the newly direct `Reference` MaybePromise chains and compress
   repeated branch code only if it can be done without reintroducing a generic
   pipeline/helper ladder.
7. [ ] Continue `define-function.ts` boring-JS cleanup only where scans show
   remaining convenience calls in hot argument conversion; keep cold signature
   setup/diagnostic helpers out of the hot queue unless they appear in profile
   evidence.
8. [ ] Replace `Rules` `resolvedNode.inherit(node)` pending-registration
   ownership with source/diagnostic state when the resolved node is only queued
   for registration; do not add a new privileged location-copy helper.
9. [ ] Replace `Rules` merge `copyWithReusableLeaves(value)` in merge adapter
   output with source-backed merge placement or direct render state.
10. [ ] Replace `Rules` `copyMergedValue(...)` array/object recursion with a
    narrower merge-value copier or render-state path so merge normalization
    does not clone whole value subtrees.
11. [ ] Replace `StyleImport` first-use import placement child copies with
    canonical children plus placement/render state; imports should not fake
    transferred ownership.
12. [ ] Audit remaining `StyleImport.deriveRulesSurface(...)` wrapper creation
    for source/visibility/placement fields that can be direct state instead of
    derived `Rules` surfaces.
13. [ ] Add a focused registration-prep test before deleting
    `resolvedNode.inherit(node)`, proving source diagnostics/registration order
    survive without replacement ownership.
14. [ ] Add a focused `Call.renderDynamicFunctionOutput(...)` test that counts
    dynamic name/function evaluation so the render-local state-machine cut does
    not accidentally double-probe.
15. [ ] Add or update proof tests around call output marking so render-only
    dynamic output does not acquire owned parent identity unless it escapes
    through a public/materialized value boundary.

## Active Correctness Queue

No active correctness blockers. The alpha snapshot command currently records
all queued benchmark files in one run.

If any other `.less` fixture or benchmark fails to parse or evaluate, add it to
this queue as a focused core repro before changing expected output. If `.less`
renders but CSS differs, review expected behavior manually before changing
tests or semantics.

## Performance Round Protocol

See `docs/future/core-architecture/PERFORMANCE-HANDOFF.md` for the parked
performance protocol and reactivation threshold. Keep this section only as the
short active reminder; do not expand it with completed experiment history.

After the correctness queue is clear enough for benchmarks to run, every handoff
run should do at least one full performance round. For the current phase, choose
rounds from the render-first reduction queue above before trying another local
serializer/cache micro-optimization. Do not make speculative cleanup changes
without before/after evidence.

1. Capture a baseline profile and benchmark snapshot.
2. Identify the top concrete cost from the profile: object allocation surface,
   lookup path, recursive walk, helper array, state graph, side-map lookup, or
   function-call ladder.
3. Ask why the cost exists at all. Prefer deleting the semantic reason for the
   hot object/string/control-flow work over making the helper cheaper.
4. State the hypothesis in one sentence in this handoff before editing.
5. Make the smallest behavior-preserving change that removes the cost-bearing
   architecture. "Replace one copy helper with a slightly cheaper copy helper"
   is not enough unless it is a temporary checkpoint toward deleting that path.
6. If the change touches expected misses or candidate classification, add or
   update tests proving the hot path does not allocate or return real `Error`
   objects for control-flow results.
7. Run focused tests and the same profile/benchmark again.
8. Keep the change only if it improves real runtime cost, removes measurable
   memory/object pressure without slowing runtime, or fixes correctness.
9. Revert or reshape the change if it only moves cost elsewhere, preserves the
   bad owned-tree invariant, or adds broad state machinery to avoid deleting a
   copy path.
10. Update the active snapshot below with a one-paragraph result and the next
   profile target.

## Multi-Agent Optimization Loop

When sub-agents are available, run performance work as a coordinator loop:

- Keep `dev`, this handoff, final benchmark truth, commits, and pushes under
  the coordinator.
- Dispatch workers only to independent lanes with disjoint write scopes.
- Good lanes: reference render/eval split by reference kind, copied callable
  output deletion, copied guard-eval deletion, `.copy()`/`.clone()`/`.inherit()`
  API removal or cold-boundary isolation, writer preview/capture removal,
  lookup/live-binding profiling by reference kind, parser or Less alpha facade
  overhead, and extend/selector classification.
- Workers must not edit this handoff, commit, push, or report
  `profile-less-benchmark.mjs` `elapsedMs`.
- Workers should make one bounded hypothesis, run focused tests, and report
  changed files plus evidence.
- The coordinator accepts a worker patch only after local review, focused tests,
  package build, and same real benchmark comparison.
- Reject and revert patches that are neutral, noisy, or slower, even when they
  reduce a local object allocation.
- After each round, restock workers from the latest rejected/accepted evidence,
  not from old completed history.

### Required User Performance Report

At the end of every handoff run, report performance to the user in plain terms:

- **Real benchmark** numbers for the files touched or measured. These are the
  only numbers that count as "Jess got faster/slower" and the only numbers to
  compare against Less 4.x;
- historical Less 4.x real benchmark comparison and rough slowdown ratio where
  available;
- **Instrumented profiler** results only as diagnostic support. Label them
  explicitly as profiler/counter runs. Report call counts and per-method totals
  only; do not report `profile-less-benchmark.mjs` `elapsedMs` in user-facing
  summaries unless the task is specifically profiler-overhead debugging;
- **CPU profile** evidence only as sampled hotspot/call-stack evidence. Label
  CPU sample counts separately from benchmark timings;
- whether the run improved, regressed, or only clarified the next target;
- which optimization was kept, rejected, or deferred and why;
- the next profile target.

Do not hide behind proxy metrics. If a code change was rejected because the real
benchmark slowed down, say that.

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

Record Jess alpha hot-path snapshots, not only historical Less comparisons:

```sh
pnpm run measure:less:hotpath -- --stable
```

Use the printed `signal=` field as the trust gate. `usable` can support a
keep/revert decision, `unstable` needs another run or corroborating profile
evidence, and `noisy` is not a decision-quality benchmark result.

For quick smoke checks while cutting, the cheaper bounded run is still useful
as a regression tripwire:

```sh
pnpm run measure:less:hotpath -- --iterations 15 --warmup 5
```

Use the saved hot-path fixture set for package-local comparisons:

```sh
pnpm run measure:less:hotpath:record -- --stable --note "<short hypothesis/result>"
```

The legacy broad Less benchmark fixture can still be inspected through the
profiler/counter script when `/Users/matthew/git/oss/less.js` is available:

```sh
node scripts/profile-less-benchmark.mjs --file=benchmark.less
```

Use static audits only to support profile decisions:

```sh
pnpm run audit:node-creation
```

## Active Performance Snapshot

Current known evidence from the latest handoff run:

- Latest handoff continuation folded the multi-agent consensus into the
  render-first plan and landed the first mechanical writer object cut:
  `OutputWriter.getSince(mark)` no longer uses `chunks.slice(mark).join('')`.
  It now has empty and single-chunk fast paths and manually concatenates
  multi-chunk output, avoiding the intermediate sliced array while preserving
  the required string result. A focused `outputwriter.test.ts` regression poisons
  the writer chunk array's `slice` method and proves `getSince(...)` does not
  call it. This is a small allocation cut, not the main writer architecture win;
  the next writer target remains deleting hot render-buffer/body/header
  `getSince`/`preview`/`capture` call sites rather than polishing capture as an
  architecture.
- Latest writer-object batch completed the 15-item mechanical queue while
  keeping performance shelved: `_positions` object records became parallel
  numeric arrays, `_queuedSpacer = { text, shouldAdd }` became scalar fields,
  the default spacer predicate moved out of the method parameter, restore and
  refresh paths now rebuild/truncate numeric arrays directly, and writer tests
  assert that the old object-record fields are gone. This is verified by
  `pnpm --filter @jesscss/core test -- src/tree/util/__tests__/outputwriter.test.ts`,
  `pnpm --filter @jesscss/core test`, `pnpm --filter @jesscss/core build`, and
  `git diff --check`. No benchmark was run and no speed claim is made for this
  batch.
- Latest header-fragment caller-deletion batch completed the next 15 queue items
  while keeping performance shelved: `AtRule.renderLeafValue(...)` no longer
  calls `writer.preview(...)` for name/prelude fragments, `AtRule.getHeaderString(...)`
  no longer allocates detached `OutputWriter` instances for name, prelude, or
  post-prelude trivia, and `Ruleset.getHeaderString(...)` no longer allocates a
  detached selector writer. These paths now capture required header fragments
  against the active final writer with mark/getSince/restore and immediately
  restore before composing the final output string. Focused tests assert no
  active-writer `capture(...)`/`preview(...)` calls and prove at-rule/ruleset
  header serialization receives the active writer rather than a detached writer.
  This is verified by
  `pnpm --filter @jesscss/core test -- src/tree/__tests__/at-rule.test.ts src/tree/__tests__/ruleset.test.ts`,
  `pnpm --filter @jesscss/core test`, `pnpm --filter @jesscss/core build`, and
  `git diff --check`. No benchmark was run and no speed claim is made for this
  batch; the remaining architecture target is still direct streaming where
  header spacing/trivia decisions no longer require temporary strings at all.
- Latest big-cut continuation removed generic continuation and tuple-array
  scaffolding from small value/query wrappers while keeping performance shelved:
  `Negative.render(...)`/`evalNode(...)`, `Paren.render(...)`, and
  `Expression.render(...)` no longer use `pipe(...)`; `Paren.render(...)` also
  no longer allocates the temporary `{ node, wrap }` render classification
  record. The async `List`/`Sequence` fallback loops no longer build
  `this.value.map((item, index) => [item, index])` tuple arrays before
  `serialForEach`; `QueryCondition.resolveItems(...)` got the same direct
  iteration cut. `List.render(...)`, `Sequence.render(...)`,
  `Sequence.evalNode(...)`, and `Sequence.resolveValue(...)` now use direct
  `isThenable(...)` continuations instead of `pipe(...)`. Focused regressions
  poison source child arrays' `.map(...)` in forced `F_MAY_ASYNC` render paths,
  proving async list/sequence/query-condition render no longer allocates those
  tuple arrays. This is verified by
  `pnpm --filter @jesscss/core test -- src/tree/__tests__/negative.test.ts src/tree/__tests__/paren.test.ts src/tree/__tests__/expression.test.ts src/tree/__tests__/list.test.ts src/tree/__tests__/sequence.test.ts`.
  The follow-up `QueryCondition` cut is verified by
  `pnpm --filter @jesscss/core test -- src/tree/__tests__/query-condition.test.ts`.
  The full core suite and build also pass:
  `pnpm --filter @jesscss/core test`, `pnpm --filter @jesscss/core build`, and
  `git diff --check`. No benchmark has been run and no speed claim is made for
  this batch. Additional cut opportunities found while reading:
  `Sequence.renderResolvedValue(...)` still routes single-node buffer writes
  through `writeRenderTextResult(...)`, escaped paren semicolon-list
  normalization still allocates a replacement `List` and calls `.inherit(...)`,
  list/sequence addition still maps and copies children, `QueryCondition` still
  resolves into a temporary `Node[]` for may-async render, and
  declaration/reference/selector surfaces still contain larger `pipe(...)`,
  detached-writer, and materialization/copy seams.
- Latest follow-up cut removed two of those small render-only seams while
  keeping performance in sanity-check mode: `Sequence.renderResolvedValue(...)`
  no longer imports/calls `writeRenderTextResult(...)` for single-node buffer
  writes, and escaped paren semicolon-list render no longer creates a
  replacement comma `List` or calls `.inherit(...)` just to stringify. Public
  `Paren.resolve(...)`/`eval(...)` still materializes the normalized escaped
  list for now; only render was cut. Focused regressions cover async
  single-item sequence buffer writes and patch `Node.prototype.inherit` during
  escaped-list render to prove no replacement list is created. Verification:
  `pnpm --filter @jesscss/core test -- src/tree/__tests__/paren.test.ts src/tree/__tests__/sequence.test.ts`,
  `pnpm --filter @jesscss/core test`, `pnpm --filter @jesscss/core build`, and
  `git diff --check`.
  A lightweight performance sanity check also ran:
  `pnpm run measure:less:hotpath` (`30` iterations, `3` warmup, commit
  `78e689fd0bcd2c98ae854040cecd610337c7ae1f`, Node `v24.11.1`):
  `functions.less` median `13.59ms` / RSD `13.8%`,
  `import-reference.less` median `20.23ms` / RSD `9.9%`,
  `mixins-guards.less` median `19.48ms` / RSD `12.3%`,
  `extend-chaining.less` median `6.18ms` / RSD `9.5%`,
  `media.less` median `5.80ms` / RSD `13.4%`. Treat this as a smoke reading,
  not a benchmark claim. Remaining near cuts: list/sequence addition still maps
  and copies children, `QueryCondition` still resolves into a temporary `Node[]`
  for may-async render, and declaration/reference/selector surfaces still carry
  larger `pipe(...)`, detached-writer, and materialization/copy seams.

Next 15 cut queue completed, performance sanity checks allowed but not the main work:

- [x] 1. Replace `List.deriveAdditionList()` mapped copy array with a pre-sized
  loop.
- [x] 2. Replace `List.operate(... List)` mapped/spread copy append with a loop.
- [x] 3. Replace `Sequence.deriveAdditionSequence()` mapped copy array with a
  pre-sized loop.
- [x] 4. Replace `Sequence.operate(... List)` mapped/spread copy append with a
  loop.
- [x] 5. Replace `Sequence.operate(... Sequence)` mapped copy append with a loop.
- [x] 6. Remove `Sequence.finalizeValues(...)` filter-array allocation on
  common zero/one/many output classification.
- [x] 7. Remove `Sequence.renderResolvedValue(...)` filter-array allocation for
  render classification.
- [x] 8. Add regression coverage that list addition does not use child-array
  `.map(...)`.
- [x] 9. Add regression coverage that sequence addition does not use child-array
  `.map(...)`.
- [x] 10. Add regression coverage that sequence eval/resolve finalization does
  not use `Array.prototype.filter(...)`.
- [x] 11. Add regression coverage that sequence render finalization does not use
  `Array.prototype.filter(...)`.
- [x] 12. Remove `Operation.render(...)` generic `pipe(...)` nesting from the
  render-to-string path.
- [x] 13. Remove `Operation.render(...)` `writeRenderTextResult(...)` adapter
  use after direct render continuation handling.
- [x] 14. Run focused tests for list/sequence/operation after the cuts.
- [x] 15. Update this handoff entry with landed proof, full verification, and
  any performance sanity-check result if run.

Batch proof: `pnpm --filter @jesscss/core test -- src/tree/__tests__/list.test.ts src/tree/__tests__/sequence.test.ts src/tree/__tests__/operation.test.ts src/tree/__tests__/preserve-mode-output.test.ts`
passed (`64` tests), `pnpm --filter @jesscss/core test` passed (`133` files,
`2105` tests, `18` skipped, `2` todo), and `pnpm --filter @jesscss/core build`
passed. A targeted source scan found no remaining
`pipe(...)`, `writeRenderTextResult(...)`, mapped copy arrays, tuple-array
`serialForEach(...)`, or sequence `filter(...)` classification patterns in
`list.ts`, `sequence.ts`, and `operation.ts`. This batch deletes helper arrays,
spread copies, filter arrays, and generic continuation adapters; it does not yet
delete the underlying copied ownership semantics for list/sequence addition.
`pnpm run measure:less:hotpath` also ran after rebuilding core (`30`
iterations, `3` warmup, commit `78e689fd0bcd2c98ae854040cecd610337c7ae1f`,
Node `v24.11.1`): `functions.less` median `15.14ms` / RSD `12.0%`,
`import-reference.less` median `19.66ms` / RSD `10.8%`,
`mixins-guards.less` median `20.76ms` / RSD `14.5%`,
`extend-chaining.less` median `6.64ms` / RSD `12.5%`, and `media.less` median
`5.73ms` / RSD `8.9%`. Treat this as noisy smoke evidence only; no benchmark
claim is made.

Next 15 cut queue completed, small-node render/continuation pass:

- [x] 1. Give `QueryCondition.render(...)` an `F_STATIC` source-direct branch.
- [x] 2. Give `QueryCondition.render(...)` a dynamic sync direct-render branch
  that does not resolve into a temporary `Node[]`.
- [x] 3. Pre-size the `QueryCondition.resolveItems(...)` array for the remaining
  may-async/materialization path.
- [x] 4. Remove the per-call `write` closure from `QueryCondition.render(...)`.
- [x] 5. Add coverage proving static query-condition render does not resolve
  children.
- [x] 6. Add coverage proving dynamic sync query-condition render does not
  resolve children into a temporary materialized array.
- [x] 7. Remove `Quoted.render(...)` generic `pipe(...)`.
- [x] 8. Add/keep quoted render coverage for string, node, escaped, and buffer
  surfaces after the direct continuation split.
- [x] 9. Remove `Url.render(...)` generic `pipe(...)`.
- [x] 10. Add/keep URL render coverage for string and buffer surfaces after the
  direct continuation split.
- [x] 11. Remove `Condition.render(...)` generic `pipe(...)`.
- [x] 12. Remove `Condition.evaluateCondition(...)` generic `pipe(...)`.
- [x] 13. Remove `CustomDeclaration.evalNode(...)` generic `pipe(...)` and make
  `context.inCustom` cleanup explicit for sync and async exits.
- [x] 14. Run focused tests for query-condition, quoted, URL, condition,
  declaration/custom declaration, and operation-adjacent guard behavior.
- [x] 15. Update this handoff entry with landed proof, full verification, and a
  targeted source scan.

Batch proof so far: `pnpm --filter @jesscss/core test -- src/tree/__tests__/query-condition.test.ts src/tree/__tests__/quoted.test.ts src/tree/__tests__/url.test.ts src/tree/__tests__/condition.test.ts src/tree/__tests__/declaration.test.ts src/tree/__tests__/operation.test.ts src/tree/__tests__/preserve-mode-output.test.ts`
passed (`123` tests), and a targeted source scan found no remaining
`pipe(...)`, `writeRenderTextResult(...)`, tuple-array `serialForEach(...)`, or
mapped tuple patterns in `query-condition.ts`, `quoted.ts`, `url.ts`,
`declaration-custom.ts`, and `condition.ts`. This batch deletes render
materialization for static/dynamic-sync query conditions, generic continuation
adapters for quoted/url/condition/custom-declaration paths, and one sparse
query-condition result array growth pattern. Full verification passed:
`pnpm --filter @jesscss/core test` (`133` files, `2107` tests, `18` skipped,
`2` todo), `pnpm --filter @jesscss/core build`, and `git diff --check`.
No performance sanity check was run for this batch; the previous two queue runs
already captured noisy hot-path smoke readings, and this batch makes no
benchmark claim.

Next 15 cut queue completed, small render adapter/closure pass:

- [x] 1. Remove `Block.render(...)` generic `pipe(...)`.
- [x] 2. Keep block render on the existing no-materialized-replacement path.
- [x] 3. Remove `SelectorCapture.render(...)` generic `pipe(...)`.
- [x] 4. Remove `SelectorCapture.render(...)` `writeRenderTextResult(...)`
  adapter use.
- [x] 5. Remove `JsExpression.render(...)` generic `pipe(...)`.
- [x] 6. Remove primitive `JsExpression.render(...)` `writeRenderTextResult(...)`
  adapter use.
- [x] 7. Remove the per-call `renderNode` closure from `Expression.render(...)`.
- [x] 8. Keep list/sequence expression children on their direct render path.
- [x] 9. Remove the per-call `renderNode` closure from `Negative.render(...)`.
- [x] 10. Keep scalar-dimension negative render from creating an operated node.
- [x] 11. Remove per-call wrap/write closures from `Paren.renderEvaluatedNode(...)`.
- [x] 12. Remove `AttributeSelector.evalNode(...)` generic `pipe(...)`.
- [x] 13. Remove `PseudoSelector.evalNode(...)` generic `pipe(...)` and make
  `parenFrames` cleanup explicit for sync and async exits.
- [x] 14. Run focused tests for block, selector-capture, js-expr, expression,
  negative, paren, selector-attr, and selector-pseudo behavior.
- [x] 15. Update this handoff entry with landed proof, full verification, and a
  targeted source scan.

Batch proof: `pnpm --filter @jesscss/core test -- src/tree/__tests__/block.test.ts src/tree/__tests__/selector-capture.test.ts src/tree/__tests__/js-expr.test.ts src/tree/__tests__/expression.test.ts src/tree/__tests__/negative.test.ts src/tree/__tests__/paren.test.ts src/tree/__tests__/selector-attr.test.ts src/tree/__tests__/selector-pseudo.test.ts`
passed (`72` tests). A targeted source scan found no remaining
`pipe(...)`, `writeRenderTextResult(...)`, per-call `renderNode`, per-call
`wrapOutput`, or per-call `writeWrapped` patterns in `block.ts`,
`selector-capture.ts`, `js-expr.ts`, `expression.ts`, `negative.ts`, `paren.ts`,
`selector-attr.ts`, or `selector-pseudo.ts`. Full verification passed:
`pnpm --filter @jesscss/core test` (`133` files, `2107` tests, `18` skipped,
`2` todo), `pnpm --filter @jesscss/core build`, and `git diff --check`. No
performance sanity check was run for this batch; it is a structural adapter and
closure deletion pass, not a benchmark claim.

Next 15 cut queue completed, helper-method self-audit pass:

- [x] 1. Audit new render-rewrite helper methods for one-call wrappers and
  materialization smells before adding more.
- [x] 2. Delete `QueryCondition.resolveItems(...)`; render must not resolve into
  a temporary `Node[]` just because a child may be async.
- [x] 3. Render dynamic `QueryCondition` children directly in both sync and
  may-async cases.
- [x] 4. Collapse `QueryCondition.renderPreparedResolvedValue(...)`.
- [x] 5. Collapse `QueryCondition.renderPreparedDirectValue(...)`.
- [x] 6. Keep static `QueryCondition` rendering source-direct.
- [x] 7. Add/keep proof that static query-condition render never resolves
  children.
- [x] 8. Add/keep proof that dynamic sync query-condition render never resolves
  children.
- [x] 9. Add proof that may-async query-condition render also avoids child
  `resolve(...)` materialization.
- [x] 10. Delete `Expression.renderEvaluatedNode(...)` one-call wrapper.
- [x] 11. Delete `Negative.renderOperatedNode(...)` one-call wrapper.
- [x] 12. Collapse `Paren.wrapRenderedOutput(...)` and
  `Paren.writeWrappedOutput(...)` if they are only previous-pass closure escape
  hatches.
- [x] 13. Delete `SelectorCapture.renderResolvedSelector(...)` one-call wrapper.
- [x] 14. Run focused tests for query-condition, expression, negative, paren,
  selector-capture, and neighboring render behavior.
- [x] 15. Update this handoff entry with landed proof, full verification, and a
  targeted scan of the removed helper names.

Batch proof: `pnpm --filter @jesscss/core test -- src/tree/__tests__/query-condition.test.ts src/tree/__tests__/expression.test.ts src/tree/__tests__/negative.test.ts src/tree/__tests__/paren.test.ts src/tree/__tests__/selector-capture.test.ts src/tree/__tests__/quoted.test.ts src/tree/__tests__/url.test.ts src/tree/__tests__/condition.test.ts`
passed (`85` tests). `QueryCondition.render(...)` no longer calls a
`resolveItems(...)` materializer; dynamic sync and may-async query-condition
render stream children directly, and the async test now throws if child
`resolve(...)` is touched. A targeted scan found no remaining
`resolveItems`, `renderPreparedResolvedValue`, `renderPreparedDirectValue`,
`renderDirectQueryConditionSyntax`, `renderOperatedNode`, `wrapRenderedOutput`,
`writeWrappedOutput`, `renderResolvedSelector`, or `addReturnedTextIfNeeded` in
the touched files. `Paren.renderEvaluatedNode(...)` was audited and retained:
it is a multi-branch render decision point, not a one-call wrapper. Full
verification passed: `pnpm --filter @jesscss/core test` (`133` files, `2107`
tests, `18` skipped, `2` todo), `pnpm --filter @jesscss/core build`, and
`git diff --check`. No performance sanity check was run for this batch; this
was a self-audit/object-materialization deletion pass, not a benchmark claim.

Node-base and repeated-helper audit started:

- `Node.children(...)` was allocating a temporary `Node[]` before yielding
  children. It now streams child values directly for array, object, and direct
  child shapes. This cuts a generic traversal allocation used by visitors,
  `nodes(...)`, declaration walks, extend walks, and helper audits.
- `Node._visitValues(...)` no longer calls `Object.values(...)` for object
  values. It scans own properties directly.
- Dead convenience wrappers `Node.getParent()` and `Node.getValue()` were
  deleted; the two real callers now use `node.parent` and `node.value`
  directly.
- Repeated `Object.values(...).some/for` helper scans were cut in `ruleset.ts`,
  `at-rule.ts`, `util/cloning.ts`, and `util/callable-candidate.ts`.
- One-call render helpers were deleted from `Block`, `Url`, and `Condition`:
  `renderResolvedBlockValue`, `resolveRenderValue`,
  `renderResolvedUrlValue`, and `renderBooleanResult`.

Audit findings still visible:

- `Node.forEachNode(...)` still builds `[node, key, collection]` tuple arrays
  for `F_MAY_ASYNC` traversal. That is a real smell, but it needs a careful
  async indexed-loop replacement because it mutates child slots in order.
- `Node.clone(...)`, `Node.copy(...)`, `Node.inherit(...)`, and `frozen` remain
  the largest base API smell. They are still used by selector extend,
  callable/materialization helpers, and public-ish tests. Do not locally polish
  them; keep deleting hot callers and move any surviving ownership need behind a
  cold materialization boundary.
- `Node.accept(...)` and visitor traversal are broad public machinery. They are
  probably cold compared with Less render/eval, but they sit on `Node` and
  should not grow.
- `List.resolveItems(...)`, `Sequence.evaluateValues(...)`, and their sync
  siblings are still materialization helpers for public resolve/eval or
  may-async fallback paths. They should be audited the same way
  `QueryCondition.resolveItems(...)` was: render must not route through them.
- Repeated `withValue`, `withResolved*`, `own*`, `derive*`,
  `applyDerivedMetadata`, `renderResolved*`, `evaluate*`, and `finalize*`
  methods are not automatically bad, but every one should be classified as:
  public materialization, real mutation isolation, multi-branch semantic logic,
  or bogus wrapper. Bogus wrappers get inlined/deleted.

Focused proof: `pnpm --filter @jesscss/core test -- src/tree/__tests__/node-mutation.test.ts src/tree/util/__tests__/extend-roots.test.ts src/tree/__tests__/ruleset.test.ts src/tree/__tests__/extend-eval-integration.test.ts src/tree/util/__tests__/extend-ampersand.test.ts src/tree/util/__tests__/extend-selector-algorithm.test.ts`
passed (`161` tests), `pnpm --filter @jesscss/core test -- src/tree/__tests__/ruleset.test.ts src/tree/__tests__/at-rule.test.ts src/tree/util/__tests__/cloning.test.ts src/tree/util/__tests__/callable-candidate.test.ts src/tree/util/__tests__/callable-default-guard.test.ts src/tree/util/__tests__/callable-guard.test.ts src/tree/__tests__/mixin.test.ts src/visitor/__tests__/visitor.test.ts src/tree/__tests__/node-mutation.test.ts`
passed (`257` tests), and `pnpm --filter @jesscss/core test -- src/tree/__tests__/block.test.ts src/tree/__tests__/url.test.ts src/tree/__tests__/condition.test.ts src/tree/__tests__/declaration.test.ts src/tree/__tests__/ruleset.test.ts src/tree/__tests__/at-rule.test.ts src/tree/__tests__/node-mutation.test.ts src/visitor/__tests__/visitor.test.ts`
passed (`220` tests). Targeted scans found no remaining `getParent()`,
`getValue()`, `Object.values(...)`, temporary `children()` node-array,
`renderResolvedBlockValue`, `resolveRenderValue`, `renderResolvedUrlValue`, or
`renderBooleanResult` in the touched surfaces.
- Latest handoff continuation started the `F_STATIC`/`F_MAY_ASYNC` split on
  small value containers and then cut the smell called out around
  `List.resolveItems(...)`: dynamic sync render is no longer "resolve every
  item into a temporary value array, then stringify." `List.render(...)` and
  `Sequence.render(...)` keep their existing `F_STATIC` source-direct paths;
  dynamic sync lists and sequences now call child `render(...)` directly and
  use source children only for separator/trivia boundaries. The old
  resolve/evaluate helper arrays remain for explicit `resolve(...)`/`eval(...)`
  materialization and for the `F_MAY_ASYNC` fallback, but they are not the sync
  render architecture. Focused red/green tests patch container `value.map` to
  throw and patch dynamic child `resolve(...)` to throw, proving dynamic sync
  render no longer depends on per-call mapped serial iteration scaffolding or
  child resolution. Focused `list.test.ts` + `sequence.test.ts` passed
  (`44` tests). No real benchmark was run for this micro-slice; treat it as a
  structural function-call/helper-array/materialization cut, not a speed claim.
  Next targets for the same matrix: `Expression.render`, `Paren`, `Negative`,
  selector containers, and declaration/at-rule/ruleset value helpers.
- Latest handoff continuation cut the guard condition call ladder after the
  copied guard deletion. `Condition.evaluateBoolean(...)` is now the direct
  boolean API and no longer builds generic `[left, right]` tuple arrays through
  `pipe(...)` or per-call sync-path helper closures just to finish a boolean
  comparison. Callable guard evaluation, default-guard probing, `$if`, `$while`,
  nil-selector guarded ruleset rendering, and regular ruleset guard eval now
  use that boolean path for `Condition` guards instead of public
  `Condition.eval(...) -> Bool -> unwrap`. The nil-selector condition path also
  bypasses owned guard copying, and regular ruleset guard eval no longer nests a
  `pipe(...)` continuation solely to classify pass/fail. Focused red/green
  tests prove these paths do not call the public Bool-result condition eval
  wrapper, and the focused condition/paren/callable-guard/control/ruleset suite
  passed (`149` tests). No real benchmark was run for this micro-slice because
  the current directive is to gut unnecessary node creation and function calls
  before returning to measurement; do not report this as a speed win until a
  real benchmark says so. Next target remains callable body/output ownership:
  delete the result-child parent identity requirement and replace copied output
  children with source child plus placement state.
- Latest handoff continuation deleted routine copied guard evaluation. The
  `copyGuardForEval` helper and all callback plumbing through callable eval,
  candidate loop, candidate execution, guard prep, and default probing are gone.
  Dynamic and default guards now evaluate the source guard directly with the
  candidate placement/rules context and `context.isDefault` mode; tests prove
  repeated default probes restore context state and do not stamp the source
  guard as evaluated, registration-prepared, or frozen. Focused guard/callable
  utility tests, guard-filtered mixin tests, full `@jesscss/core` tests, and the
  core build passed. The **Real benchmark** result is not a clean speed win and
  must be reported that way: isolated samples after the deletion measured
  medians of functions `28.41ms` then `18.44ms`, import-reference `31.40ms`
  then `28.20ms`, mixins-guards `28.10ms` then `27.53ms`, extend-chaining
  `8.88ms` then `8.41ms`, and media `7.98ms` then `10.98ms`. Compared with the
  previous reference-cut sample, this is mixed/noisy: keep the change because it
  deletes a CPU-profiled routine copy path and passes behavior, not because it
  proves an overall runtime win. Sub-agent audits independently identified the
  next highest-value deletion as callable body/output ownership:
  `createOwnedCallableRulesSurface`, `copyCallableRulesValue`, output-child
  `.parent === result` tests, and mixin-output slot maps that require copied
  output children. Next target: replace owned callable output children with
  source child + placement segment records, with cold materialization only for a
  real public API boundary.
- Latest handoff continuation kept the first render-first cut: plain static
  variable references now short-circuit during `Reference.render` after the
  existing lookup and render the canonical source-backed value directly. The
  focused red repro used the Less shape `@space: 1px 2px; margin: @space;` and
  proved that rendering the reference no longer calls `.inherit(...)`, marks the
  source sequence/children frozen, or rewrites their parents. Focused
  `reference.test.ts`, nearby declaration/render-buffer tests, full
  `@jesscss/core` tests, and the core build passed. The **Real benchmark**
  result was mixed, not a clean speed win: medians were functions `19.00ms`,
  import-reference `26.25ms`, mixins-guards `25.98ms`, extend-chaining
  `9.44ms` with a noisy outlier band, and media `7.49ms`, compared to the prior
  reverted local baseline of functions `16.95ms`, import-reference `27.67ms`,
  mixins-guards `27.69ms`, extend-chaining `7.71ms`, media `7.20ms`. Keep this
  only as a proven ownership-path deletion and the first split point for
  `Reference.render`; do not present it as overall runtime improvement. Next
  target: remove copied guard evaluation or copied callable output placement by
  deleting the reason for the copy, not by making `copyWithReusableLeaves`
  cheaper.
- Latest handoff continuation tested a narrower static declaration pre-render
  cache inside `serializeRulesContainerInternal`: reuse duplicate-declaration
  pre-render text by canonical source declaration when the placement had no
  printable boundary trivia. Focused declaration/ruleset/mixin tests passed,
  but the **Real benchmark** A/B did not justify keeping it. With the cache,
  default hot-path medians were functions `17.74ms`, import-reference
  `27.73ms`, mixins-guards `29.32ms`, extend-chaining `8.12ms`, media
  `7.05ms`; after reverting, the same runner measured functions `16.95ms`,
  import-reference `27.67ms`, mixins-guards `27.69ms`, extend-chaining
  `7.71ms`, media `7.20ms`. The patch was rejected because the intended
  serialization win did not survive the real hot-path set, especially
  mixins-guards and extend-chaining. **Instrumented profiler counters** after
  revert remained unchanged in shape: `Reference.evalNode` 3,610 calls /
  `100.36ms`, `Rules.find` 999 calls / `34.04ms`, 4,123 duplicate-declaration
  pre-renders, 4,037 cached declaration output reuses, and 10 emission preview
  calls. Next target: get a CPU profile or allocation-focused trace for
  `mixins-guards.less` before trying another serialization cache; local
  duplicate pre-render caching is too easy to make neutral or slower.
- Latest handoff round rejected the first virtual callable-output placement
  implementation for static direct declaration/comment bodies. The candidate
  used read-only virtual mixin-output child wrappers so each placement had
  distinct parentage while sharing the canonical static source value; focused
  callable, mixin, and reference tests passed, and the changed baseline gate
  passed after teaching `copyWithReusableLeaves` how to copy virtual children.
  The code was still reverted because the **Real benchmark** default hot-path
  A/B slowed down: with the candidate, final medians were functions
  `21.09ms`, import-reference `29.20ms`, mixins-guards `26.15ms`,
  extend-chaining `7.78ms`, media `7.10ms`; after reverting, the same runner
  measured functions `17.77ms`, import-reference `27.74ms`, mixins-guards
  `25.86ms`, extend-chaining `7.86ms`, media `6.95ms`. This clarified that
  virtual wrappers cannot simply replace owned children on the hot path.
  **Instrumented profiler counters** on broad `benchmark.less` stayed in the
  known shape: `Reference.evalNode` 3,610 calls / `101.61ms`, `Rules.find`
  999 calls / `34.33ms`, 4,123 duplicate-declaration pre-renders, 4,037 cached
  declaration output reuses, and 10 emission preview calls. Next target: avoid
  routine owned child copies by caching/template-rendering static direct body
  output, or by making callable output placement lazy enough that virtual
  child wrappers are only created for APIs that need node identity, not for
  normal eval/render.
- Latest coordinator loop continued with three workers plus local review.
  A duplicate-declaration pre-render skip was rejected twice: both the local
  attempt and render worker found that reducing pre-renders from 4,123 to 860
  moved work into 3,273 emission preview calls and caused a real
  `benchmark.less` blow-up (`1630.53ms avg / 1612.62ms median`). A one-pass
  generated-duplicate classifier also passed focused tests but regressed the
  real benchmark (`516.18ms avg / 480.67ms median`), so it was reverted. The
  Less alpha compat fast path proved correctness for an opt-in plugin-free
  benchmark graph, but real samples were neutral/noisy (`396.11ms avg /
  383.06ms median`, then `454.78ms avg / 454.31ms median`), so do not count it
  as a Jess speed win yet. The accepted code change is correctness-only:
  static callable bodies with children now use owned placement surfaces instead
  of sharing source children in output `Rules.value`; childless static bodies
  still use the unlocked path. Focused callable/mixin tests pass, and real
  broad samples with this correctness fix were `424.59ms avg / 405.97ms median`
  and `423.45ms avg / 392.62ms median`. Next target: implement the real virtual
  callable-output placement model so static/direct body children can preserve
  valid parentage without routine owned child copies. Do not treat the
  conservative owned-surface fix as the performance destination.
- Latest coordinator round used six sub-agents across two batches. Batch one
  produced two candidate patches (callable childless owned-surface reuse and
  reference static declaration-list reuse) and one render cache-skip experiment;
  all were rejected because focused or profiler evidence did not translate into
  a real broad `benchmark.less` improvement. Batch two was exploratory plus
  instrumentation. The Less alpha/compat worker found that no configured
  plugins means no compat visitor traversal, but the facade still constructs
  compat plugin plumbing and must keep import-time `@plugin` support unless the
  source graph can prove no plugin imports. The callable worker narrowed the
  next semantic target to read-only virtual mixin-output placement for
  static/direct body children; do not reuse shared children directly where tests
  require distinct generated output placements. The accepted change adds
  serializer counters to `profile-less-benchmark.mjs` behind an inactive normal
  runtime guard. **Real benchmark** samples after the guard-tightening were
  `388.85ms avg / 390.16ms median` and `388.57ms avg / 380.96ms median`, with
  one noisy intermediate sample at `429.34ms avg / 427.58ms median`; treat this
  as instrumentation-neutral, not a speed win. **Instrumented profiler
  counters** for broad `benchmark.less` showed 1,644 duplicate-declaration
  comparison containers, 4,123 declaration pre-renders, 4,037 cached declaration
  output reuses, and only 10 emission preview calls. Next target: reduce or
  template the duplicate-declaration pre-render pass before trying more local
  copy-loop changes; secondary target is virtual callable output placement.
- Latest coordinator round dispatched three workers: callable owned-container
  creation, reference value copy/eval, and render serialization/static segments.
  The render worker tried skipping duplicate-declaration cache setup when a body
  had no repeated declaration property; focused tests passed, but profiler
  counters showed more writer mark/getSince/restore work, so the render change
  was rejected before benchmark. The callable worker proposed using the unlocked
  derived surface for childless dynamic callable bodies; the reference worker
  proposed reusing source-free static declaration lists during public reference
  resolution. Combined focused tests passed, but **Real benchmark** samples on
  broad `benchmark.less` were `403.19ms avg / 380.21ms median` and
  `394.29ms avg / 388.37ms median` against this round's noisy baseline of
  `397.72ms avg / 380.53ms median`, and profiler counters worsened for
  `Reference.evalNode`/`Rules.find`. Both candidate patches were rejected and
  reverted. Next target: restock workers with deeper semantic tasks, especially
  callable body/output reuse beyond childless bodies, reference eval without
  extra lookup/finalize work, and render instrumentation that separates
  duplicate-declaration pre-scan cost from emission-time preview cost.
- Latest handoff round tightened the reporting rule again: user-facing
  performance summaries must not include `profile-less-benchmark.mjs`
  `elapsedMs`. A narrow callable-copy experiment changed
  `copyCallableRulesValue` record copying from `Object.entries(...)` to a
  `for...in` loop to avoid an entries-array allocation on a CPU-profiled copy
  path. Focused callable/mixin tests passed, but **Real benchmark** samples on
  broad `benchmark.less` regressed versus the run baseline
  (`380.90ms avg / 374.47ms median` and `378.21ms avg / 355.68ms median`
  versus `355.73ms avg / 352.18ms median`), and profiler counters did not show
  a compensating per-method win. The change was rejected and reverted. Next
  target: stop trying local copy-loop reshapes; inspect `createOwnedCallableRulesSurface`
  and callable output/body evaluation for a semantic reduction in owned
  container creation or reusable static render segments.
- Latest handoff round captured the deeper broad `benchmark.less` CPU profile
  requested by the previous target. **Real benchmark** baseline was
  `355.73ms avg / 352.18ms median` for 15 runs / 5 warmup.
  **Instrumented profiler counters** showed `Reference.evalNode` 3,610 calls /
  `100.40ms`, `Rules.find` 999 calls / `31.57ms`, `LessParser.parse` 3 calls /
  `87.28ms`, and stable writer/mixin counts. The **CPU profile** showed
  `Rules.find` is not the main self-time
  target: top self samples were `Node` construction, GC, `findVarWithinScopeSurface`,
  `wouldMatchNode`, `OutputWriter.getSince`, `constructCopy`, `copyChild`, and
  `copyWithReusableLeaves`; inclusive stacks still concentrate under eval,
  render serialization, reference evaluation, callable guard/candidate copies,
  parser setup, and extend classification. A scoped scratch-`Set<Rules>` reuse
  experiment inside variable lookup passed focused reference tests, but real
  benchmark samples regressed to `361.98ms avg / 346.69ms median` and then
  `389.35ms avg / 375.04ms median`; after reverting, the sample was
  `373.89ms avg / 353.22ms median`. The scratch-set change was rejected. Next
  target: attack copy/container creation where the CPU profile shows real cost,
  especially `copyGuardForEval`/callable candidate surfaces or reference value
  copy paths, and require real benchmark improvement before keeping changes.
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
  `benchmark.less` baseline measured about `412.00ms avg / 383.02ms median`.
  The CPU profile showed `processExtends`
  back near the top, with copy pressure still fragmented across guard,
  registration, callable, and render paths. The kept change caches the original
  selector subtree value set once inside `applyExtendsToSelector` and threads
  it into chained-extend lookup, avoiding repeated original-selector walks
  after successful extends. Focused extend tests and the broader mixin test are
  green. Post-change broad samples were about `380.99ms avg / 367.85ms median`
  and `396.34ms avg / 383.44ms median`. Less 4.5 remains about `47ms`, so broad alpha is still
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
- The `profile-less-benchmark.mjs --file=benchmark.less` counters after
  the extend error-record change were stable:
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
