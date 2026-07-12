# Eval Forking: Eliminating Deep Cloning

## Problem

Currently, when a mixin is called or a `$for` loop iterates, we **deep-clone** the entire subtree of rules. This is expensive:
- Object creation for every node in the tree
- Recursive walks to clone children
- A `resetEvalStateDeep` function that walks the cloned tree AGAIN to clear `preEvaluated`/`evaluated` flags
- Special-case logic to recover definition-time selectors and clear stale Ampersand state

Deep cloning exists because evaluation is destructive — `evalNode` mutates the node's value in place, and `preEvaluated`/`evaluated` flags prevent re-evaluation. If a mixin body needs to be evaluated multiple times (multiple calls, or loop iterations), we clone to get a "fresh" copy.

## Solution: Copy-on-Write Value Forking

Instead of cloning entire subtrees, we use a **copy-on-write** system where nodes fork their values lazily on first write. The original (canonical) value is always preserved.

### Core Mechanism

Each node has:
- `value` — the currently active value (read via property access, fast path)
- `_renderKey` — which render context this node's `value` belongs to
- `_childForks` — `Map<RenderKey, NodeValue>` storing alternate value versions
- `_parentForks` — `Map<RenderKey, Node>` storing alternate parent relationships

**Two key principles:**

1. **Fork lazily.** Don't pre-fork values. Only create a fork entry when a node's value actually changes during evaluation. Past efforts forked eagerly, which was slow.

2. **Choose forks sparingly.** The hot path is: if the node's `_renderKey` matches the requested renderKey, OR the node is still canonical (`_renderKey` is undefined), read `.value` directly — zero overhead. The fork map is only consulted when a node has been forked AND the requested renderKey differs from the current one, which is rare in practice since most nodes are never mutated during eval.

**Reading a value:**
```
if (!node._renderKey || node._renderKey === myRenderKey)
  → read node.value directly (hot path, zero overhead)
else
  → look up in node._childForks (cold path, rare)
```

A canonical node (`_renderKey` undefined) is always valid for ANY render context — it means no evaluation pass ever replaced this node's value, so the original is universally correct. This is the common case: most nodes in a tree pass through evaluation unchanged.

**Writing a value (via `set()`):**
1. First write for a given renderKey: shallow-clone the current value, store the original under `CANONICAL` (or the current renderKey), store the new value under the new renderKey
2. Subsequent writes for the same renderKey: update in place
3. The `value` property always reflects the most recently active renderKey

**Parent tracking:**
When a node is adopted into a new parent under a different renderKey, `_parentForks` records the mapping. `getParent(renderKey)` retrieves the correct parent for a given context.

### Render Keys

```typescript
type RenderKey = number | typeof EVAL | typeof CANONICAL;
```

- `CANONICAL` — the original, pre-evaluation value. Always preserved.
- `EVAL` — the default evaluation context (single eval pass).
- Numeric keys — for multiple evaluation passes (e.g., loop iterations, multiple mixin calls). Each iteration gets a unique numeric renderKey.

### How It Replaces Deep Cloning

**Before (deep clone):**
```
for each iteration:
  rules = originalRules.clone(true)     // deep clone entire subtree
  resetEvalStateDeep(rules)             // walk tree again to clear flags
  rules = await rules.eval(context)     // evaluate the fresh copy
```

**After (forking):**
```
for each iteration:
  rules = shallowClone(originalRules)   // clone just the Rules container
  rules._renderKey = nextRenderKey++    // assign unique renderKey
  context.renderKeyStack.push(renderKey)
  rules = await rules.eval(context)     // evaluation forks values on write
  context.renderKeyStack.pop()
```

During evaluation, when a node's value needs to change (e.g., a Reference resolves to a value), `set()` is called with the current renderKey. This:
1. Preserves the canonical value in `_childForks`
2. Stores the new value under the current renderKey
3. Updates `_renderKey` so subsequent reads are fast

Nodes that DON'T change during evaluation (most of them) never fork — they just keep their canonical value. This is the key efficiency win: only nodes that actually differ between iterations pay the cost.

### Context Integration

The `Context` maintains a `renderKeyStack` that tracks the current evaluation context:
- Push a new renderKey when entering a mixin call or loop iteration
- Pop when exiting
- `context.renderKey` returns the top of the stack

