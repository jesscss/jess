# Registry Redesign — Handoff

Date: `2026-04-13`
Branch: `dev`
Checkpoint commit: `ddf46b1c` (`Narrow reference import parity seam`)

## Status

This handoff is historical design and recovery context, not an operational
queue. The attempted checked-in task registry and Codex loop/runtime scaffolding
were retired after proving too brittle for reliable unattended work.

Use current repo evidence and focused tests for active execution state. Do not
infer a queue from this handoff, and do not recreate the retired auto-loop
machinery as part of registry or TriviaMap work.

Current checkpoint (`2026-05-04`, `dev` at/after `2c8ee648`):

- Track 1B is closed unless new code evidence shows a remaining shell exists
  only to fake placement-local state.
- Track 1C direct `resolve(context)` / `render(context)` ownership is largely
  swept across core node classes. The remaining raw `return this.evalNode(context)`
  sites are mostly intentional direct delegations that bypass generic
  `Node.evalStatic(...)` stamping; do not add redundant overrides just to quiet
  grep.
- Invalid production `N.*` checks for node names not present in the 32-bit
  bitmask table were fixed where they affected runtime behavior:
  `Num`/`Negative` use direct class checks in Less slash parsing,
  `InterpolatedSelector` uses a direct class check in Less mixin key
  normalization, and the stale `N.Number | N.Dimension` check now uses the real
  `N.Dimension` mask it had already collapsed to at runtime.
- `packages/jess/test/less/all-less.test.ts` is the only fixture-backed Less
  integration authority in `packages/jess/test/less`. The other files in that
  directory are marked `describe.todo`; their local expectations may be bad
  until revalidated against upstream Less test-data, Less.js behavior, or a
  documented Jess-specific contract.
- Less slash parsing distinction to preserve: keyword-ish / generic `Any`
  slash values such as `foo / 2` stay slash lists even in `mathMode: 'always'`;
  real parsed `Color / Num` values are operation-shaped when mathMode allows
  division. Do not collapse those into one "color keyword" rule.

## Baseline Recovery Checkpoint

`packages/jess/test/less/all-less.test.ts` is currently red again, even after a
full rebuild of `@jesscss/core`, `@jesscss/less-parser`,
`@jesscss/plugin-less`, `@jesscss/plugin-less-compat`, and `jess`.

That means the current gap is not stale build output. Treat the drift below as
real parser/runtime/serialization regressions until each item is reduced to a
focused proof and fixed.

Current outer-proof buckets:

- just-fixed hard parser/runtime regressions
  - `tests-unit/selectors/selectors.less`
    `.active&:extend(.extend-this) {}` is now covered by focused
    `less-parser` selector tests after removing the fused `AmpersandExtend`
    token and parsing `&` + `:extend(...)` structurally instead
  - `tests-unit/operations/operations-advanced.less`
    no longer crashes on preserved slash-list operands like
    `@div-op: 10px / 2; result: @div-op * 2;`
  - `tests-unit/import/import-reference.less`
    no longer throws `ReferenceError: 'fallback' is not defined`; unquoted
    indexed refs (the parser-normalized at-rule-prelude shape) now consult
    live runtime var bindings. The remaining outer diff in this fixture is
    comment preservation only; the `.b` / `.b .c` grouping split is fixed in
    focused core coverage by keeping transparent mixin/import `Rules` wrappers
    from interleaving later declarations after nested containers.
  - `tests-unit/at-rules-keyword-comments/at-rules-keyword-comments.less`
    fixed in focused parser/core coverage by preserving authored parser trivia
    when context-backed at-rule header rendering serializes evaluated preludes,
    so `@media` / `@import` keyword comments now survive eval output again
  - `tests-unit/import/import-remote.less`
    same `fallback` runtime failure removed by the indexed-ref live-binding fix;
    focused outer proof is green again after rebuilding `core` and `jess`
- likely semantic regressions worth reproing in focused core tests first
  - `tests-unit/media/media.less`
    fixed in Jess terms: no nested `@media` / `@supports` query merging should
    be reintroduced here. The Less.js alpha fixture was updated to the
    intentional nested-media Jess output, with the old expectation copied into
    the linked Less.js `legacy/` fixture folder.
  - `tests-unit/mixins-guards-default-func/mixins-guards-default-func.less`
  - `tests-unit/mixins-guards/mixins-guards.less`
  - `tests-unit/mixins-interpolated/mixins-interpolated.less`
    current focused repro is now reduced to the empty `mi-test-d .person {}`
    leak in a combined core proof. Do **not** patch this as a one-off hidden
    ruleset visibility tweak without checking the render-vs-canonical
    serialization contract below first.
  - `tests-unit/property-accessors/property-accessors.less`
    treat the old Less 4.x expectation as fixture drift, not a Jess core bug:
    declarations stay in authored order. Do not "fix" core by hoisting or
    regrouping late declarations ahead of nested selectors just because
    property-accessor values resolve later. The linked Less.js alpha fixture
    should track Jess output, with the old CSS copied into `legacy/`.
  - `tests-unit/rulesets/rulesets.less`
    treat the old Less 4.x expectation as fixture drift, not a Jess core bug:
    declarations stay in authored order relative to deeper nested frames. The
    linked Less.js alpha fixture should track Jess output, with the old CSS
    copied into `legacy/`.
  - `tests-unit/functions/functions.less`
    now green after focused parser/runtime fixes:
    - fixed: `color(plum)` now parses through shared color-token handling and
      Less `color()` normalizes parsed named-color nodes to hex output
    - fixed: `hsv(...)` now serializes with Less-compatible hex output
    - fixed: `mix(#ff0000, transparent)` now serializes as `rgba(...)`
    - fixed: `hsl(380, 150%, 150%)` clamp canonicalization
    - fixed: custom-property output now keeps the narrowed Jess contract:
      reference/interpolation resolution is allowed in evaluated custom values,
      but generic calls are not widened into a general custom-value eval path
    - fixture drift fixed in linked Less.js alpha data: `--e:` now matches
      Jess's no-space custom-property surface
    - fixed: escaped semicolon lists now normalize to commas when lowered out
      of `~(...)` runtime wrappers, which restores `list-3`
    - fixed: reused `less-compat` plugin instances now get cloned per compiler
      build, so Less harness helper functions like `_color`, `increment`, and
      `add` do not disappear after earlier files seed stateful compat visitors
  - `tests-unit/color-functions/rgba.less`
    now green after focused function/core fixes:
    - fixed: `hsla(color, 0.5)` color-overload alpha coercion now accepts the
      unitless numeric node shape the Less runtime passes through this alias
      path, instead of silently falling back to literal `hsla(...)` output
    - fixed: custom-property serialization no longer treats Less fallback
      function-name references as a signal to eagerly evaluate the whole value
    - fixed: custom-property output restores stable authored spacing for the
      atomic hex-alpha and fallback-call cases in this fixture
  - `tests-unit/ie-filters/ie-filters.less`
  - `tests-unit/nesting/nesting.less`
- extend-path regressions / warning drift
  - `tests-unit/extend-chaining/extend-chaining.less`
  - `tests-unit/extend-nest/extend-nest.less`
  - `tests-unit/extend-selector/extend-selector.less`
  - `tests-unit/extend/extend.less`
  - related `extend-*` fixtures in the same run
- formatting / serialization parity drift
  - comments / whitespace / css-3 / css-grid
    - declaration/custom-property comment spacing in `tests-unit/comments/comments.less`
      now fixed in core serialization
    - invisible-node trivia in `tests-unit/comments/comments.less` now preserves
      block comments attached to evaluated-only variables before the next
      visible output surface; remaining comments fixture work is in the
      selector/header slice
  - selected color-function output forms
  - selected URL / shorthand / `!important` formatting
  - declaration ordering / grouping drift in fixtures like
    `property-accessors.less` and `whitespace.less`
- new deprecation-warning surfaces now visible in outer parity
  - bare at-rule-prelude vars in Less fixtures
  - bare custom-property value vars
  These warnings may be correct, but the fixture contract needs an explicit
  decision instead of letting them drift silently through the baseline.

