# Mixin Direct Invocation — Next Pass Plan

## Primitive Checklist

These are the production primitives we are using to break `getFunctionFromMixins()`
into direct, testable seams. This checklist is the source of truth for which
pieces are actually extracted versus still trapped in the monolith.

### Completed

- `bindMixinParamValue(...)`
- `attachMixinBodyToParamScope(...)`
- `createMixinParamScope(...)`
- `populateMixinParamScope(...)`
- `defineMixinArgumentsInScope(...)`
- `seedMixinGuardScope(...)`
- `prepareMixinInvocationScope(...)`
- `withMixinLookupScope(...)`
- `Context.lookupScope`
  - canonical body eval can resolve through the prepared invocation scope
- `finalizeMixinInvocationOutput(...)`
  - returned mixin output can be turned into a portable concrete result without
    cloning the body first
- `projectMixinParamScopeIntoOutput(...)`
  - bound param vars and rest vars are projected into the returned output shape
    explicitly, instead of being hidden inside the old wrapper/body clone flow
- `classifyMixinDefaultGroup(...)`
- `resolveWinningMixinDefaultGroups(...)`
  - default() disambiguation no longer has to live inline inside the candidate loop
- `normalizeMixinInvocationParams(...)`
  - rest-param conversion and auto-generated rest names no longer live inline
    in the candidate loop
- `prepareMixinCandidateInvocation(...)`
  - the normal candidate path now has one helper for instance-root wiring,
    visibility patching, parent/source wiring, param normalization, and lookup
    scope construction
- `evaluateMixinGuardCandidate(...)`
  - reset-session guard probing and default-group resolution now live outside
    the candidate loop
- `replayWinningMixinDefaultCandidates(...)`
  - pending `default()` replay now lives outside the candidate loop too, with
    the correct lookup scope re-established per winning candidate
- `assembleMixinInvocationOutput(...)`
  - final mixin output ordering, single-rule passthrough, and multi-rule wrapper
    assembly now live outside the candidate loop

### Remaining

- direct canonical-body evaluation of the full parameterized mixin suite through
  the extracted primitives
- lazy nested lookup behavior for returned mixin-defined scopes
- collapse of the remaining `getFunctionFromMixins()` body into small production
  helpers, then removal of the monolith itself

## Why This Matters For Performance

Every mixin call currently deep-clones the body — creating a full copy of the AST subtree per call. For a mixin called 100 times, that's 100 cloned trees. JIT engines (V8, JSC) are most slowed down by object creation: allocation pressure, GC pauses, and cache misses from scattered heap objects.

With instance roots: 1 canonical body + 100 thin shadow maps. Shadow entries are flat `Map<Node, ShadowEntry>` lookups, not tree copies. Only nodes that actually diverge from the canonical get entries.

The arg handling also creates unnecessary objects: clone → freeze → spread → re-collect. Direct invocation evaluates args once and binds them via shadow patches.

## What This Replaces

Currently, `Call` → mixin goes through 8 abstraction layers:

1. `Call.evalNode` resolves name → finds Mixin/Ruleset/array
2. `getFunctionFromMixins()` wraps candidates in a generic JS `returnFunc`
3. `Call.evalNode` extracts the function, calls `callWithContext()`
4. `callWithContext()` normalizes args and invokes `returnFunc.call(context, ...args)`
5. `returnFunc` collects/clones/freezes args → `nodeArgs: Node[]`
6. `returnFunc` matches `nodeArgs` to candidate params, binds via `param.setData('value', ...)`
7. For each match, clones mixin body, creates eval scope, evaluates
8. Wraps output Rules, sorts, returns

The function-wrapper layer (steps 2–4) exists so that mixin calls and JS function calls share the same dispatch. But mixin calls don't need that indirection — they're AST operations, not JS function calls.

## What The Next Pass Should Do

Combine two changes into one refactor:

### A. Remove the function wrapper abstraction

Call should invoke mixins directly without creating a JS function. The parameter binding, candidate matching, and body evaluation should happen inline in a new `Call.evalMixinCall()` method (or similar) rather than through `getFunctionFromMixins()` → `callWithContext()` → `returnFunc()`.

### B. Replace body cloning with instance root shadowing

Instead of cloning the mixin body per call, use instance roots:

1. Keep the canonical mixin body as-is (no clone)
2. Create an instance root per call
3. Bind params into the instance root's shadow state
4. Evaluate the canonical body with the instance root active
5. Materialize output at the call boundary

## Current Flow (detailed)

