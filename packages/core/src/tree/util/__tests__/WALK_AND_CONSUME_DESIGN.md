# Walk-and-Consume Algorithm Design

## Current Architecture (3-Phase Pipeline)

The current extend pipeline has three separate traversal phases:

1. **Search**: `findExtendableLocations(target, find)` → walks the AST, collects `ExtendLocation[]`
2. **Classify**: `selectorCompare(target, find)` → another traversal to determine match type
3. **Apply**: `extendSelector(target, find, extendWith, partial)` → uses locations to decide
   what transformation to apply, then constructs new AST nodes

### Where the Time Goes

| Hotspot | Cause | Status |
|---------|-------|--------|
| `applyExtendsToSelector` growing list | O(N²) for N same-target instructions | **Fixed** (batched) |
| `selectorCompare` SelectorList sort | O(N log N) per comparison | **Fixed** (Set-based) |
| `areCompoundSelectorsEquivalent` expansion | (N+1)^K combinatorial explosion | **Fixed** (pointer walk) |
| `processExtends` per-instruction diagnostics | O(I) × cost_per_extend per ruleset | **Not fixed** |
| Triple traversal per extend call | search + classify + apply | **Not fixed** |

## Walk-and-Consume Design

### Core Idea

Replace the 3-phase pipeline with a single recursive descent that:
1. Walks the target selector tree (depth-first)
2. At each node, checks if it matches `find`
3. If it matches, **immediately transforms** it (wrap in `:is()`, add to list, etc.)
4. Returns the transformed (or original) node

### Context Threading

The transformation depends on context. The walker carries a `WalkContext`:

```typescript
interface WalkContext {
  /** Are we at the top-level selector (not inside a compound/complex/pseudo)? */
  isRoot: boolean;
  /** Parent node type */
  parentType: 'SelectorList' | 'ComplexSelector' | 'CompoundSelector' | 'PseudoSelector' | null;
  /** Is there content before this node in the parent container? */
  hasContentBefore: boolean;
  /** Is there content after this node in the parent container? */
  hasContentAfter: boolean;
  /** Index within parent container */
  indexInParent: number;
}
```

### Transformation Rules (Context → Action)

| Context | Partial Mode | Full Mode |
|---------|-------------|-----------|
| Root, whole match | SelectorList(target, extendWith) | SelectorList(target, extendWith) |
| Inside CompoundSelector | `:is(matched, extendWith)` + rest | reject (return unchanged) |
| Inside ComplexSelector | `:is(matched, extendWith)` + rest | `:is(matched, extendWith)` + rest |
| Inside PseudoSelector arg | recurse into arg | recurse into arg (with boundary check) |
| Inside SelectorList | extend each matching item | extend each matching item |

### Implementation Strategy

Rather than rewriting the entire 3600-line file at once, we implement incrementally:

#### Phase 1: Unified `walkAndExtend` for Simple Cases
- SimpleSelector target + SimpleSelector find (most common case)
- Handles: root match, inside SelectorList, inside CompoundSelector, inside ComplexSelector
- Bypasses: ampersand crossing, boundary crossing, `:is()` normalization
- **Test**: run all 941 tests, fall back to old path for complex cases

#### Phase 2: Compound and Complex find selectors
- CompoundSelector find (e.g., `.a.b:extend(.a.b)`)
- ComplexSelector find (e.g., `.a .b:extend(.a .b)`)

#### Phase 3: Batch multi-instruction walk
- Walk once, apply ALL matching instructions simultaneously
- Eliminates the per-instruction diagnostic loop in `processExtends`
- Key for Bootstrap performance

#### Phase 4: Remove old code paths
- Once all cases are covered and tests pass, remove the 3-phase pipeline

### Phase 1 Implementation Detail

```typescript
function walkAndExtend(
  target: Selector,
  find: Selector,
  extendWith: Selector,
  partial: boolean,
  ctx: WalkContext
): Selector {
  // 1. Check for exact match at this node
  if (componentsMatch(target, find)) {
    return applyTransformation(target, find, extendWith, partial, ctx);
  }

  // 2. Recurse into container nodes
  if (isNode(target, 'SelectorList')) {
    return walkSelectorList(target, find, extendWith, partial, ctx);
  }
  if (isNode(target, 'ComplexSelector')) {
    return walkComplexSelector(target, find, extendWith, partial, ctx);
  }
  if (isNode(target, 'CompoundSelector')) {
    return walkCompoundSelector(target, find, extendWith, partial, ctx);
  }
  if (isNode(target, 'PseudoSelector') && target.value.arg) {
    return walkPseudoSelector(target, find, extendWith, partial, ctx);
  }

  // 3. No match, return unchanged
  return target;
}
```

### Key Invariant

The walk-and-consume MUST produce identical output to the current pipeline for all
existing test cases. Unit tests serve as the guardrail — any behavioral difference
is a bug in the new implementation.

### Boundary Between Old and New

During incremental rollout, `extendSelector` becomes a dispatcher:

```typescript
function extendSelector(target, find, extendWith, partial, ...): Selector {
  // Try walk-and-consume for supported cases
  if (canUseWalkAndConsume(target, find)) {
    return walkAndExtend(target, find, extendWith, partial, ROOT_CTX);
  }
  // Fall back to existing 3-phase pipeline
  return extendSelectorLegacy(target, find, extendWith, partial, ...);
}
```

This lets us expand coverage gradually while maintaining correctness.
