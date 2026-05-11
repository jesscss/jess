# Node Copy Reduction

This folder is the active handoff for reducing and, where possible, eliminating
routine node copying during eval. It should stay small enough to read at
startup.

## Direction

- Keep one canonical source tree as the default model.
- Prefer lazy per-placement runtime state over routine copied or cloned trees.
- The target compile path is not "eval creates a complete output tree, then
  serialize that tree". Evaluation should move semantic state forward and
  rendering should emit through contextual resolution, with small owned output
  surfaces only where a rule, scope, import/reference, merge, or generated
  selector placement truly needs one.
- Do not treat `copy()`/`clone()` as the future evaluation model. The target is
  to remove them from normal eval flow for most cases, not to make every legacy
  copy path more elaborate.
- Use shallow wrapper owners only when they carry real local scope, registry, or
  output ownership.
- Keep render state ownership explicit. Fresh render traversals should reset
  context-owned print state, while nested render bridges should reuse the
  active writer/frame/trivia state through `prepareRenderPrintState(...)`
  instead of recreating that decision at each call site.
- Treat deep clone, materialization, and broad wrapper growth as debt unless a
  focused proof shows they are still required.
- Fix structural ownership bugs where they are created, not by filtering output
  later.

## Current Frontier

The remaining work is production conversion, not old model preservation. The
verified baseline is green; use focused tests to prove each copy boundary before
touching production code.

- `packages/core/src/tree/rules.ts`
  - `Rules.resolve(context)` now uses the shared derived Rules surface instead
    of `clone(false)`; the derived wrapper preserves function-registry and
    live-slot ownership while forcing lazy registry re-indexing, and preserves
    rules-like subclasses such as `Collection`
  - `setDefined` insertion now derives the generated declaration through the
    declaration-owned derivation path instead of calling generic
    `VarDeclaration.copy()` during registration
  - guarded mixin dispatch now has local candidate accessors; those accessors
    are the next place to replace raw candidate field reads when an explicit
    ownership surface exists
  - guarded mixin dispatch still has ambient scope plumbing
  - param/rest/`@arguments` binding still uses frozen deep copies in places;
    already-evaluated or static childless scalar values with no source location
    now bind directly, and copied param/default/rest/`@arguments` containers
    now reuse source-free scalar leaves while keeping the container as the
    owned binding surface
  - resolving live-slot values now also reuses those source-free scalar leaves,
    including children of copied source-free `@arguments`/rest containers; the
    containers themselves still keep an owned copy surface
  - static guards are proven copy-free; dynamic guards and default-guard probes
    still use a copied eval surface, but that surface now reuses childless
    source-free scalar leaves
  - ruleset-call and ordinary mixin output now derives the root `Rules`
    wrapper directly and clones only child output surfaces through the shared
    reusable-leaf helper; direct comment children remain cloned/preserved for
    each output placement
  - detached-ruleset unlock is covered by a regression test proving it does not
    deep-clone body leaves before evaluating the unlocked surface, and now
    derives the unlock wrapper instead of shallow-cloning the source rules
  - derived empty mixin wrapper surfaces are now constructed directly instead
    of shallow-cloning non-empty body rules and clearing them
  - post-eval merged declaration coalescing now keeps its accumulated value map
    as a read-only snapshot surface and lets merge composition own the copy
    boundary, instead of recopying every stored/list-flattened value leaf
  - merged declaration composition now copies owned value containers with the
    shared reusable-leaf traversal, so source-free scalar leaves are not copied
    again while list/sequence/rules surfaces remain owned by the output