Recovery order:

1. Reproduce hard parser/runtime failures in focused parser/core tests.
2. Fix true behavior regressions before touching formatting-only parity.
3. Re-run `all-less.test.ts` after each discrete slice.
4. Do not mark the baseline green again in docs until the direct outer proof is
   actually green.

## Priority Reset

Recent work cleaned up `reference.ts`, but that is **not** the highest-leverage
performance frontier anymore.

The benchmark and architecture audits still point to four larger cost centers:

1. **Track 1B/1C completion: shared-tree convergence plus eval/render merge** —
   the broad renderKey/fork runtime is now gone, but mixin/import shell cleanup
   and the node-level `render/resolve` migration still need to fully harden the
   "one canonical tree, no forks, no retained per-placement eval state" target.
2. **serializer backtracking / buffered render (Track 5)** — the audit shows
   `OutputWriter.mark/getSince/restore` text peeks are still huge runtime costs.
   Production `writer.capture()` calls under `packages/core/src/tree` have been
   removed; the remaining cost is explicit preview/rollback and the frame-state
   coupling those previews preserve.
   Moving toward typed render buffers and deferred selector finalization is the
   follow-through after Track 1C, not a bucket for node-level render migration
   slices that belong in Track 1.
   Guardrail: this does **not** mean "skip the evaluated-node step and print
   strings straight from source nodes." The target is "no retained full
   evaluated tree": evaluate one node, produce the immediate evaluated/derived
   node, allow visitor/rewrite replacement there, then serialize it
   immediately unless a deferred structure truly needs to keep it.
   Additional guardrail: `PrintOptions` is transitional, not target
   architecture. As eval and render collapse, live render/session state should
   move onto the singleton `Context` and be managed with save/restore there,
   not normalized as a permanent copied-options layer.
3. **clone / copy / materialization pressure** — `Node.clone` / `Node.copy`
   remain hot in the benchmark and should be treated as architectural debt, not
   acceptable runtime infrastructure.
4. **remaining generic registry/query overhead in `Rules` / registries** — the
   lookup fast paths were worth building, but further performance wins should
   now live primarily in `rules.ts`, `registry-utils.ts`, and render/storage
   ownership, not in more local `Reference` grooming.

Related transitional smell to keep in mind:

- `attachSelectorBitLibrary(...)` is not target architecture. It exists because
  some selector fragments are still created/copied in detached states and then
  asked for keyset behavior before normal parent/source/tree inheritance has
  reattached `keySetLibrary`. Note it as debt; do not expand the pattern unless
  a local bridge is unavoidable.

Practical rule for the next agent:

- do **not** keep iterating on `reference.ts` unless it directly unblocks one of
  the four items above
- prefer planning / narrowing Track 1B/1C and Track 5 against the actual hot
  files (`rules.ts`, `import-style.ts`, `serialize-helper.ts`, `print.ts`,
  render-bearing eval nodes) before spending more time on lookup-node cleanup
- use the benchmark evidence in
  [2026-04-13-less-benchmark-audit.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-less-benchmark-audit.md)
  and
  [2026-04-13-registry-architecture-audit.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-registry-architecture-audit.md)
  to justify the next slice

## Hard Requirement: Preserve Canonical Source Serialization

Track 1C is about collapsing evaluated output onto `render(ctx)` / `resolve(ctx)`.
It is **not** permission to lose source-preserving serialization of canonical
nodes.

Keep these contracts distinct:

- `toString()` remains the canonical source serializer for the shared AST.
- `render(ctx)` is the evaluated trimmed-output path.
- `toTrimmedString()` should shrink toward a compatibility shim around
  node-owned trimmed syntax helpers so authored syntax does not get
  implemented twice while `render(ctx)` stays context-bound.

Use this as the guardrail for ambiguous nodes:

- `SelectorCapture.toTrimmedString()` should still serialize `*[ ... ]`
  syntax.
- `SelectorCapture.render(context)` may resolve the captured selector payload
  for evaluated output.
- `SelectorCapture.toString()` must continue to round-trip the authored wrapper.

The same principle applies to quoted forms, references, URLs, interpolation,
and any other node where canonical source syntax is not the same as evaluated
output.

## Serialization Contract

`render(context)` and canonical serialization should share the same node-owned
serialization machinery. The difference is not "render serializer" versus
"source serializer"; it is whether the node is serialized as-is or first
resolved/evaluated in the active context.

Working decision to preserve:

- `toString()` serializes the node as it exists now.
- `toTrimmedString()` serializes the same node as-is, but without outer
  formatting/trivia that belongs to its containing surface.
- `render(context)` resolves/evaluates the node for the active context, then
  serializes the resulting node through the normal `toString()` /
  `toTrimmedString()` path.
- Sharing `toTrimmedString()` from `render(context)` is expected and desirable
  when the resolved node shape is already the evaluated output shape.
- Output/container callers own visibility, ordering, boundary, and traversal
  policy. A node serializer should not grow ad-hoc visibility policy just to
  compensate for the wrong caller emitting the wrong child.

Practical guidance for the next fix:

- Treat empty-frame leaks like `mi-test-d .person {}` as likely evidence that a
  caller is emitting the wrong resolved child, using the wrong traversal policy,
  or keeping structural eval state in the wrong place; do not assume the
  individual node serializer is wrong.
- Before changing visibility checks on a node type, first ask what node shape
  `resolve(...)` should return and which output/container caller is responsible
  for deciding whether that node participates in final output.
- Any local fix in this area should make the transform-then-serialize boundary
  clearer, not split canonical and evaluated syntax into parallel serializers.

Implementation note: the current `context.printState <-> printState.context`
cycle is transitional convenience state, not target architecture. Track 1C
should keep treating `PrintOptions` as a temporary render-state carrier while
ownership moves more explicitly onto `Context`/session state.

Concrete regression found while recovering `import-reference-issues`:

- forked preview/inline print states were still carrying `context`
- `getPrintOptions()` treated any context-bearing non-`context.printState`
  object as a request to rebase onto the live `context.printState`
- that let preview/child serialization silently replace the active frame arrays
  under a caller mid-render
- symptom: inline container serialization could return CSS with a missing final
  closing brace even though the child container itself serialized correctly in
  isolation

Working rule from that fix:

- if a caller passes an explicit forked print state (`writer` / frame arrays
  already present), `getPrintOptions()` must keep it detached even when it also
  carries `context`
- rebasing onto `context.printState` is only correct for fresh top-level entry
  into printing, not for preview/fork child paths
- `writer` is now treated as explicit print state in that check, matching the
  frame-array behavior and keeping preview/trivia consumers from mutating
  `context.printState` just because they need a render context.

## Work Checklist

Top-level track numbers stay stable so cross-doc references to Tracks 2–5 do
not churn. The cleanup here is to split **Track 1** into three explicit slice
families:

- **Track 1A** — lookup and binding transport
- **Track 1B** — canonical-tree convergence for mixins/imports/loops
- **Track 1C** — eval/render API convergence (`eval` + `toTrimmedString` → `render/resolve`)

### Track 1A — Lookup And Binding Transport

