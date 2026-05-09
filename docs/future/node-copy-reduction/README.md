# Node Copy Reduction

This folder is the active handoff for reducing routine node copying during eval.
It should stay small enough to read at startup.

## Direction

- Keep one canonical source tree as the default model.
- Prefer lazy per-placement runtime state over routine cloned trees.
- Use shallow wrapper owners only when they carry real local scope, registry, or
  output ownership.
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
  - ruleset-call and ordinary mixin body clones now reuse childless source-free
    scalar leaves through the shared clone helper; the rules containers and
    non-leaf nodes still get owned eval surfaces, while direct comment children
    remain cloned/preserved for each output placement
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
  - non-plain `Call.resolve()` now keeps an owned copied call surface while
    reusing childless source-free scalar leaves; plain string CSS calls build
    their evaluated output directly, copying only nested argument containers
    that need their own eval surface
  - JS function argument isolation copies only when a local arg-list surface is
    needed; ordinary empty positional JS calls skip the arg-list copy, and
    copied positional/callback arg containers reuse source-free scalar leaves
  - optional fallback call output is now derived directly instead of shallow
    cloning the source call before mutating name/options/args
  - variable-reference callable names that need `preserveRulesLike` now get a
    derived reference wrapper instead of cloning the source reference
- `packages/core/src/tree/at-rule.ts`
  - at-rule registration/resolve wrappers now construct owned/reusable child
    surfaces directly instead of shallow-cloning and replacing name/body
    children, so source at-rule preludes and rules stay parented to the
    canonical at-rule after prep and `resolve(context)`
- `packages/core/src/tree/ruleset.ts`
  - ruleset registration/resolve prep now derives the wrapper with an owned
    selector surface instead of shallow-cloning the source ruleset, so source
    selectors stay parented to the canonical ruleset; body rules remain the
    existing registration/eval surface because copying them changes mixin and
    scope behavior
- `packages/core/src/tree/mixin.ts`
  - interpolated-name registration prep now derives an owned wrapper directly
    instead of shallow-cloning the source mixin before replacing the name, so
    source dynamic names, params, guards, and body rules stay canonical
- `packages/core/src/tree/import-style.ts`
  - import-owned child Rules surfaces now reuse the shared derived Rules helper
    instead of shallow-cloning imported source rules, keeping the import
    placement surface explicit without treating clone as isolation machinery
  - compose/import output visibility wrappers now use `Rules.derive()` instead
    of shallow `Rules.clone()`, and first-use import-local deep copies reuse
    childless source-free scalar leaves through the shared clone helper while
    keeping owned container copies and preserving direct comment children
- `packages/core/src/tree/ampersand.ts`
  - framed ampersand resolution now constructs the framed wrapper directly
    instead of shallow-cloning the source ampersand just to attach the current
    selector frame
- `packages/core/src/tree/interpolated.ts` and
  `packages/core/src/tree/selector-interpolated.ts`
  - resolved interpolated wrappers now construct directly when replacement
    values change, and interpolated selector resolve no longer deep-clones the
    source interpolated value before resolving selector output
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
  - `Sequence.operate('+')` now copies both sides through the shared
    reusable-leaf traversal, so source children keep their canonical parents
    and childless source-free scalar leaves are reused
  - changed-value eval/resolve now constructs the derived sequence directly
    instead of cloning the source sequence before replacing its value array
- `packages/core/src/tree/list.ts`
  - `List.operate('+')` now uses the same reusable-leaf traversal for both
    operands, so list addition no longer reparents source children and still
    reuses childless source-free scalar leaves
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

## Current Todo Shape

Use this as the active checklist for the next narrow batches:

1. Continue eliminating shallow-clone-then-replace patterns that temporarily
   reparent canonical source children.
2. Prefer `copyWithReusableLeaves(...)` when a container still needs an owned
   eval/output surface but childless source-free scalar leaves do not need
   copies.
3. Keep semantic wrapper surfaces where they carry real scope, registry,
   import/reference, merge, or output ownership.
4. Audit remaining `clone()` call sites by node shape and prove changes with
   canonical-parent tests before changing them.
5. Record only durable frontier changes here; old recovery details belong in
   git history, not this startup handoff.

Current scan note: outside clone infrastructure and key-set/bitset copies, the
remaining production `clone()` calls are concentrated in selector/extend
generation helpers. Treat those as generated-output work, not as automatic
runtime-eval copy debt.

Recent quality pass note: utility cleanups should stay focused on files whose
whole-file lint debt can actually be paid in the same patch. `Context.getTree()`
now avoids catch/rethrow and no longer hides unsupported-file no-tree results
behind `any`; import evaluation handles that no-tree case explicitly. The
follow-up cleanup kept that scope: `rules.ts` no longer catches only to rethrow
mixin-argument eval failures, import parse-error checks use small `unknown`-safe
helpers, and `use-webpack-resolver.ts` is whole-file lint clean. Broader typed
cleanup in legacy high-debt files should be planned as its own batch, not mixed
into node-copy work opportunistically.

## Working Rule

Pick one narrow production seam, prove it with the closest focused test, then
run the smallest broader verification that covers the affected behavior. Do not
add architecture or status documents that mostly describe absent machinery.

Use [HANDOFF.md](./HANDOFF.md) for the current execution checklist.
