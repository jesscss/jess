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

The remaining work is production conversion, not old model preservation.

- `packages/core/src/tree/rules.ts`
  - guarded mixin dispatch now has local candidate accessors; those accessors
    are the next place to replace raw candidate field reads when an explicit
    ownership surface exists
  - guarded mixin dispatch still has ambient scope plumbing
  - param/rest/`@arguments` binding still uses frozen deep copies in places;
    already-evaluated or static childless scalar values with no source location
    now bind directly
  - resolving live-slot values now also reuses those source-free scalar leaves,
    including children of copied source-free `@arguments`/rest containers; the
    containers themselves still keep an owned copy surface
  - static guards are proven copy-free; dynamic guards still use a copied eval
    surface, and default-guard probing now reuses that copied guard for both
    `default()` states
  - ruleset-call and ordinary mixin body clones now reuse childless source-free
    scalar leaves through the shared clone helper; the rules containers and
    non-leaf nodes still get owned eval surfaces
  - detached-ruleset unlock is covered by a regression test proving it does not
    deep-clone body leaves before evaluating the unlocked surface
  - derived empty mixin wrapper surfaces are now constructed directly instead
    of shallow-cloning non-empty body rules and clearing them
  - post-eval merged declaration coalescing now keeps its accumulated value map
    as a read-only snapshot surface and lets merge composition own the copy
    boundary, instead of recopying every stored/list-flattened value leaf
- `packages/core/src/tree/reference.ts`
  - `preserveRulesLike` variable references now keep a shallow owned wrapper
    instead of deep-copying the referenced rules-like body
  - merged declaration reference flattening now reuses the already-copied
    leaves instead of copying them again
  - merged declaration references now normalize the evaluated owned value
    directly instead of making one more defensive result copy
  - childless static fallback values with no source location now resolve
    directly; source-backed values, defaults, containers, ordinary reference
    results, and declaration value evaluation still use defensive deep copies
- `packages/core/src/tree/call.ts`
  - `Call.resolve()` still deep-clones before eval for non-plain calls; plain
    string CSS calls now build their evaluated output directly, copying only
    nested argument containers that need their own eval surface
  - JS function argument isolation still uses frozen deep copies for non-empty
    positional args and callbacks that receive the arg `List`; ordinary empty
    positional JS calls skip the arg-list copy
- `packages/core/src/tree/control.ts`
  - `$for` aggregate/empty output wrappers are now constructed directly instead
    of shallow-cloning the loop body rules and clearing them
  - per-iteration `$for` body rules still use the existing shallow wrapper path
    because they carry the live slot `ScopeFrame`
- `packages/core/src/tree/util/serialize-helper.ts`
  - serialization still has text-preview and frame-stack coupling that should
    eventually move to explicit node/output ownership decisions

## Working Rule

Pick one narrow production seam, prove it with the closest focused test, then
run the smallest broader verification that covers the affected behavior. Do not
add architecture or status documents that mostly describe absent machinery.

Use [HANDOFF.md](./HANDOFF.md) for the current execution checklist.