- [x] Slices 1–4 — mixin params → `RuntimeVarBinding` cells; params bypass declaration registry
- [x] Slice 5 — `varsByName` fast map on `Rules`; lexical variable lookup bypasses declaration registry
- [x] Slice 6 — `ScopeFrame` introduced alongside registry; `buildScopeFrame` / `resolveFrameCell` in `scope-frame.ts`
- [x] Slice 7 — `mixinsByName` fast map on `Rules`; static-named mixin lookup bypasses `MixinRegistry.find`
- [x] Slice 8 — Wire `ScopeFrame` parent chain at mixin call time; `outerRules.scopeFrame.liveSlotsByName` carries params; `resolveFrameCell` finds them via frame chain with call-site parent
- [x] Slice 9 — `liveSlotsByName` frame-chain walk is the primary mixin param lookup path in `performLookup`; `runtimeVarBindings` kept as fallback; only `liveSlotsByName` walked (not `declarationBucketsByName`) to preserve Less definition-site semantics for lexical vars
- [x] Slice 10 — Retire `runtimeVarBindings`; `@arguments` joins `liveSlotsByName`; `buildScopeFrame` accepts optional live slots; proof tests updated to behavioral assertions
- [x] Slice 11 — `getScopeFrame()` auto-wires parent frame by walking node parent chain; inner rules within mixin body inherit `outerRules.scopeFrame` as parent; `reference.ts` live-slot walk uses clean `frame.parent` chain
- [x] Slice 12a — Extend `findVarDeclarationFast` with `beforeIndex` for positional variable lookups
- [x] Slice 12b — Delete `resolution: 'linear'`; remove `beforeIndex` from `findVarDeclarationFast`; strip linear branches from `performLookup`, `toTrimmedString`, and `declaration.ts`; delete the linear-specific test in `rules.test.ts`
- [x] Slice 13 — Delete fork/renderKey system from the active node/runtime path
  Status:
  - Done: the active renderKey/fork runtime is gone from `Node`, `Context`,
    lookup, serializer state, wrapper transport, and node eval/storage.
  - Done: leaf eval/storage, serializer fallback reads, lookup-side render-key
    threading, and node-level fork maps/caches are all removed from the active
    path.
  - Remaining seam: no longer generic renderKey deletion; only the Track 1B
    canonical-tree cleanup slices (`13c`–`13e`) and any narrowly-discovered
    follow-on cleanup still couple back to the old model.
  - Guardrails: `Context` remains singleton session state; `PrintOptions`
    keeps shrinking; `&` is live contextual selector state; end-state nodes
    should be very light, effectively immutable templates.
- [x] Slice 13b — Wire `$for` loop iteration variables through `ScopeFrame` / `liveSlotsByName` (same as mixin params, Slices 8–11). `$for` no longer materializes synthetic loop `VarDeclaration`s just to transport `value` / `key` / `index`; per-iteration wrapper `Rules` now get a `scopeFrame` with those bindings in `liveSlotsByName`, and loop-var references resolve without declaration-registry lookup. The loop body still uses renderKey for shared-node mutation isolation, so this slice removes declaration-shaped binding transport but does **not** make `$for` fully fork-free by itself.
  Status:
  - Done: `$for` iteration variables now live in `ScopeFrame.liveSlotsByName`,
    and emitted loop output no longer retains iteration-local frame state.

### Track 1B — Canonical-Tree Convergence

- [x] Slice 13c — Finish **mixin** canonical-tree + binding-frame convergence
  Current status:
  - Done: params, rest params, `@arguments`, detached/callable rulesets,
    dynamic/default guards, recursion prevention, and caller-fallback
    discipline now ride `ScopeFrame` plus explicit wrapper state rather than
    fork-era provenance transport.

- [x] Slice 13d — Finish **import** canonical-tree + binding-frame convergence
  Current status:
  - Done: configured `with/set` bindings, guarded imported mixins,
    replacement/additive configured wrappers, reference-import callable parity,
    detached closure visibility, and import-boundary ownership now work from
    explicit frame/boundary state instead of copied provenance walks.

- [x] Slice 13e — Validate remaining structural-shell cleanup
  Current status:
  - Done: the remaining mixin/import/loop derived `Rules` surfaces were audited
    against code and focused tests. Track 1B is closed unless new evidence shows
    a surface exists only to fake placement-local state.
  - Surviving surfaces are semantic: additive import config results preserve an
    imported boundary plus added children; import postludes are real
    `@media`/`@supports`/`@layer` output containers; multi-candidate mixin
    output needs one invocation result surface; `$for` output uses canonical
    body-derived surfaces without synthetic declaration transport.
  - Guardrail: do not recreate fork-era locality through `clonedEval(...)`,
    `preserveOriginalNodes`, `maybeClone(...)`, or implicit provenance stamping.
  - Net cleanup: import boundaries, fallback scope, reference ancestry,
    selector-cache ownership, import dedupe, direct call output, JS function
    args, dynamic-name materialization, and ruleset selector copies no longer
    depend on broad `sourceParent`/`sourceNode` stamping. Remaining provenance
    is explicit and local to the semantic surface that needs it.
  - Plain no-op `with` imports now reuse the canonical imported `Rules`
    surface, stylesheet functions and detached callables share the lighter
    callable-body path, and `@jesscss/fns` `each()` lowers to `For` over the
    canonical callback rules surface.

### Track 1C — Eval / Render API Convergence

- [x] Slice 13f — Establish `render(ctx)` / `resolve(ctx)` ownership for leaf and value nodes
  Goal:
  - Replace "eval stores result, later `toTrimmedString()` reads it" with
    "render or resolve now, then discard" for literal/value/leaf nodes.
  - Preserve canonical source serialization: `toString()` stays the authored
    AST serializer, while `toTrimmedString()` becomes a compatibility shim
    around authored trimmed-syntax helpers where possible.
  - Keep this work visible in Track 1 instead of burying it under Track 5.
  Current first slice:
  - Static leaf/value nodes (`Any`/`Keyword`, `Bool`, `Nil`,
    `Dimension`/`Num`, `Color`, `Combinator`, `Rest`, `Comment`, and
    `DefaultGuard`) now render directly through `render(context)` without
    marking source nodes `preEvaluated` or `evaluated`.
  - `DefaultGuard` is context-dependent, so `render(context)` writes the
    current `context.isDefault` boolean text directly instead of evaluating the
    guard node into a retained `Bool`.

- [x] Slice 13g — Migrate materialization boundaries and expression nodes
  Goal:
  - `Operation`, function calls, interpolated identifiers, dynamic names, and
    guard/value computations should compute via `resolve(ctx)`, write through
    `render(ctx)`, and stop retaining per-placement eval results on nodes.
  - This is the slice family that captures the `eval`/serialization merge for
    value-producing nodes.
  Current first slice:
  - Simple value wrappers (`Expression`, `Condition`, `Negative`, `Paren`,
    and `Operation`) now resolve through their existing `evalNode(context)`
    logic without using generic `Node.evalStatic(...)` to stamp the wrapper
    node `preEvaluated` / `evaluated` during direct `render(context)` or
    `resolve(context)`.
  - `Operation` required one real render-path support fix first:
    plain `calc(...)` rendering now sets the same `context.calcFrames` math
    frame that eval-time `calc(...)` already sets before rendering operation
    args.
  Current follow-up slice:
  - `Call.resolve(context)` now delegates to the existing call evaluation body
    directly, so resolving a CSS/function/mixin call no longer marks the call
    source node `preEvaluated` / `evaluated` just to obtain the output value.
  - Interpolation wrappers (`Interpolated`, `Quoted`, and
    `InterpolatedSelector`) now do the same: direct `render(context)` /
    `resolve(context)` uses existing value-resolution logic without stamping
    the wrapper source node.
  - `Sequence.resolve(context)` now bypasses generic eval stamping while still
    using the existing sequence eval logic, including trivia-backed render
    spacing behavior.
  - Single-value wrappers (`Url` and `Block`) now resolve through their
    existing child-eval path without stamping the wrapper source node; inherited
    `QueryCondition` coverage verifies the `Sequence` path for media/supports
    style conditions.
  - Selector value wrappers (`AttributeSelector`, `PseudoSelector`, and
    `SelectorCapture`) now resolve through selector-specific eval logic without
    generic eval stamping, while source serializers remain canonical.
  - `List.resolve(context)` now bypasses generic eval stamping while preserving
    the existing child-eval traversal and list separator/trivia serialization.
  - `Reference.resolve(context)` now delegates directly to reference lookup
    evaluation, matching the existing invariant that a reference resolves to
    another node and should not be retained as an evaluated source node.
  - `Log.resolve(context)` now runs the diagnostic eval body directly, so
    compile-time log directives can emit diagnostics and return `Nil` without
    retaining eval flags on the invisible source node.
  - Definition-like values (`Collection` and `Func`) now resolve as their
    canonical source nodes without falling through generic eval stamping; direct
    variable parameter resolution coverage also asserts the no-stamp invariant.
  - JS host wrapper values (`JsFunction`, `JsObject`, and `JsArray`) now resolve
    as themselves without generic eval stamping. They are runtime carriers, not
    evaluated CSS output placements.
  - `MixinCollection` now resolves as the resolved callable-candidate carrier
    it already is, without generic eval stamping. Actual mixin invocation still
    belongs to `MixinCollection.evalCall(...)`.
  - `RawRules` now resolves as a source-owned verbatim container instead of
    inheriting `Rules.resolve(...)` and creating an evaluated clone. This keeps
    direct render/resolve aligned with its exact-output purpose.
  - `JsImport` now resolves as a canonical source directive without generic eval
    stamping; its eventual module-loading behavior belongs to the JS import
    runtime, not default child-walk evaluation.
  - `AtRule.resolve(context)` now evaluates through a derived at-rule wrapper,
    so direct at-rule resolution can normalize/evaluate its prelude and body
    without retaining eval flags on the canonical source at-rule.
  - The selector family now has direct `resolve(context)` ownership on simple
    and container selector classes, so basic, complex, compound, and
    selector-list nodes use selector-specific eval setup without falling through
    generic source-node eval stamping.
  - `Range.resolve(context)` now keeps the current parsing-only range node out
    of generic eval stamping while preserving its canonical inclusive/exclusive
    range serialization.
  - `Mixin.resolve(context)` now treats mixin definitions like other
    definition-only nodes: direct resolve returns the definition without marking
    the source mixin as an evaluated output placement.
  - `CustomDeclaration` coverage now proves it inherits the declaration
    no-stamp resolve path while still restoring `context.inCustom`.
  - Static/leaf syntax nodes (`Any`/`Keyword`, `Bool`, `Nil`,
    `Dimension`/`Num`, `Color`, `Comment`, `Combinator`, `Rest`, and
    `DefaultGuard`) now have focused same-node resolve assertions, with direct
    resolve ownership where generic eval stamping had still been leaking in.
  - Deprecated `JsExpression` now resolves through its existing eval body
    directly, preserving the evaluated JS value behavior without retaining
    eval flags on the source expression node.
  - Follow-up audit: production code no longer reads undefined `N.Num`,
    `N.Negative`, `N.Number`, or `N.InterpolatedSelector` masks. Those were
    runtime bugs because an omitted mask means "is any node" and bitwise OR with
    `undefined` silently collapses to zero. Remaining undefined `N.StyleImport`
    / `N.JsImport` uses are parser-test contract drift only; do not patch them
    by extending the current 32-bit bitmask table casually.