- `packages/core/src/tree/reference.ts`
  - `preserveRulesLike` variable references now keep a shallow owned wrapper
    instead of deep-copying the referenced rules-like body; that shallow
    wrapper is constructed directly instead of through `clone(false)`
  - fallback, runtime-binding, and declaration reference result copies now use
    the shared reusable-leaf traversal directly; the old `freezeChildren` copy
    branch and bespoke source-free list/sequence clone path are gone
  - merged declaration reference flattening now reuses the already-copied
    leaves instead of copying them again
  - merged declaration references now normalize the evaluated owned value
    directly instead of making one more defensive result copy
  - childless static fallback values with no source location now resolve
    directly; copied fallback/declaration containers now keep an owned surface
    while reusing source-free scalar leaves; source-backed values, defaults,
    and non-leaf nodes still use defensive owned copies. Nested source-free
    reference result containers also use the shared reusable-leaf traversal
    rather than freezing every child leaf
- `packages/core/src/tree/declaration.ts`
  - declaration registration/eval derived wrappers now construct with owned or
    reusable child surfaces instead of shallow-cloning the declaration and then
    replacing individual children, so resolving a declaration no longer
    reparents the source value
  - interpolated declaration names also use the shared reusable-leaf traversal
    for derived wrappers, so source-free scalar replacement leaves are not
    cloned just to own the name container
  - source-backed `!important` flag leaves now use the same reusable-leaf copy
    path as other derived declaration parts instead of calling `clone(true)`
- `packages/core/src/tree/call.ts`
  - non-plain `Call.resolve()` now derives a small owned call surface directly
    instead of reconstructing the whole source `Call`; copied name/arg/content
    containers still reuse childless source-free scalar leaves, and plain
    string CSS calls build their evaluated output directly, copying only
    nested argument containers that need their own eval surface
  - flat render-buffer output for plain CSS calls now renders arguments and
    content through the async render bridge, so async child resolution does not
    force the legacy synchronous source-serialization fallback on that path
  - plain CSS call render paths share the central render print-state prep
    helper, so nested arg/content rendering keeps the active writer/frame/trivia
    state without each call path owning its own state-reset heuristic
  - JS function argument isolation copies only when a local arg-list surface is
    needed; ordinary empty positional JS calls skip the arg-list copy, and
    copied positional/callback arg containers reuse source-free scalar leaves
  - optional fallback call output is now derived directly instead of shallow
    cloning the source call before mutating name/options/args
  - variable-reference callable names that need `preserveRulesLike` now get a
    derived reference wrapper instead of cloning the source reference
- `packages/jess/src/index.ts`
  - `render(...)`, `renderString(...)`, `renderToResult(...)`, and
    `safeRender(...)` all exercise the awaited eval/render path instead of
    requiring callers to compile a whole evaluated tree and serialize it later
  - `safeCompile(...)` remains an explicit compatibility/debug API for callers
    that need a tree surface, but it should not be used as the implementation
    shortcut for normal CSS output
- `packages/core/src/tree/at-rule.ts`
  - at-rule registration/resolve wrappers now construct owned/reusable child
    surfaces directly instead of shallow-cloning and replacing name/body
    children, so source at-rule preludes and rules stay parented to the
    canonical at-rule after prep and `resolve(context)`
  - comment-free header serialization now uses the same owned/reusable copy
    helpers for the local name/prelude print surface, so source-free prelude
    leaves are not cloned just to suppress header trivia
- `packages/core/src/tree/ruleset.ts`
  - ruleset registration/resolve prep now derives the wrapper with an owned
    selector surface instead of shallow-cloning the source ruleset, so source
    selectors stay parented to the canonical ruleset; body rules remain the
    existing registration/eval surface because copying them changes mixin and
    scope behavior
  - ruleset `ownSelector` metadata now uses the shared owned/reusable selector
    copy boundary, so selector-list metadata does not clone inert source-free
    selector leaves during registration prep
  - render-local ruleset header selector visibility forcing uses that same
    owned/reusable boundary, so source-free selector leaves are not cloned just
    to make the print surface visible
  - comment-free header serialization now reuses that same owned/reusable
    selector-copy boundary for its local print surface instead of deep-cloning
    source-free selector leaves just to suppress selector trivia
  - reference-mode selector header filtering also uses the owned/reusable
    selector-copy boundary when it only needs a local print surface; selectors
    that need visibility mutation still keep the defensive deep-copy path
  - the ruleset-specific `copy()` override has been removed; no production
    eval/render caller needed it, so keeping a special ruleset copy surface was
    legacy API polishing rather than normal-flow copy reduction
  - the unused hoisted implicit-ampersand materialization helper has been
    removed instead of modernized, because current header composition no longer
    calls that older deep-copy path
