# Extend “live” selector analysis: Option 1 vs Option 2

## Why `.box` becomes `.sidebar .box` instead of `:is(.sidebar, ...) .box`

Nested rules get an implicit `&` whose resolution is set in `ruleset.ts` preEval:

```ts
const getResolvedSelector = parentRuleset
  ? () => {
      const v = (parentRuleset as Ruleset).value;
      return v?.selectorBeforeExtend ?? v?.selector;  // ← returns pre-extend when set
    }
  : undefined;
```

We intentionally return `selectorBeforeExtend` when set (EXTEND_RULES §5: don’t materialize implicit ampersands that weren’t extended). So when the parent is extended, the nested `&` still resolves to the **pre-extend** selector (e.g. `.sidebar`). Serialization then sees `.sidebar` and outputs `.sidebar .box` instead of the merged `:is(.sidebar, .sidebar2, ...) .box`.

Same-context for materialization already uses `getRulesetParentSelector(ruleset)` (which returns `selectorBeforeExtend ?? selector`) in `materializeImplicitAmpersandWhenDifferentContext` and `getRulesetParentSelector`. So we can make the **ampersand** resolve to the live selector without breaking “don’t materialize when same context.”

---

## Minimal fix (before larger refactors)

**Change the getter to always return the live selector:**  
`return v?.selector;` (and drop `selectorBeforeExtend ??` for this getter).

- **Where:** `packages/core/src/tree/ruleset.ts` ~line 226.
- **Risk:** Only the materialization same-context logic must keep using `getRulesetParentSelector` (it already does). No other refactor required.
- **Scope:** One-line change + re-run extend-nest and extend-exact tests.

If this is done and verified, the “live” connection is restored for display and extend matching without Option 1 or Option 2.

---

## Option 1: Selector container attached to ruleset (mutate in place; `&` points to container)

### Idea

- Ruleset does not store `value.selector` directly; it holds a **selector container** (e.g. `SelectorContainer` node) whose **contents** are the current selector(s).
- Extend **mutates** the container’s contents (e.g. replace or merge into the same container) instead of doing `ruleset.value.selector = normalizedSelector`.
- Ampersand’s `getResolvedSelector` returns `container.getCurrentSelector()` (or the container’s contents), so it always sees the updated selector.

### Current flow (for contrast)

- `RulesetValue = { selector, rules, selectorBeforeExtend? }`.
- Extend does **replacement**: `ruleset.value.selector = normalizedSelector`.
- Ampersand holds a **function** `getResolvedSelector: () => parent.value.selector` (or with selectorBeforeExtend as above). So “liveness” is already a function that reads the current value; the real bug was returning `selectorBeforeExtend` in that getter.

### What Option 1 would require

1. **New node type / value shape**
   - Introduce something like `SelectorContainer` (or a wrapper in `RulesetValue`) that holds the “current” selector and can be mutated.
   - API: e.g. `container.getCurrentSelector()`, `container.setContents(selector)` or `container.replace(selector)`.
   - Decide whether one container holds one selector or a list (e.g. for merged list, extend would merge into the same container).

2. **Ruleset value and accessors**
   - Change `RulesetValue` to something like `{ selectorContainer, rules, ... }` (or keep `selector` as a getter that returns `selectorContainer.getCurrentSelector()`).
   - Replace every direct read of `value.selector` / `ruleset.selector` with “get from container” (or keep a getter so call sites stay as `ruleset.selector`).
   - Replace every assignment `value.selector = x` with a call like `selectorContainer.setContents(x)` (or equivalent mutation).

3. **Extend**
   - In `extend-roots.ts` (and any other place that sets `ruleset.value.selector = normalizedSelector`): stop assigning to `value.selector`; instead mutate the ruleset’s selector container (e.g. replace contents with the normalized selector).
   - Ensure `ensureDescendantRulesetsHaveOwnValue` and any cloning still give each ruleset its own container where needed.

4. **Ampersand**
   - `getResolvedSelector` could stay as a function; it would return `parentRuleset.selectorContainer.getCurrentSelector()` (or `parentRuleset.selector` if that getter reads from the container). No need for ampersand to hold a “selector” reference; it can keep holding a getter that reads from the parent ruleset’s container.

5. **Copy / clone**
   - When copying a ruleset, copy or share the container in a well-defined way (e.g. copy the container but not necessarily the whole tree inside it, or define that clone gets a new container with same initial contents).

6. **Touch surface**
   - **Ruleset:** value type, getter, `ensureDescendantRulesetsHaveOwnValue`, copy, eval (any place that reads or writes `value.selector`).
   - **extend-roots.ts:** every `ruleset.value.selector = ...` (phase 1 and phase 2).
   - **extend.ts:** any direct use of `ruleset.value.selector` or ruleset selector for extend.
   - **Other:** registry, serialize, ruleset registration, anywhere that assumes `value.selector` is a plain Selector.

### Assessment Option 1