- [x] Slice 13h — Migrate structural render ownership and session state
  Goal:
  - `Rules`, `Ruleset`, `AtRule`, `Ampersand`, selector composition, and other
    structural render nodes should move live state onto the active session
    context, with `PrintOptions` shrinking to a transitional bridge.
  - This is the final Track 1 bridge into Track 5's segmented-buffer design.
  Current first slice:
  - Focused no-stamp coverage now proves direct `Declaration.resolve(...)` and
    `Ruleset.resolve(...)` leave their source node eval flags alone.
  - `Rules.resolve(context)` now evaluates through a derived rules wrapper
    rather than generic eval-stamping the source rules container. This is still
    transitional structural state ownership; the target remains moving the live
    render/session state onto `Context`.
  - `Ampersand` now has focused coverage for framed resolve behavior: it may
    read the active ruleset frame and produce the merged selector value, but it
    must not mark the source ampersand as evaluated or allocate print state.
  - `Extend.resolve(context)` now delegates to the existing extend eval body
    directly, so direct resolution can return `Nil` / register extend side
    effects without generic eval stamping the source directive.
  - `ExtendList.resolve(context)` now keeps Less standalone extend lists
    source-owned without generic eval stamping; individual `Extend` nodes still
    own runtime registration side effects.
  - `$for` keeps direct `render(context)` on canonical control syntax, but
    direct `resolve(context)` now evaluates loop output through the existing
    loop body without generic eval stamping the source control node.
  - `$if` and `$while` keep direct `render(context)` and `resolve(context)` on
    canonical source syntax until parent `Rules` owns evaluated control-flow
    emission, but direct resolution no longer falls through generic eval
    stamping. `$while` body visibility now matches `$if` / `$for`.
  - `StyleImport.resolve(context)` now delegates directly to import evaluation,
    so optional/reference import surfaces can be resolved without generic eval
    stamping the source import node; the full `import-style` test file covers
    this because import behavior is broad.
  - Follow-up audit: declaration, ruleset, basic selector, and ampersand
    no-stamp behavior is already covered by focused package-local tests. Do
    not add redundant `resolve` methods to those classes just to quiet a raw
    `evalNode` grep.
  Closure review:
  - Track 1C is closed. Direct `render(context)` / `resolve(context)` coverage
    now exists across leaf/value nodes, expression/materialization boundaries,
    and the structural render surfaces that were still falling through generic
    `Node.evalStatic(...)` source-node stamping.
  - Remaining raw `return this.evalNode(context)` methods are intentional
    direct ownership paths: they use the node-specific evaluation body without
    entering `Node.evalStatic(...)`, so they do not by themselves mark the
    source node `preEvaluated` / `evaluated`.
  - Remaining generic `preEvaluated` / `evaluated` state is runtime evaluation
    state, not proof that Track 1C is incomplete. Reopen Track 1C only with a
    focused failing test or code path showing direct `render(context)` /
    `resolve(context)` is still stamping a canonical source node through
    generic evaluation.
  - Remaining `OutputWriter.mark()` / `getSince()` / `restore()` /
    `capture()` usage belongs to Track 5 serializer-buffer work, not Track 1C.
- [x] Slice 14 — Retire `DeclarationRegistry` hot path for variable lookups; once all callers confirmed to go through `findVarDeclarationFast` / `liveSlotsByName`, remove the `targetRules.find('declaration', ...)` fallback for `type === 'variable'`
  Status:
  - Done: hot variable lookup now uses `findVarDeclarationFast` +
    `ScopeFrame.declarationBucketsByName`, including parent-visible child
    surfaces, without `DeclarationRegistry.find`.
  - Dynamic-name note: unresolved dynamic declaration names are still treated
    synchronously as misses; retry ownership stays with surrounding `Rules`
    evaluation, not the lookup path.
- [x] Slice 15 — Retire `MixinRegistry` hot path; `findMixinFast` already covers static-name Mixin lookups; verify no Ruleset-as-mixin gaps, then drop the `targetRules.find('mixin', ...)` fallback for the static-string case
  Status:
  - Done: static callable lookup now lives behind `Rules.find('mixin', ...)`
    via `findMixinsFast`; plain mixin hits/misses bypass `MixinRegistry.find`.
  - Remaining fallback class: only the genuinely ambiguous legacy
    `mixin-ruleset` array-path cases where neither mixin nor ruleset-side
    fast paths can decide synchronously.
- [x] Slice 16 — Retire `RulesetRegistry` and remove the speculative standalone ruleset lookup surface
  Status:
  - Done: `RulesetRegistry` and the standalone ruleset lookup surface are gone.
  - Ruleset-shaped callables now resolve only through the callable/mixin
    surface; extend roots keep their own per-root `Ruleset` sets directly.
- [ ] Cleanup slice — Extract the shared `Reference` lookup algorithm and move type-specific logic behind lookup-surface adapters
  Status:
  - Partly done: `Reference.evalNode()` is now mostly orchestration over
    extracted helpers/adapters rather than one giant type-switch.
  - Priority note: this is de-prioritized. Only touch `reference.ts` when it
    directly helps Track 1B shell cleanup, Track 1C render ownership, shared
    lookup ownership in `Rules`, runtime binding generalization, or Track 5.
- [ ] `FunctionRegistry` optimization — keep as plugin API but change granularity from per-`Rules` to per-stylesheet: one global registry for built-ins/plugins; one stylesheet-level registry created on demand when `registerFunction()` is called within a stylesheet; stylesheet registry falls through to global; `@compose` children see only the global (not the parent stylesheet registry); `@import` children see the parent stylesheet registry; O(1) lookup in common case (no stylesheet-local functions), O(depth of stylesheet registries between call site and global) otherwise — in practice 1-2 hops, never the full Rules-node depth