- `packages/core/src/tree/mixin.ts`
  - interpolated-name registration prep now derives an owned wrapper directly
    instead of shallow-cloning the source mixin before replacing the name, so
    source dynamic names, params, guards, and body rules stay canonical
- `packages/core/src/tree/import-style.ts`
  - import-owned child Rules surfaces now reuse the shared derived Rules helper
    instead of shallow-cloning imported source rules, keeping the import
    placement surface explicit without treating clone as isolation machinery
  - compose/import output visibility wrappers now use `Rules.derive()` instead
    of shallow `Rules.clone()`, and first-use import-local wrappers now derive
    the root Rules surface directly while cloning only child output surfaces
    through the shared reusable-leaf helper
- `packages/core/src/tree/ampersand.ts`
  - framed ampersand resolution now constructs the framed wrapper directly
    instead of shallow-cloning the source ampersand just to attach the current
    selector frame
  - appended framed ampersands (`&-foo`) now derive a generated selector
    output surface directly instead of deep-cloning and mutating the frame
    selector; template merge forms still use their existing generated output
    path, and hoist-only ampersands still return the frame selector without
    append mutation
  - implicit selector-list ampersand wrapping now copies the generated `:is()`
    argument through the shared owned/reusable selector boundary, so source-free
    selector leaves are not cloned just to build the wrapper
- `packages/core/src/tree/interpolated.ts` and
  `packages/core/src/tree/selector-interpolated.ts`
  - resolved interpolated wrappers now construct directly when replacement
    values change, and interpolated selector resolve no longer deep-clones the
    source interpolated value before resolving selector output
  - whole-selector interpolation now uses the shared reusable-leaf copy
    boundary when an evaluated replacement is already a selector, so generated
    selector output owns a wrapper without cloning inert source-free selector
    leaves
- `packages/core/src/tree/control.ts`
  - `$for` aggregate/empty output wrappers are now constructed directly instead
    of shallow-cloning the loop body rules and clearing them
  - per-iteration `$for` body rules now use an owned copied body surface because
    they carry the live slot `ScopeFrame`; childless source-free scalar leaves
    inside that copied body are reused so the source body stays canonical without
    cloning inert values, and the owned surface now uses the shared
    reusable-leaf traversal rather than `Rules.clone()`
  - source-free scalar `$for` iteration values bind directly without copy or
    clone; the iteration wrapper remains the ownership surface
- `packages/core/src/tree/sequence.ts`
  - `Sequence.operate('+')` now derives its output sequence directly and copies
    operand children through the shared reusable-leaf traversal, so source
    children keep their canonical parents and childless source-free scalar
    leaves are reused without reconstructing the source sequence
  - changed-value eval/resolve now constructs the derived sequence directly
    instead of cloning the source sequence before replacing its value array
- `packages/core/src/tree/list.ts`
  - `List.operate('+')` now derives its output list directly and uses the same
    reusable-leaf traversal for operand children, so list addition no longer
    reparents source children and still reuses childless source-free scalar
    leaves without reconstructing the source list
- `packages/core/src/tree/operation.ts`
  - preserved operation wrappers now construct the derived operation directly
    from final operands instead of shallow-cloning first, so unchanged source
    operands are not reparented when a resolved sibling keeps the operation
    shape alive