`set()` defaults to `context.renderKey` (or `EVAL` if none). Registry lookups and `toTrimmedString()` use the same save/restore pattern as existing frame stacks (rulesContext, calcFrames, etc.).

### What Gets Eliminated

- `resetEvalStateDeep` — no longer needed; canonical nodes retain original eval state
- Deep cloning in mixin evaluation (`rules.clone(true)` in evalCall)
- Deep cloning in `$for` loop iterations
- The `preEvaluated`/`evaluated` flag dance on cloned nodes
- Special-case selector/Ampersand recovery in `resetEvalStateDeep`

### Registry Considerations

When climbing parent chains during registry lookups (`DeclarationRegistry.find`, etc.), we need to use `getParent(renderKey)` instead of `.parent` to follow the correct fork path. Similarly, when searching child Rules, we may need to check `getValue(renderKey)` to get the correct children.

If a forked Rules node needs new registry entries (e.g., a mixin call adds declarations to scope), we create a shallow clone of that specific Rules node — not the entire subtree. This should be rare.

### Implementation Order

1. ~~evalStatic needsReeval~~ — DONE: canonical nodes re-evaluate when renderKey active
2. ~~Registry parent walks~~ — DONE: use getParent(renderKey) in DeclarationRegistry, MixinRegistry, FunctionRegistry
3. ~~Reference.ts FindOptions~~ — DONE: pass context.renderKey into FindOptions
4. ~~Declaration.evalNode uses set()~~ — DONE: uses `set('value', ...)` and `set('important', ...)` with context.renderKey
5. ~~forEachNode renderKey-aware~~ — DONE: uses `set()` when renderKey active, preserves canonical
6. ~~$for loop~~ — DONE (with stopgap): uses wrapper Rules per iteration, eval forking works, but output nodes use `copy()` to snapshot fork state. The `copy()` needs to be replaced by renderKey-aware serialization.
7. **RenderKey-aware serialization** — The missing piece. `PrintOptions.renderKey` exists but isn't wired through. Nodes that read `this.value` during serialization need to use `this.getValue(options.renderKey)` instead. Key sites:
   - `Declaration.declTrimmedString` line 95: `const { name, value, important } = this.value` → `this.getValue(options.renderKey)`
   - `serialize-helper.ts`: need to trace how it iterates Rules children and passes options
   - Rules.toString: propagate `_renderKey` into `options.renderKey` so children inherit it
   - Base node `toTrimmedString` uses `_visitValues(this.value)` — needs to read from getValue
   - **Important**: don't mutate `this.value` during serialization — just use the return value of `getValue()`