### Track 2 — Node Shape: Direct Instance Fields

Replace the current `value = Proxy({ name, value, ... })` pattern with direct typed class fields on each node class (e.g. `decl.name`, `decl.value`). Stable V8 hidden classes, no per-node Proxy allocation, no Proxy intercept cost.

- [ ] Audit all node classes for field shape (`declaration.ts`, `ruleset.ts`, `mixin.ts`, etc.)
- [ ] Migrate fields off `value` proxy to direct class properties with explicit `adopt()` calls
- [ ] Update all call sites in `core`, `fns`, parsers, and plugins to use new field accessors
- [ ] Update `less-compat` adapter layer to map old `value.name` / `value.value` paths to new fields
- [ ] Remove `value` proxy infrastructure from `Node` base class once all subclasses migrated

### Track 3 — Less-Compat Adapter Layer (MOSTLY done)

Replace the transparent `Proxy`-based compat shim with explicit typed adapter classes (e.g. `LessRuleset`, `LessDeclaration`). V8-inlineable getters, no per-node Proxy, explicit API surface.

Current status: mostly done. The proxy-to-adapter swap is landed and the
compat/plugin surface is running through explicit adapter classes now. Plan one
follow-up pass after Track 2 changes the underlying node API again; that pass
should let us drop more legacy field-mapping glue and simplify the adapters
further.

- [x] Design adapter class interface for each Less-exposed node type
- [x] Implement adapter classes (`jess-plugin-less-compat` package)
- [x] Replace `isLessProxy` / `getJessNodeFromProxy` checks with `instanceof` guards
- [x] Remove the `Proxy` factory from the compat layer
- [x] Verify Less compatibility suite still green after switch
- [x] Revisit once Track 2 lands and simplify the adapter layer around the new direct-field API

### Track 4 — TriviaMap Cleanup

The old whitespace-token proposal is now the current `TriviaMap` status note;
see [docs/future/whitespace-token-proposal.md](/Users/matthew/git/oss/jess/docs/future/whitespace-token-proposal.md).
Do not use this historical handoff as an active migration checklist.

Current contract:

- parser results carry one file-context `TriviaMap`
- `before` / `after` are lookup directions, not trivia ownership
- skipped-token runs may be indexed from both neighboring offsets but are
  consumed once by the active print state
- direct rule-body block comments are `Comment` children
- inline/value/selector comments and whitespace stay in `TriviaMap`
- evaluated/copied nodes that move placement must not keep copied source-offset
  trivia

Remaining work belongs to focused serializer and AST-shape slices, backed by
tests. Static declaration names may become plain `string` after the remaining
declaration-name shape is audited, but that is node-shape work, not evidence
that trivia should move back onto nodes.

### Track 5 — Pre-Eval Elimination (Buffered Render)

Registry redesign (Track 1) and direct instance fields (Track 2) are prerequisites.

**Eval shape decision: linear render with explicit pending work.**
Track 5 should target a single source-order render/eval walk that streams
strings and queues typed placeholder segments for unresolved work. The current
priority queue should not survive as the normal renderer. Keep only the narrow
schedulers that have code evidence today: `StyleImport` path-resolution retries
and local fixed-point retries for dynamic declaration names. The segmented
buffer below already requires deferred finalization for extends / `@media`
bubbling / reference imports; pending-ref segments reuse that machinery rather
than adding a second ordering source of truth. Static bucket pre-population from
`_indexRules` means forward refs usually resolve on first touch, so the miss
list is expected to be small or empty in the common case. See
[pre-eval-elimination.md](/Users/matthew/git/oss/jess/docs/future/pre-eval-elimination.md)
("Decision: Linear Render With Deferred Misses") for the decision and the
measurements to keep taking during implementation.

**Key design constraint: extends and `@import (reference)` require deferred selector finalization.**
A true single-pass top-to-bottom render cannot know at the time it encounters `.a {}` whether
a later `.b:extend(.a) {}` will augment its selector, or whether a reference-imported ruleset
needs to surface at all. The solution is a *buffered render with typed segments* — most output
is strings, but selector-bearing nodes push structured segments that are finalized in a cheap
post-step.

**Do not build AST v2.**
The render buffer is temporary output state, not a second tree. Add a segment
only when a piece of output has a proven delayed-finalization need: selector
extension, reference visibility, hoisting, merge declarations, or a concrete
pending lookup. Do not add segment types for ordinary node shape, traversal
convenience, ownership bookkeeping, or speculative future reuse. If output can
be written as a string in flat mode, it should stay a string.

Delayed segments should still serialize their children aggressively. A
`RulesetBlock`, `HoistBlock`, `MergeSlot`, or pending slot may keep the minimum
wrapper state needed for its own finalization, but any child output that is
already final should be pushed as strings inside that segment. Do not keep child
nodes or child-shaped segment trees alive just because their parent segment is
delayed.

#### Buffer segment types

```ts
type Segment = string | RulesetBlock | HoistBlock | MergeSlot | PendingRefSlot

interface RulesetBlock {
  selector: SelectorSet   // live reference, not yet stringified
  body: Segment[]         // recursively nested
  isReference: boolean    // from @import (reference) — suppress unless activated by extend
  extendRoot: ExtendRoot  // which root this ruleset is reachable from (baked in at push time)
}

interface HoistBlock {
  atRule: string
  selectorContext: SelectorSet | undefined
  body: Segment[]
}

interface MergeSlot {
  property: string        // +: and +_: — needs all same-property decls within scope before finalizing
  segments: Segment[]
}

interface PendingRefSlot {
  key: string
  segments: Segment[]
}
```

#### Extend side table (collected during the render pass)

```ts
interface ExtendRecord {
  targetSelector: SelectorSet   // what's being targeted
  extendRoot: ExtendRoot        // which root the :extend() lives in
  sourceBlock: RulesetBlock     // block whose selector gets augmented
}
```

#### Post-step (pure function, no AST access)

For each `RulesetBlock` in the buffer:
1. **Selector match** — walk-and-consume / `selector-match-core` against `ExtendRecord.targetSelector`
   (same algorithm, but operating on already-resolved `SelectorSet` objects, not AST nodes)
2. **Root visibility** — `record.extendRoot` can reach `block.extendRoot`
   (same predicate as `extend-roots.ts`, but purely over two `ExtendRoot` values baked in at push time)
3. **Reference visibility** — `block.isReference` blocks inclusion unless matched by steps 1+2

The post-step is `(Segment[], ExtendRecord[]) → string` — no registry queries, no live context,
no AST traversal. Straightforward to test in isolation.

#### Checklist

- [x] Track 5 capture-site orientation
  Current read:
  - Treat every `capture()` as suspect until the caller proves a current
    semantic need. "Not active backtracking" is not a defense: captures left
    over from pre/post trivia isolation are still overhead and should be
    removed when direct streaming preserves the same trivia and sourcemap
    behavior.
  - Several captures are likely legacy trivia/boundary isolation from the
    pre/post era. For each one, ask what side effect it protects against now:
    consumed-trivia containment, sourcemap segment replay, string trimming /
    normalization, empty-output preview, or true speculative output. If the
    answer is only "old boundary scaffolding", delete it behind a focused test.
  - Highest-value sites to reason about first:
    1. Resolved checkpoint: root `Rules.toString()` no longer joins the emitted
       range for body-emptiness or EOF-newline checks, and no longer routes body
       emission through `Rules.toTrimmedString()` just to discard that return
       string. It now streams the body directly and keeps one full-range join for
       the final returned text.
    2. Resolved checkpoint: `Rules` / `serialize-helper` no longer call
       `writer.capture()` for child preview/emit paths. Those paths still use
       explicit `mark/getSince/restore` text previews and rely on the same
       frame-stack side effects, so this is cleanup progress rather than the
       target buffered renderer.
    3. Resolved checkpoint: `Sequence` no longer inspects the emitted text range
       for each child boundary. It now asks the writer for the last emitted
       character when deciding implicit spacing / identifier merge guards, and
       keeps only the final `getSince(mark)` needed to return its own text.
    4. Generic `Node.toString()` capture of leading trivia and body; this was
       pure boundary scaffolding and has been removed so generic nodes stream
       leading trivia and body directly.
  - Lower-priority captures include small delimiter/list/function helpers where
    the capture is mostly a local string transform (`trim`, comma joining,
    quote/url normalization). These are still candidates for removal, but each
    needs a replacement for that string transform before the capture goes away.