- `packages/core/src/tree/paren.ts`
  - resolved paren wrappers now construct directly from the resolved child
    instead of shallow-cloning first, so resolving a child container no longer
    reparents the source paren value
- `packages/core/src/tree/block.ts`
  - resolved block wrappers now construct directly from the resolved child
    instead of shallow-cloning first, so resolving a block child no longer
    reparents the source block value
- `packages/core/src/tree/quoted.ts`
  - resolved quoted wrappers now construct directly from the resolved value
    instead of shallow-cloning first, so resolving interpolated quoted content
    no longer reparents the source quoted value
- `packages/core/src/tree/selector-attr.ts`
  - resolved attribute selector wrappers now construct with owned/reusable
    unchanged child surfaces instead of shallow-cloning and replacing the
    resolved value, so resolving an attribute selector no longer reparents the
    source value
- `packages/core/src/tree/selector-pseudo.ts`,
  `packages/core/src/tree/selector-list.ts`,
  `packages/core/src/tree/selector-compound.ts`, and
  `packages/core/src/tree/selector-complex.ts`
  - resolved selector wrappers now construct derived selector surfaces with
    owned/reusable unchanged children instead of shallow-cloning wrappers and
    replacing resolved children, so source selector arguments, items, and
    components stay parented to their canonical wrappers after
    `resolve(context)`
  - selector expansion and extend copy sites are intentionally separate from
    this cleanup; they still represent generated selector output, not
    shallow-wrapper replacement
- `packages/core/src/tree/util/serialize-helper.ts`
  - serialization still has text-preview and frame-stack coupling that should
    eventually move to explicit node/output ownership decisions
- `packages/core/src/tree/util/print.ts` and
  `packages/core/src/tree/util/render-buffer.ts`
  - `prepareRenderPrintState(...)` is the shared boundary between fresh
    render traversals and nested render bridges. Keep new render/eval string
    bridges on that helper so they do not fork print-state reset/reuse logic.
  - `renderNodeToString(...)` remains a bridge from contextual resolution to
    existing serializers. It should stay small: if a node has delayed-output
    semantics, add explicit buffer/segment behavior rather than growing a
    second output-tree model in the bridge.
  - Root `Rules` output now routes through the canonical root serializer inside
    the render bridge, so kept root output such as first `@charset`, hoisted CSS
    `@import`, and final newline policy stays owned by `Rules.toString(...)`
    while compile APIs can still await render.
  - The root serializer exception is identity-based on either the resolved root
    surface or the source root node. This covers owned root output surfaces
    produced by `Rules.resolve(context)` without making `toString(...)` part of
    the generic renderable-output contract.
- `packages/fns/src/util/serialize-node.ts`
  - Less function helper serialization now uses `node.render(context)` for
    ordinary node values when a render context exists, keeping function helper
    value rendering on the eval/render path instead of calling source
    serializers directly. `Quoted` and `Any` stay raw because Less string and
    asset helpers consume their literal value forms.
- `packages/fns/src/less/argb.ts`
  - `argb()` now constructs its generated ARGB color directly instead of
    cloning the input color and mutating the clone's `value.node`; the input
    color remains unchanged and no `Color.clone()` call is needed for this
    generated output.
- `packages/fns/src/util/color-output.ts`
  - `rgb(color)` / `rgb(color, alpha)` and `hsl(color)` /
    `hsl(color, alpha)` now share a generated color-output helper instead of
    cloning the input color and mutating its format, node, and alpha fields.
    Focused tests prove the output is a separate color instance and the
    overloads make zero `Color.clone()` calls.
- `packages/fns/src/util/relative-color.ts`
  - Relative-color channel substitution now constructs generated
    `Call`/`Operation`/`List`/`Sequence` wrappers directly instead of cloning
    source expression containers and mutating their children. The source
    channel expression stays canonical while the generated calc expression owns
    the substituted channel values.