- **Pros:** Single source of truth; extend always “mutates in place”; any pointer to the container (including ampersand) sees the latest selector.
- **Cons:** Large refactor (new concept, many reads/writes of selector); subtle behavior for shared vs copied containers and for `selectorBeforeExtend` (if that stays, it likely stays as a separate field or a snapshot on the container).
- **Risk:** Medium–high; easy to miss a read/write of `value.selector` and get inconsistent state.

---

## Option 2: Ampersand stores ruleset reference instead of selector

### Idea

- Ampersand does not store a **selector** (or a getter that returns a selector) but a **reference to the parent ruleset**.
- `getResolvedSelector()` becomes something like:  
  `() => this.value.parentRuleset?.selector ?? this.value.selector`  
  (with a safe fallback if parent ruleset or selector is missing).
- So resolution is “current selector of that ruleset at read time.” When extend replaces the parent’s `value.selector`, the next resolve sees the new value.

### Current flow (for contrast)

- Ampersand stores `getResolvedSelector: () => ...` (function that reads parent’s `value.selector` or `selectorBeforeExtend ?? selector`). So we already have “read from parent at call time”; the bug was that we made that return `selectorBeforeExtend` when set.

### What Option 2 would require

1. **Ampersand value**
   - Add something like `parentRuleset?: Ruleset` (or a getter that returns the parent ruleset) on `AmpersandValue`.
   - Keep `selector` as fallback for when there is no parent ruleset (e.g. explicit `&` in a list).

2. **Resolution**
   - `getResolvedSelector()`:  
     `return this.value.parentRuleset ? this.value.parentRuleset.selector : this.value.selector;`  
     (and Nil/undefined checks as needed). Optionally still support an explicit getter for overrides (e.g. dematerialize path).

3. **Where ampersand is created**
   - **ruleset preEval** (implicit `&`): instead of passing `getResolvedSelector: () => parent.value.selectorBeforeExtend ?? parent.value.selector`, pass `parentRuleset: parentRuleset` (and no getter, or a getter that uses parentRuleset.selector).
   - **selector-utils `addImplicitAmpersand`:** same idea: when we have a parent ruleset, set `parentRuleset` on the ampersand; otherwise keep `getResolvedSelector` or `selector` as today.

4. **Copy**
   - On copy, copy `parentRuleset` reference so the clone still resolves to the same ruleset (and thus the same “live” selector).

5. **selectorBeforeExtend**
   - For same-context we do **not** want ampersand to resolve to selectorBeforeExtend. We already use `getRulesetParentSelector(ruleset)` for that. So with Option 2, `getResolvedSelector()` should return `parentRuleset.selector` (live). Same-context logic continues to use `getRulesetParentSelector` and does not need to change.

6. **Touch surface**
   - **Ampersand:** value type, `getResolvedSelector`, copy, any code that assumes only `getResolvedSelector`/`selector` exist.
   - **ruleset.ts:** when building implicit selector, pass `parentRuleset` instead of (or in addition to) `getResolvedSelector`.
   - **selector-utils:** `addImplicitAmpersand` – accept optional `parentRuleset` and set it on the ampersand.
   - **extend-roots (dematerialize):** when creating an ampersand that should stay live, set `parentRuleset` if available instead of a static getter.

### Assessment Option 2

- **Pros:** Small, localized change; no new node type; extend keeps doing `value.selector = ...`; “live” comes from “read parent.selector when resolving.”
- **Cons:** Ampersand now depends on Ruleset (reference); need to avoid circular refs (ampersand → ruleset → rules → child ruleset → ampersand → parent ruleset is fine).
- **Risk:** Low–medium; mainly ampersand + ruleset/selector-utils wiring.

---

## Recommendation

1. **Try the minimal fix first**  
   In `ruleset.ts`, change the getter to return only the live selector:  
   `return v?.selector;`  
   Keep using `getRulesetParentSelector` everywhere we need “same context” (selectorBeforeExtend).  
   This restores a live connection for serialization and extend matching with minimal change.

2. **If that’s not enough or we want a clearer model:**  
   Prefer **Option 2** over Option 1:
   - Option 2 makes “live” explicit (ampersand → ruleset → selector) with limited, well-defined touch surface.
   - Option 1 is a large refactor (selector container, mutation API, every selector read/write) for a problem that may be solved by the one-line getter change and Option 2.

3. **Option 1** is worth considering only if we later want a single mutable “selector slot” for other reasons (e.g. multiple writers, or more complex selector evolution). It’s not necessary for “nested rule sees merged parent selector.”

---

## Summary table

| Approach           | Scope        | New concepts     | Risk   | Delivers “live” merge |
|-------------------|-------------|------------------|--------|------------------------|
| Minimal fix       | 1 line      | None             | Low    | Yes (if getter only)  |
| Option 2 (ruleset ref) | Ampersand + ruleset/selector-utils | parentRuleset on & | Low–med | Yes |
| Option 1 (container)  | Ruleset, extend, all selector access | SelectorContainer | Medium–high | Yes |