- [x] **Decide eval shape**: Shape B is the Track 5 target. Use linear
  render/eval with typed pending segments, plus narrow schedulers for the two
  proven blocking cases (`StyleImport` path interpolation and dynamic
  declaration-name fixed points). Continue measuring miss counts and cascade
  depth while implementing, but do not preserve the broad priority queue as the
  default renderer.
- [x] Add `_hasExtends` and `_hasReferenceImports` flags to `Rules` during `_indexRules`
  Current status: `Rules` now carries local structural `_hasExtends` and `_hasReferenceImports`
  flags as Track 5 prep. They are maintained during `registerNode(...)`, survive
  evaluated import wrapping, and reflect nested `Rules` subtrees because parent
  indexing indexes child `Rules` before reading their subtree flags. This is
  enough to start gating later render work on a per-container basis, but it is
  **not yet** the full transitive import-graph / whole-file segmented-render
  decision described below.
  - **`@compose`**: flags are per-file, set at that file's own index time — each file is a
    closed rendering unit; children cannot affect parents at all (parents pass state *down*
    to children only via `mutable: true`); flat/segmented decision is independent per file
  - **`@import`**: flags must be propagated transitively up the import graph after the full
    graph is resolved; any file in the graph having an extend forces the combined root into
    segmented mode; the only static optimization available is the transitive flag itself —
    deeper static analysis is not tractable (selector matching is undecidable under
    interpolation); per-file caching requires migrating to `@compose`
- [x] Design `Segment` / `RulesetBlock` / `HoistBlock` / `MergeSlot` / `PendingRefSlot` / `ExtendRecord` types
  Current status: initial concrete types and tiny finalization helpers live in
  [packages/core/src/tree/util/render-buffer.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/util/render-buffer.ts).
  The test coverage in
  [packages/core/src/tree/util/__tests__/render-buffer.test.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/util/__tests__/render-buffer.test.ts)
  proves flat mode stays string-only, delayed segment children can still be
  strings, nested segment bodies recurse only through caller-provided
  finalizers, and extend records are collected as a side table.
- [x] Implement flat-mode `RenderBuffer` (common case: no extends, no reference imports — pure `string[]`, no segment allocation, no post-step)
  Current status: `createRenderBufferForFlags(...)` chooses flat mode unless
  `_hasExtends` or `_hasReferenceImports` requires segmented mode. This is still
  the buffer utility layer, not node-level render integration.
- [x] Implement segmented-mode `RenderBuffer` (has extends or reference imports)
  Current status: segmented buffers carry `segments` plus `extendRecords`, and
  helper constructors create `RulesetBlock`, `HoistBlock`, `MergeSlot`, and
  `PendingRefSlot` with explicit child segment bodies. This is still segment
  storage/finalization plumbing; selector extension, reference visibility, and
  hoist semantics are separate post-step work below.
- [ ] Implement `render(ctx, buf: RenderBuffer)` on each node type; flat mode pushes strings directly
  Current status: `renderNodeToBuffer(...)` provides a flat-buffer bridge for
  current node serializers. It resolves a node, serializes the immediate output
  into a flat buffer, and refuses segmented buffers so delayed-output behavior
  has to be implemented explicitly by the nodes that need it. Static leaf nodes
  `Any`, `Combinator`, `Bool`, `Nil`, `Rest`, `DefaultGuard`, and visible
  `Comment`, plus value leaves `Dimension` and `Color`, now accept flat buffers
  directly while preserving their existing string `render(context)` path.
  Resolved string-wrapper nodes `Quoted` and `Url` also use the flat bridge.
  Simple resolved wrapper nodes `Block`, `Expression`, `Negative`, and `Paren`
  also use the flat bridge.
  Simple value containers `List` and `Sequence` also use the flat bridge; their
  existing serializer still owns separator, spacing, and trivia behavior.
  Interpolation wrappers `Interpolated`, `InterpolatedSelector`, and
  `SelectorCapture` also use the flat bridge.
  Value expression nodes `Operation`, `Condition`, `QueryCondition`, and
  `Range` also accept flat-buffer rendering.
  `Call` also accepts a flat buffer through a deliberately thin bridge around
  its existing call-render path; it does not introduce a second call serializer.
  Stop treating broad flat-buffer overload coverage as the critical path once
  simple value/render nodes are covered. The next architectural dependency is
  the `preEval`/`eval` convergence described in
  [docs/future/pre-eval-elimination.md](/Users/matthew/git/oss/jess/docs/future/pre-eval-elimination.md):
  segmented rendering needs a source-order render/eval walk with local
  materialization, pending slots, and explicit identity/registration prep. That
  should happen before deeper `Rules` / `Ruleset` / `AtRule` / `Declaration`
  buffer integration.
- [ ] Migrate extend collection from AST walk to render-pass side table population
- [ ] Implement post-step: selector finalization, extend application, reference visibility
- [ ] Migrate `extend-roots.ts` reachability logic to pure `ExtendRoot × ExtendRoot` predicate
- [ ] Remove `evalNode` / `preEval` / `toTrimmedString` from node base class once all node types migrated
- [ ] Verify end-to-end output parity with pre-existing test baselines

## Read This First

### Must Read For This Slice

1. [AGENTS.md](/Users/matthew/git/oss/jess/AGENTS.md)
2. [2026-04-13-registry-redesign-proposal.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-registry-redesign-proposal.md)
3. [2026-04-13-registry-architecture-audit.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-registry-architecture-audit.md)
4. [packages/core/src/tree/rules.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts)
5. [packages/core/src/tree/reference.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts)
6. [packages/core/src/tree/__tests__/mixin.test.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/__tests__/mixin.test.ts)

### Background Context Only

Read these only if you need the broader performance story or canonical-tree
constraints behind the current design:

- [2026-04-13-less-benchmark-audit.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-less-benchmark-audit.md)
- [2026-04-13-less-benchmark-investigation-tickets.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-less-benchmark-investigation-tickets.md)
- [docs/future/node-copy-reduction/README.md](/Users/matthew/git/oss/jess/docs/future/node-copy-reduction/README.md)
- [docs/future/node-copy-reduction/HANDOFF.md](/Users/matthew/git/oss/jess/docs/future/node-copy-reduction/HANDOFF.md)

## What Was Started

The first implementation slice targets one specific architectural mistake:

- mixin-call params and `@arguments` were being materialized as `VarDeclaration`
  nodes
- those synthetic declarations were pushed into a wrapper `Rules`
- variable lookup then rediscovered them through generic declaration-registry
  search

That is exactly the wrong shape described in the redesign proposal.

The first cut changed that by making wrapper-scope param values available as
direct runtime bindings instead of wrapper-inserted declaration nodes.

The second cut removed another declaration-shaped transport step:

- mixin matching no longer rewrites matched `Any(role=property)` params into
  fake `VarDeclaration`s
- mixin matching no longer rewrites matched `Rest` params into fake
  `VarDeclaration`s just to carry values forward
- matching now carries:
  - runtime binding records for actual lookup
  - a separate `List<Node>` signature for recursion detection

The third cut removed the copied-and-mutated param list itself:

- mixin matching now reads original param definitions directly
- bound/default/rest values are cloned only for binding/signature payloads
- matching no longer mutates copied param nodes to transport values

The fourth cut removed a now-dead shallow `mixin.copy()` in candidate matching:

- candidate matching no longer makes a shallow mixin copy just to carry
  resolved params
- resolved binding records are keyed directly by the original matched mixin

The fifth cut adds a `varsByName` fast map on `Rules` for direct lexical
`VarDeclaration` lookup, bypassing the full declaration-registry machinery for
the dominant hot case (ordinary contextual variable lookup):