- `packages/jess/src/index.ts`
  - `postEvalVisitor` is a compatibility hook name for pre-render visitors:
    compiler tests prove it runs after eval and before serialization, and
    typed visitor objects do not need a generic `visit(...)` method to run.
  - typed `preEvalVisitor` objects are also covered on the public render path:
    a plain `{ varDeclaration(...) { ... } }` visitor can update variables
    before Less variable resolution without using a generic visitor wrapper.
- `packages/core/src/tree/util/selector-utils.ts`
  - implicit selector-list construction now maps generated implicit-ampersand
    items into a fresh `SelectorList` instead of cloning the source selector
    list and replacing children, so source list children stay canonical while
    generated selector output still owns its emitted items
  - implicit ampersand placement copies now use the shared owned/reusable
    selector copy helper, so source-free selector leaves are not cloned just to
    add the generated parent boundary
- `packages/core/src/tree/util/cloning.ts`,
  `packages/core/src/tree/extend.ts`,
  `packages/core/src/tree/util/extend-roots.ts`,
  `packages/core/src/tree/util/extend.ts`,
  `packages/core/src/tree/util/extend-walk.ts`
  - extend-generated selector output now has an owned-root/reusable-children
    copy helper, so flagging `F_EXTENDED` / `F_EXTEND_TARGET` no longer
    deep-clones matched selector items just to mutate flags; this keeps extend
    output ownership explicit while preserving source selector parentage
  - parent-boundary extend composition uses the same helper for generated
    selector-list wrappers and fully-composed `extendWith` selectors, so
    crossing extends do not clone inert source-free leaves just to build output
  - materializing implicit ampersands for extend records now uses the same
    owned/reusable selector boundary, so selector-list leaves are not cloned
    just to build stored extend selectors
  - `Extend` is explicitly marked async-capable now, matching its existing
    async selector-eval branch; sync and async extend record materialization
    share the same owned/reusable selector boundary
  - `walkAndExtend()` selector-list reconstruction now copies processed output
    for placement before creating the generated list, so unchanged source list
    items stay parented to the canonical source list and the old `clone(true)`
    self-parenting guard is gone
  - `extend-walk.ts` is whole-file lint-clean now; keep future generated-output
    cleanup there on typed selector/component helpers instead of reintroducing
    `any` assertions
- `packages/core/src/tree/ampersand.ts`,
  `packages/core/src/tree/util/cloning.ts`, and
  `packages/core/src/tree/util/extend.ts`
  - implicit ampersand extend output now derives ampersand wrappers directly
    instead of cloning the source ampersand, while preserving the live selector
    container required by nested Less output; extend placement copies now route
    through the owned/reusable helper so generated compound/list replacements
    do not adopt source ampersand nodes
  - `createExtendedSelectorList()` now names that placement boundary directly
    (`copySelectorsForPlacement`) and no longer carries the stale second
    `s === inheritFrom ? s.clone(true)` guard; owned placement copies are the
    self-parenting guard for selector-list output
  - legacy full-match extend paths now pass the source selector directly as
    inheritance metadata instead of shallow-cloning it first; generated
    selector-list placement copies remain the adoption boundary
  - complex ampersand boundary replacement now uses the owned/reusable selector
    helper instead of generic `selector.copy()`, clears stale bubbled
    ampersand flags after substitution, and preserves the existing relative
    partial-selector behavior proven by the focused ampersand tests

## Current Todo Shape

Use this as the active checklist for the next narrow batches:

1. Continue eliminating copy/clone from normal eval flow. Start with
   shallow-clone-then-replace patterns that temporarily reparent canonical
   source children.
2. Prefer explicit derived wrappers or lazy runtime state. Use
   `copyWithReusableLeaves(...)` only when a container still proves it needs an
   owned eval/output surface and childless source-free scalar leaves do not need
   copies.
3. Use `prepareRenderPrintState(...)` for render bridges that might run inside
   an active traversal; do not reopen ad hoc writer/frame/trivia reuse checks in
   individual nodes.