```
Call.evalNode (call.ts:398-399)
  ↓ getFunctionFromMixins(mixin) → returnFunc (rules.ts:2106-3015)
  ↓ cast(returnFunc) → n
Call.evalNode (call.ts:464-474)
  ↓ callWithContext(context, fn, ...args.value) (define-function.ts:313-334)
    ↓ returnFunc.call(context, ...args)
      ↓ collect/clone/freeze args → nodeArgs (rules.ts:2154-2209)
      ↓ match candidates: param count, named/positional/pattern (rules.ts:2251-2407)
      ↓ for each matched candidate:
        ↓ clone body rules (rules.ts:2644, 2679, 2693)
        ↓ create param wrapper (outerRules), push params (rules.ts:2730-2813)
        ↓ evaluate guard if any (rules.ts:2816-2904)
        ↓ evaluateCandidateOutput:
          ↓ clone outerRules, push body children (rules.ts:2564-2582)
          ↓ eval scope (rules.ts:2583)
          ↓ set sourceParent/parent in session (rules.ts:2585-2586)
          ↓ push to outputRules
      ↓ sort outputRules, wrap in Rules, return (rules.ts:2954-3012)
```

## Target Flow

```
Call.evalNode (call.ts)
  ↓ resolves name → Mixin/Ruleset/array
  ↓ Call.evalMixinCall(candidates, args, context)
    ↓ evaluate args once (no clone/freeze, just eval)
    ↓ for each candidate:
      ↓ match params (named/positional/pattern) — same logic, simpler plumbing
      ↓ create instance root for canonical body
      ↓ bind params into instance root shadow (not param.setData)
      ↓ evaluate guard against instance root if needed
      ↓ if passes:
        ↓ evaluate canonical body with instance root active
        ↓ associate instance root with output (no materialization)
        ↓ push to outputRules
    ↓ sort, wrap, return
```

## Key Differences

| Aspect | Current | Target |
|--------|---------|--------|
| Function wrapper | `getFunctionFromMixins()` returns JS function | Direct method on Call or inline |
| Dispatch | `callWithContext()` normalizes and invokes | Direct invocation |
| Arg handling | Clone → freeze → spread → re-collect | Evaluate once, pass directly |
| Body isolation | Clone mixin body per call | Instance root shadow per call |
| Param binding | `param.setData('value', boundValue)` | Instance root shadow entry |
| Output | Cloned Rules with session parent chains | Canonical body + associated instance root |

## What To Keep

- Candidate matching logic (param count, named/positional, pattern matching, rest params)
- Guard evaluation semantics
- Default guard disambiguation (`DEF_TRUE` / `DEF_FALSE` / `DEF_NONE`)
- Output sorting by candidate order
- `isMixinOutput` visibility semantics
- `@arguments` variable construction

## What To Remove

- `getFunctionFromMixins()` function (the returned `returnFunc` closure)
- `callWithContext()` dispatch for mixin calls (keep for JS function calls)
- Arg clone/freeze/spread cycle
- Body `rules.clone(true, undefined, thisContext)` calls
- `outerRules` clone-and-push pattern (replaced by instance root param binding)

## Param Binding via Instance Root

Currently params are bound by mutating `VarDeclaration.setData('value', boundValue)` on the cloned param nodes. With instance roots:

```ts
// Instead of:
param.setData('value', boundValue);

// Do:
instanceRoot.patchField(param, 'value', boundValue);
```

The session helpers already resolve through instance root first, so `sessionGetField(param, 'value', ctx)` will return the bound value when the instance root is active.

## Guard Evaluation

Guards currently eval in a fresh `EvalSession({ resetEvalState: true })`. With instance roots, the guard can eval against the same instance root that has the param bindings, using a nested session for reset-state:

```ts
const guardSession = new EvalSession({ resetEvalState: true });
const prevSession = ctx.session;
ctx.session = guardSession;
// ctx.instanceRoot stays pointing to the call's instance root
// so guard can see bound params via instance root shadow
const guardResult = await guard.eval(ctx);
ctx.session = prevSession;
```

## Output: Instance Root Association, Not Materialization

The mixin call should NOT materialize at the call boundary — that would just replace `clone()` with `materialize()` for the same cost.

Instead, the canonical body + its instance root survive as a pair. The instance root stays alive as long as the output is reachable. When the caller inserts the output into its scope, reads through session helpers resolve the right shadow state.

The cleanest approach: output nodes carry a reference to their instance root:

```ts
// After eval, associate the instance root with the output
output._instanceRoot = instanceRoot;
```

When session helpers read from this node and `ctx.instanceRoot` isn't set, they check `node._instanceRoot` as an implicit fallback:

```ts
function sessionGetField(node, key, ctx) {
  const ir = ctx.instanceRoot ?? (node as any)._instanceRoot;
  if (ir && ir.hasField(node, key)) {
    return ir.getField(node, key);
  }
  // ... session fallback, then canonical
}
```

This means:
- No materialization cost at the call boundary
- Each mixin call's output "remembers" its instance root
- Multiple outputs from different calls resolve independently
- The public node API stays unchanged (no explicit instance parameter)

Materialization only happens at the final CSS output boundary — when Jess serializes the evaluated tree to a string or standalone object graph that outlives the session.

## Risk Areas

1. **Registry population**: The current flow registers declarations/mixins from cloned Rules. Instance-root-backed eval needs registry entries from the canonical body + shadow state.
2. **Parent chain walking**: Lookup walks parent chains. Under instance roots, parents are in shadow state, so `sessionGetParent` must be used consistently.
3. **Source provenance**: `sourceNode` / `sourceParent` chains are used for diagnostics and deduplication. These need to work correctly under instance roots.
4. **Nested mixin calls**: A mixin calling another mixin creates nested instance roots. The nesting needs to compose correctly.

## Experimental Findings (2026-03-25)

### Infrastructure landed (stable, committed)

- `_setChildAt` / `_setChildren` route through `ctx.instanceRoot` children overlay
- `adopt()` routes through `ctx.instanceRoot`
- `_isEvaluated` / `_setEvaluated` / `_isPreEvaluated` / `_setPreEvaluated` check instance roots
- `node._instanceRoot` with `resolveInstanceRoot` in all session helpers
- `evalMixinDirect` for direct dispatch (bypasses function wrapper)
- Instance roots associated with mixin output

### What was tried and why it fails

**Attempt 1**: `cloneLookupSafeShallowWrapper` for mixin body → 3 regressions because eval writes values onto shared children (at-rule media values leak between calls).

**Attempt 2**: `cloneLookupSafeShallowWrapper` + IR-aware `_setChildAt` → infinite loop because `push()`, `splice()`, `unshift()` and the Rules constructor all access `this.value` directly, bypassing IR.

**Attempt 3**: IR-aware `_setChildAt` + IR-aware `push()` → still hangs because the Rules constructor at line 487 calls `this.adopt(child)` on ALL passed children, setting their `.parent` to the new clone and corrupting canonical parent chains.

**Attempt 5**: Rules constructor accepts `Context | TreeContext`, `clone(false)` passes Context → 7 regressions because canonical `.parent` becomes undefined when adoption goes through IR, and some eval/lookup code still reads `node.parent` directly instead of `sessionGetParent(node, ctx)`. The fix: audit all canonical `.parent` reads and convert to session helpers.

**Attempt 4**: `clone(false)` for mixin body → hangs for the same reason (constructor adopts all children).

### Root cause

`Rules.clone(false)` and `Rules.constructor` always call `this.adopt(child)` on every child in the value array. This sets `child.parent = newRules` unconditionally. When children are shared with the canonical tree, this corrupts canonical parent chains.

### The fix needed

A new clone mode that:
1. Creates a fresh Rules with a COPY of the value array (`[...this.value]`)
2. Does NOT adopt children (leaves their `.parent` unchanged)
3. Uses session/IR to set the clone as the parent in the overlay
4. Skips registry population (registries will be populated lazily during eval)

This is essentially a `Rules.createShallowBodyWrapper(ctx)` method — similar to `cloneLookupSafeShallowWrapper` but it copies the children array (O(N) for the array, not O(N²) for deep tree clone) and doesn't re-adopt.

## Entry Points for Implementation

1. ✅ Extract dispatch to `evalMixinDirect` (done)
2. Create `Rules.createShallowBodyWrapper(ctx)` that copies value array without adopting
3. Replace `rules.clone(true, undefined, thisContext)` with `createShallowBodyWrapper`
4. **Audit canonical `.parent` reads**: Find all places in the eval pipeline that read `node.parent` directly instead of `sessionGetParent(node, ctx)`. Convert them to use session helpers. This is the prerequisite for IR-aware adoption — when `clone(false)` passes Context to the constructor, `adopt()` routes through IR, leaving canonical `.parent` undefined. Any code reading canonical `.parent` will break. (7 regressions found when tested globally.)
5. **Enable `clone(false, undefined, ctx)` to pass Context to constructor**: Change `ctx ?? this.treeContext` in clone — then shallow clone automatically gets IR-aware adoption.
6. Set `ctx.instanceRoot` during eval, restore after
7. Replace param `setData` with instance root `patchField`
8. Remove the `getFunctionFromMixins` wrapper (inline into `evalMixinDirect`)
9. Update `callWithContext` to only handle JS function calls