- `Rules.varsByName: Map<string, VarDeclaration[]> | undefined` — `undefined`
  means not yet indexed; an empty `Map` means indexed with no vars
- populated incrementally by `registerNode` as nodes are pushed
- also initialized at the start of `_indexRules()` for scopes that never had
  nodes pushed directly
- reset to `undefined` in `clone()` so cloned scopes re-index fresh
- `findVarDeclarationFast(startRules, name, filter)` in `reference.ts` walks
  `.parent ?? .sourceParent` (same as `findRuntimeVarBinding`), checks
  `varsByName` at each `Rules` scope, bails if any scope is not yet indexed
  (causing the caller to fall through to full registry which warms it up)
- called between the `findRuntimeVarBinding` check and the full `targetRules.find`
  in `performLookup` for `type === 'variable'`
- proof test added: a no-param mixin referencing `@base-color` 3 times asserts
  `declarationHits.length <= 1` — only the first lookup hits the registry; the
  second and third use the fast path

## Files Changed

- [packages/core/src/tree/rules.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts)
- [packages/core/src/tree/reference.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts)
- [packages/core/src/tree/__tests__/mixin.test.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/__tests__/mixin.test.ts)

## Current Dirty Diff

### `rules.ts`

Added a lightweight runtime binding mechanism on `Rules`:

- `RuntimeVarBinding`
- `rules.runtimeVarBindings`
- `setRuntimeVarBinding(name, binding)`
- `findRuntimeVarBinding(name)`

Mixin invocation wrapper behavior changed:

- param wrapper scope still exists
- param AST nodes are still preserved for AST/debugging compatibility
- but wrapper params are no longer pushed into `outerRules` as lookupable
  declarations
- instead, wrapper params are registered via `outerRules.setRuntimeVarBinding(...)`
- `@arguments` is also registered as a runtime binding instead of a synthetic
  `VarDeclaration`
- matched `Any(role=property)` params now stay non-declaration-shaped during
  matching
- matched `Rest` params now stay non-declaration-shaped during matching
- recursion detection still gets a stable signature list, but that signature is
  now separate from the runtime binding transport
- matching no longer copies the whole params list before binding
- matching no longer mutates copied param nodes just to carry bound/default
  values
- matching no longer shallow-copies mixin candidates just to associate resolved
  params with them

### `reference.ts`

Variable lookup now checks runtime bindings before declaration lookup, and
then the `varsByName` fast path before the full registry:

- in `performLookup(...)`, variable lookup on `Rules` does:
  1. `targetRules.findRuntimeVarBinding(key)` first (mixin params)
  2. `findVarDeclarationFast(targetRules, key, filter)` second (lexical vars)
  3. full `targetRules.find('declaration', ...)` third (fallback / warm-up)

`findVarDeclarationFast` is a module-level function that:

- walks `.parent ?? .sourceParent` up the scope chain
- checks `scope.varsByName` at each `Rules` node
- returns `undefined` immediately if any scope is not yet indexed (warm-up
  fallback)
- stops at non-classic-import boundaries (same policy as full registry)

Reference evaluation also learned how to evaluate a runtime binding:

- evaluate the bound value
- copy/freeze the result similarly to declaration lookup
- preserve `pre` / `post`
- use `sourceNode` for recursion protection when available

### `mixin.test.ts`

The focused mixin suite was updated to match the new intended model:

- live params no longer render as emitted `$var: ...;` declarations
- mixin behavior still resolves those params correctly
- rest params and nested param lookups still work

This is an intentional semantic shift in output visibility for synthetic param
bindings.

## What Passed

Focused core verification is green:

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
```

That now includes a core-only guardrail proving:

- mixin-call param bindings
- default param bindings
- rest param bindings
- `@arguments`

resolve successfully without hitting `Rules.find('declaration', ...)` for those
names.

After the second slice, this is still green:

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
```

After the third and fourth slices, this is still green:

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
```

After the fifth slice, this is still green (34 tests):

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
```

Workspace dependency build is green:

```sh
pnpm --filter jess... build
```

Direct full benchmark render through the linked Less facade:

```sh
node -e 'const fs=require("node:fs"); const less=require("/Users/matthew/git/oss/less.js/packages/less"); const file="/Users/matthew/git/oss/less.js/packages/less/benchmark/benchmark.less"; const src=fs.readFileSync(file,"utf8"); less.render(src,{filename:file}).then(out=>{console.log("ok", out.css.length)}).catch(err=>{console.error(JSON.stringify({message:err.message, filename:err.filename, line:err.line, column:err.column, extract:err.extract}, null, 2)); process.exit(1);});'
```

Observed result:

- `ok 0` — confirmed pre-existing at clean commit `51291e2f` (before any session
  changes); slices 1–5 neither introduce nor worsen this. Treat as pre-existing
  harness integration debt; investigation is not the next step for this slice.

## What Is Still Broken

The old Less-facade benchmark harness investigation is no longer the primary
next step for this slice.

The redesign work should continue in `core`, with focused proofs and targeted
instrumentation there first.

The performance harness path is still not trustworthy for this slice:

This command currently fails:

```sh
node scripts/profile-less-benchmark.mjs --file=benchmark.less
```

Observed failure:

- `'size' is not defined`

Important narrowing:

- the failure does **not** reproduce in direct `less.render(...)` of the full
  benchmark file
- a tiny imported-mixin default-param repro also works in direct `less.render`
- so this looks like a harness-path mismatch, not a confirmed runtime
  regression in the main render path

## Harness Status

The harness failure is now treated as secondary tooling debt, not the main
driver of the redesign.

What is known:

- full `less.render(...)` of the benchmark file succeeds
- full `less.render(...)` with `math: 'always'` also succeeds
- importing `core`, `less-parser`, or `jess` alone does not reproduce the
  harness failure

So the failure is likely in the instrumentation setup itself, not the first
runtime-binding cut.

## Likely Cause Of The Remaining Failure

The most likely cause is that the profiling harness is exercising a slightly
different execution environment than the main Less facade path:

- different plugin setup
- different compiler entrypoint
- different option surface
- or different import/context plumbing

The current `'size' is not defined` symptom points at imported Less mixin
default-param access, but only in the harness path.

Do **not** assume the runtime-binding cut itself is wrong until the harness path
is made faithful to the real benchmark execution path.

## Why "No Forks, No Mutations" Is Possible

The fork/renderKey system exists because the current engine is **two-pass**:

```
pass 1 — eval:       walk the tree, evaluate each node, store results on the node
pass 2 — serialize:  walk the tree again, read stored results, build CSS string
```

Between pass 1 and pass 2, results must be stored somewhere. Nodes are that somewhere. When the same mixin body is called twice with different params, both calls would overwrite each other's stored results — so `renderKey` forks each node into per-call storage.

**The target model collapses both passes into one:**

```
one pass — render:   walk the tree as a read-only template,
                     resolve references against the active ScopeFrame on the fly,
                     write output directly to the output buffer
```

Nothing is stored on the node. The node is a description of what to render. Two calls to the same mixin body walk the same template with different `ScopeFrame`s and write to different positions in the output buffer. No intermediate storage. No fork.