8. **After serialization is renderKey-aware**: remove `copy()` from $for output collection
9. **Mixin calls** — same pattern as $for, more complex due to param binding
10. **set() EVAL default — root cause found**

    When `set()` defaults to EVAL, calling `set('selector', evaledSelector)` on a Ruleset during `evalNode` changes `this._renderKey` to EVAL and stores the eval'd selector. The problem: `_multiPassPreEval` on the PARENT Rules registers child Rulesets by reading `child.value.selector`. With the fork, `child.value` returns the EVAL fork (the eval'd selector, which has `:is()` wrappers from `getImplicitSelector`). This selector has DIFFERENT keySet keys (e.g., `.do` from the `:is(.do .re .mi .fa)` prefix). The registration overwrites or conflicts with the correct local key registration.

    **Trace**:
    - `.sol .la` Ruleset calls `set('selector', complexSel, EVAL)` → `_renderKey = EVAL`
    - Parent Rules' `_multiPassPreEval` processes `.sol .la` as a child
    - `_registerNodeIfEligible` reads `.sol .la`'s `value.selector` → gets EVAL fork selector (with `:is(.do...)`)
    - Registers `.do` key in inner Rules' mixin registry (should be `.si`)
    - Mixin lookup for `.si` finds `.do` instead → "No matching mixins found"

    **Why direct mutation works**: With `this.value.selector = evaledSelector`, `_renderKey` stays undefined. `_multiPassPreEval` still reads the eval'd selector, but the registration timing is different — `_indexRules` ran BEFORE the selector was updated, so it indexed the pre-eval selector keys. With `set()`, the fork path runs `_processNodes → adopt()` which triggers re-indexing.

    **Refined finding**: The issue is DOUBLE REGISTRATION. Rulesets are registered once during preEval (correct — uses the preEval'd selector with proper `:is()` wrapping) and again during evalNode when `_indexRules` re-fires on a cloned Rules (clones have `rulesIndexed = 0`). The second registration reads the EVAL-forked selector which has a different form (flat complex vs `:is()`-wrapped), producing different start keys that overwrite the correct preEval registration.

    With direct mutation (`_renderKey` stays undefined), the second registration still happens but uses the same selector object — same keys — so the overwrite is harmless. With EVAL fork, `_renderKey = EVAL` causes `value.selector` to return the EVAL fork selector (different form) → different keys → broken lookup.

    **Invariant**: A node can only produce one eval state per renderKey. If re-eval'd under the same key, it should skip (not create a duplicate or replacement registration).

    **Deeper finding**: The double registration is not the root cause — it's a symptom. The real issue:
    - `pendingItems` holds raw node references. `indexPendingItems` reads `node.value.selector` lazily.
    - Between add-to-pending (preEval) and index-from-pending (lazy during search), `set('selector', ..., EVAL)` in evalNode forks the Ruleset value. The fork includes `_processNodes → adopt()` which changes the selector's parent chain.
    - The selector's `valueOf()` or initial `computeKeySets()` may produce different results with the new parent (e.g., flat `.do .re .mi .fa .sol .la .si` vs `:is()`-wrapped form), producing different start keys.
    - The `.si` key gets overwritten by `.do` in the mixin registry index.

    **Resolution: Remove getImplicitSelector from preEval entirely**

    The root cause is that `getImplicitSelector` mutates every nested selector during preEval, wrapping with `:is()` and parent context. This is:
    - Expensive: runs on ALL selectors whether extended or not
    - A mutation: conflicts with forking (the selector form changes, producing different registry keys)
    - Premature: only needed for extend matching and hoistToRoot serialization

    Instead:
    - Keep selectors as-authored during preEval (no mutation, no forking needed)
    - During extend matching: pass parent selector as context, compute implicit form on the fly
    - During serialization with hoistToRoot: compute full selector at render time
    - Cache computed forms in WeakMaps, scoped to the extend pass

    This eliminates:
    - The `set('selector')` fork issue entirely (selector isn't mutated)
    - The `_processNodes/adopt()` parent chain problem
    - The double-registration / key-overwrite problem
    - The global cost of getImplicitSelector on all selectors

    **Performance principle**: Extend is a feature used on a small subset of selectors. Its cost must be proportional to the number of extended selectors, not the total selectors in the stylesheet.

    **BitSet integration**: Parent bitsets are OR'd in lazily during the extend pass (not globally upfront). Registry uses as-authored selector keys (stable, immutable). BitSets computed once from canonical selectors, never invalidated.

    **Failure analysis from disabling getImplicitSelector** (35 test failures across 4 categories):
    1. **Nesting collapse (10 tests)**: serialization with `hoistToRoot` needs composed form. Files: `nesting-collapse.test.ts`. Fix: compute in `getHeaderString` at render time.
    2. **Extend (16 tests)**: extend matching reads `value.selector` for composed form. Files: `extend-eval-integration.test.ts`, `extend-import-style.test.ts`, `extend-less-fixtures.test.ts`, `extend-serialized-target.test.ts`. Fix: pass parent selector as context parameter to extend matching.
    3. **Mixin (6 tests)**: compound mixin lookups and nested recursion detection. Files: `mixin.test.ts` (1), `mixin-recursion.test.ts` (5). Fix: registry uses local selector keys, recursion detection uses local selector.
    4. **Other (3 tests)**: at-rule serialization (1), ampersand resolution (1). Fix: compute composed form on-demand in serialization / ampersand eval.
11. **RenderRoot parent renderKey tracking** — When a lookup climbs past a renderRoot boundary (e.g., exiting a $for iteration's scope), it needs to restore to the parent's renderKey. RenderRoots should store the parentRenderKey that was active when they were created.
11. **Selector bitsets from jess-dev** — Replace keySet (Set<string>) with BitSet for O(1) extend rejection. jess-dev has `BitSetLibrary<string>` on Context, `getKeySet(context)` on selectors, `requiredKeySet` excluding OR paths. Pull this in when retooling keySet computation for renderKey awareness. Source: `/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/util/bitset.ts` and `selector.ts`.
    - **Key insight**: jess-dev has invalidation machinery for bitsets because selectors get mutated. With the forking system, canonical selectors are IMMUTABLE — bitsets computed from canonical state never need invalidation. Compute once at registration, use forever. For extends: OR the new selector's bits into the target. No recomputation, no renderKey awareness needed for bitsets — they're derived from canonical (immutable) state.
12. **Extend matching with parent context** — Core extend rework needed:
    - Pass parent selector into extend matching (don't create composed selectors)
    - Match implicitly: decompose extend target, match suffix against local selector, match prefix against parent chain
    - Matching the parent prefix = crossing the `&` boundary
    - Precompute effective bitset per Ruleset: own keyBits OR parent keyBits (computed lazily, cached)
    - Fast-reject with bitset: if `isSubsetOf(instruction.requiredBits, target.effectiveBits)` is false, skip
    - Compute selector metadata ONCE per Ruleset, not per instruction (precompute for all targets)
    - When extend adds a selector: mutate the effective bitset with `bits.or(newSelectorBits)` — O(1), no recomputation
    - Extend root loop should skip entire Rulesets when effective bitset has zero overlap with ALL instructions' bits
13. **RenderKey-aware extend** — How forking interacts with the extend system:
    - Extend runs AFTER eval. With forking ($for, mixin calls), the same Ruleset may have different selectors under different renderKeys.
    - The extend system operates on the EVAL renderKey (normal single-pass eval). Forked iterations produce output Rules with their own renderKeys — extend doesn't apply to those (they're already resolved).
    - For the bitset cache: the effective bitset is computed from the EVAL-state selector (the one that's actually in the output). Forked states have their own selectors but those are in iteration-scoped output, not in the extend target set.
    - Key invariant: extend targets come from preEval registration (which happens once, under EVAL). The extend matching reads EVAL-state selectors. Forked iterations don't add new extend targets — they produce resolved output.
    - The composedSelectorStack (serialization) is per-render. Extend is a separate pass that runs before serialization. Extend modifies the EVAL-state tree (adds selectors to Rulesets). Serialization then renders the modified tree with compose-on-demand.
    - `set()` defaulting to EVAL: once extend and selector composition work without `getImplicitSelector`, the EVAL fork preserves canonical selectors. Extend reads EVAL-state selectors. `set('selector', ...)` in evalNode forks correctly because the selector IS the preEval'd local form (no `:is()` wrapping to differ between forks).
14. **Remove `resetEvalStateDeep`** — once all deep-clone sites are converted

## Current Status

### What works (getImplicitSelector removed):
- **Nesting collapse**: 12/13 tests pass. On-demand composition via composedSelectorStack.
  - Last failure: wrapper `& { }` from at-rule bubbling shares frame cache with outer parent
- **Ampersand**: 12/14 tests pass. Deferred `&` resolution via composedSelectorStack + ampersandFirst flag.
  - Remaining: SelectorList `:is()` wrapping edge case, selector ordering
- **Deferred `&` eval**: Ampersand.evalNode no longer eagerly resolves when collapseNesting. Only resolves for appendValue and explicit hoistToRoot.
- **Serialization**: getHeaderString composes from stack, Ampersand.toTrimmedString resolves from stack, ComplexSelector/CompoundSelector set ampersandFirst position flag.
- **Cruft removed**: deferredExpandedChildren (74 lines), string-based selector comparison hack

### What's broken:
- **Extend**: 18 tests. Needs implicit parent matching (prefix/suffix decomposition against parent chain).
- **Mixin**: 6 tests. Compound selector lookup + recursion detection need local selector keys.
- **At-rule**: 1 test. Media.less AST serialization.
- **Process-leading-is**: 1 test.

### Dependency chain to completion:
1. Fix last nesting-collapse test (wrapper frame caching)
2. Extend implicit matching with parent context + bitset fast-rejection + O(1) bitset mutation
3. Fix mixin registry for local selector keys
4. `set()` defaults to EVAL (now safe — no selector form divergence)
5. Convert Ruleset/AtRule eval mutations to `set()`
6. Mixin call forking
7. Remove `resetEvalStateDeep`

### Performance Constraints

V8-specific performance is the #1 concern:
- Never add overhead to the common (non-forking) path
- The `evaluated` short-circuit must remain free for normal eval
- Avoid creating Maps/objects/closures unless a fork actually happens
- Prefer inline property checks over method calls on hot paths