4. Keep `packages/jess/test/less/all-less.test.ts` on `renderToResult(...)` so
   the Less fixture baseline exercises eval plus awaited render, not
   compile-plus-`toString(...)` as a parallel whole-tree serialization path.
5. Keep `postEvalVisitor` as a pre-render visitor hook despite the compatibility
   name; visitors should see evaluated nodes before serialization, not final CSS
   strings.
6. Keep semantic wrapper surfaces where they carry real scope, registry,
   import/reference, merge, or output ownership.
7. Audit remaining `clone()` call sites by node shape and prove changes with
   canonical-parent tests before changing them.
8. Record only durable frontier changes here; old recovery details belong in
   git history, not this startup handoff.

Current scan note: outside clone infrastructure and key-set/bitset copies, the
remaining production deep-clone surfaces are explicit and should not be treated
as generic low-hanging fruit:

- `packages/fns/src/less/extract.ts` still returns an owned, trivia-detached
  result surface for the extracted item. That should eventually move to a
  reusable-leaf copy helper or function-result ownership API, but it is not the
  same routine clone-and-mutate pattern removed from color output.
- `packages/core/src/tree/ruleset.ts` no longer has the defensive
  `selector.copy(true)` fallback after the owned/reusable selector helper; the
  helper must return a selector-shaped node or throw.
- `packages/core/src/tree/util/extend.ts` no longer has a deep `.copy(true)`
  generated-output frontier; the final template-combinator placement now uses
  the shared owned/reusable complex-component helper. Complex ampersand
  boundary replacement also no longer calls generic `selector.copy()`. Its
  generated-output helper path is whole-file lint-clean, so follow-up work
  should keep that gate green.

Do not present any of those as completed runtime-eval copy removal until a
focused test proves the specific ownership boundary can move.
Use `pnpm run verify:node-copy-frontier` to refresh the exact deep
copy/clone-style call-site scan before choosing the next seam. That check also
guards against reintroducing ordinary production `.copy()` callers outside the
base node-copy API/infrastructure.

If the next seam is generated selector output, keep the `extend.ts` typed-helper
cleanup intact. The file now passes whole-file ESLint and the deep-copy frontier
scan is clear; future work should audit ordinary `.copy()` calls by ownership
purpose rather than treating every remaining local copy as the same class of
problem.

Recent quality pass note: utility cleanups should stay focused on files whose
whole-file lint debt can actually be paid in the same patch. `Context.getTree()`
now avoids catch/rethrow and no longer hides unsupported-file no-tree results
behind `any`; import evaluation handles that no-tree case explicitly. The
follow-up cleanup kept that scope: `rules.ts` no longer catches only to rethrow
mixin-argument eval failures, import parse-error checks use small `unknown`-safe
helpers, and `use-webpack-resolver.ts` is whole-file lint clean. `bitset.ts`
now keeps the third-party bitset internals behind local guards and preserves
selector-bit library identity without `any` field copying; treat this as a
small utility boundary cleanup, not as selector/extend generated-output work.
`jess-error.ts` now keeps slash-style diagnostic codes in a typed map instead
of a lint-hostile object literal, and its Chevrotain adapter reads parser and
lexer error shapes through local guards instead of `any` assertions. The
follow-up moved diagnostic-code validation and ErrorDiagnostic-to-JessError
conversion into `jess-error.ts`, so `context.ts` and `plugin.ts` no longer carry
their own duplicate code whitelists or throw-conversion blocks. Broader typed
cleanup in legacy high-debt files should be planned as its own batch, not mixed
into node-copy work opportunistically.

## Working Rule

Pick one narrow production seam, prove it with the closest focused test, then
run the smallest broader verification that covers the affected behavior. Do not
add architecture or status documents that mostly describe absent machinery.

Use [HANDOFF.md](./HANDOFF.md) for the current execution checklist.