The two-function API (from the proposal's "How Each Node Type Renders" section):

- `render(node, ctx) → void` — for output-producing nodes; writes directly to `ctx.outputBuffer`; never stores on the AST
- `resolve(node, ctx) → Node` — for value-returning contexts (function arguments, guard conditions, key resolution); evaluates without writing; result is used immediately then garbage-collected

For example, an `Operation` in the new model:

```
render(op, ctx):
  left  = resolve(op.left, ctx)   // → Color, Dimension, etc. — discarded after use
  right = resolve(op.right, ctx)
  result = compute(left, op.operator, right)
  emitResolved(result, ctx)
  // result is GC'd — never stored on any AST node
```

No `op.set('result', result, renderKey)`. No per-call fork. Just compute → write → discard.

**Current status**: Track 1A built the lookup prerequisite by making variable
and param reads context-driven via `ScopeFrame`/`varsByName`. Track 1B removed
the active fork runtime and converged most shared-tree binding behavior. The
remaining structural-evaluation work now belongs explicitly to Track 1C:
`Operation`, `Interpolated`, selector/render ownership, and the gradual
replacement of stored eval results with `render/resolve`. Track 5 then
consumes that API shape for the segmented-buffer / post-step architecture.

One explicit guardrail for the remaining `Ampersand` work:

- treat `&` like a live contextual selector binding
- the binding source is the current parent selector / selector context, not
  `liveSlotsByName`
- but the ownership rule is the same as other live state: it belongs in the
  captured live context or a short-lived derived node, never on the canonical
  source `Ampersand` node
- this matters because extends can change the effective parent selector later,
  so `&` must resolve against the current live selector view rather than an
  earlier stored snapshot

See: proposal "How Each Node Type Renders" (~line 347) and "Materialization Boundaries" (~line 398) for the full model.

---

## Resolution Strategy Architecture

`ReferenceOptions.resolution` now has two modes:

| Mode | Meaning | When used |
|------|---------|-----------|
| `'contextual'` (default) | **Contextual** — ordinary refs use contextual scope lookup. | All ordinary variable and property lookups |
| `'live'` | Resolve using the call site's live lookup position. | Jess `$~var` syntax inside mixin bodies |

`'linear'` (formerly Jess `$^var` syntax) has been deleted. It is not used in Less
or in any shipped Jess syntax, and the merge-declaration case that was incorrectly
using it should be handled through explicit live lookup, not the default contextual mode.

### Variable lookup order in `performLookup` (type === 'variable')

1. **`liveSlotsByName` frame-chain walk** — covers mixin params and `@arguments`
   (populated at call time into the `ScopeFrame`; walks `frame.parent` chain which
   is the call-site chain, not the node-parent chain)
2. **`findVarDeclarationFast` fast path** — covers ordinary lexical vars when
   `opts.ignoreParentScopeStart` is true (the normal case); walks `varsByName`
   on each `Rules` ancestor via node-parent chain; bails if any scope is not yet
   indexed (falls through to full registry which warms it up)
3. **`targetRules.find('declaration', ...)` full registry** — fallback for
   unindexed scopes and edge cases; also warms up `varsByName` and `mixinsByName`
   for future fast-path hits

### Key constraint: `liveSlotsByName` vs `declarationBucketsByName`

Only `liveSlotsByName` is safe to walk via the call-site frame chain. Lexical
vars in `declarationBucketsByName` follow Less **definition-site** semantics —
walking them via the call-site chain would return wrong values (call-site
definitions instead of definition-site definitions). The frame chain is therefore
used only for live param slots; lexical vars go through `findVarDeclarationFast`
which uses the node-parent chain (definition site).

## Bootstrap Closure Bug Fix (Session 2026-04-13)

This session fixed a correctness bug that was blocking the Bootstrap benchmark: mixin body
local variables were inaccessible inside detached rulesets passed to other mixins.

### Pattern being fixed

```less
#table-row-variant(@state, @background) {
  @hover-background: darken(@background, 5%);       // local body var
  .table-hover .table-@{state} {
    #hover({ background-color: @hover-background; }); // closure over @hover-background
  }
}
```

### Root cause

In `MixinCollection.evalCall`, anonymous-mixin candidates (no `name`/`params`/`guard`) are
processed via the "anonymous mixin path". The path shallow-cloned the body (`unlocked`) and
pushed it to `outputRules` **unevaluated**. When `Call.evalNode` later called
`result.eval(context)` on the containing `&:hover` Ruleset, a deep-clone (from
`evaluateCandidateOutput`'s `clonedEval` context) overwrote `unlocked.parent` via `adopt()`,
breaking the parent chain that led back to the outer mixin body's registry where
`@hover-background` was registered.

### Fix (anonymous mixin path in `rules.ts`)

Evaluate `unlocked` immediately while the call-site parent chain is intact:

```typescript
// Before: push unevaluated
outputRules.push(unlocked);

// After: evaluate immediately, push result
const evaledUnlocked = unlocked.eval(context);
unlocked = (isThenable(evaledUnlocked) ? await evaledUnlocked : evaledUnlocked) as Rules;
outputRules.push(unlocked);
```

`unlocked.parent` walks up through `candidate.parent` (the args List of the outer mixin call)
→ the outer Call → the calling mixin's body Rules → the `Ruleset` that called `#hover` →
cbody (`Rules` of the outer mixin) — which has `@hover-background` in its registry.
After evaluation `unlocked` is static, so the subsequent `result.eval(context)` pass is a
no-op for it.

### Tests added

Two regression tests added to `mixin.test.ts`:

- `resolves local mixin body variable inside a detached ruleset passed to another mixin (closure)`
- `resolves local mixin body variable inside a detached ruleset when call is nested in a child ruleset`

Both pass. Full core suite: **1165 passed, 22 skipped** (no new failures).

### Reference.ts fast-path fix

During this session a stale edit was found in `reference.ts` that accidentally removed the
early return in the `findMixinFast` path:

```typescript
// Before (correct, at HEAD):
if (fast.length > 0) {
  return fast;  // skips MixinRegistry.find — the point of the fast path
}

// After bad edit:
// early return removed, always fell through to MixinRegistry.find
```

Restored to original behavior. The `mixinsByName fast path (slice 7)` test verifies this.

---

## Next Step

Track 1 is no longer about outer renderKey plumbing. That runtime is gone.

What remains:

1. Treat Track 1B and Track 1C as closed unless new focused code evidence
   shows a canonical-tree or direct-render invariant is still broken.
2. Start Track 5 with a narrow serializer-buffer spike: inventory the live
   `OutputWriter` mark/capture/backtracking sites, decide which are true
   segmented-buffer needs versus local formatting helpers, and keep the first
   implementation slice measurable.
3. Keep the handoff compressed: remove stale references to `_renderKey`,
   `_childForks`, `getValue(renderKey)`, and wrapper renderKey transport as if
   they are still live work.

Do not reintroduce node-local fork machinery under a different name. If a pass
does not make the source tree lighter or move eval/serialization closer to the
session-owned buffer model, it is probably not a Track 1 pass.

## Constraints To Preserve

- Keep one canonical `Rules.value` array.
- Do not introduce cloning/materialization as a lookup strategy.
- Do not reintroduce wrapper `VarDeclaration` insertion just to make lookup
  work.
- Preserve the direct render behavior that is currently green.
- Keep the next cut narrow and measurable.

## Useful Commands

Focused test:

```sh
pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts
```

Build dependency chain:

```sh
pnpm --filter jess... build
```

Direct benchmark render sanity check:

```sh
node -e 'const fs=require("node:fs"); const less=require("/Users/matthew/git/oss/less.js/packages/less"); const file="/Users/matthew/git/oss/less.js/packages/less/benchmark/benchmark.less"; const src=fs.readFileSync(file,"utf8"); less.render(src,{filename:file}).then(out=>{console.log("ok", out.css.length)}).catch(err=>{console.error(JSON.stringify({message:err.message, filename:err.filename, line:err.line, column:err.column, extract:err.extract}, null, 2)); process.exit(1);});'
```

Current failing harness check:

```sh
node scripts/profile-less-benchmark.mjs --file=benchmark.less
```

## Current Worktree State

At the time of this handoff, the uncommitted files are:

- [packages/core/src/tree/rules.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts) — `getScopeFrame()` now auto-indexes previously untouched scopes; runtime `VarDeclaration` registration keeps existing `declarationBucketsByName` buckets in sync without duplicating entries
- [packages/core/src/tree/reference.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts) — `findVarDeclarationFast` now reads per-scope `ScopeFrame.declarationBucketsByName` instead of `Rules.varsByName`, while preserving outward walk on the `Rules` parent/sourceParent chain
- [packages/core/src/tree/__tests__/mixin.test.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/__tests__/mixin.test.ts) — tightened proof test: lexical contextual variable lookups no longer touch `DeclarationRegistry.find`

Test status: **1167 passed, 22 skipped** (78 files pass, 2 skip; no failures).
