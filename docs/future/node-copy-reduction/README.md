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
  - param/rest/`@arguments` binding still uses frozen deep copies in places
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
  - ordinary reference result and declaration value evaluation still use
    defensive deep copies
- `packages/core/src/tree/call.ts`
  - `Call.resolve()` still deep-clones before eval for non-plain calls; plain
    string CSS calls now build their evaluated output directly, copying only
    nested argument containers that need their own eval surface
  - JS function argument isolation still uses frozen deep copies for non-empty
    positional args and callbacks that receive the arg `List`; ordinary empty
    positional JS calls skip the arg-list copy
- `packages/core/src/tree/util/serialize-helper.ts`
  - serialization still has text-preview and frame-stack coupling that should
    eventually move to explicit node/output ownership decisions

## Working Rule

Pick one narrow production seam, prove it with the closest focused test, then
run the smallest broader verification that covers the affected behavior. Do not
add architecture or status documents that mostly describe absent machinery.

Use [HANDOFF.md](./HANDOFF.md) for the current execution checklist.
