# Extend: Rules (single reference)

Short, authoritative list of extend rules. Details and edge cases are in the extend.ts file header and in EXTEND_REVIEW_AND_QUESTIONS.md.

## 0. Foundational: all extend matching is equivalency-based

**Selector equivalency is the only criterion for extend matching.** We do not care about AST shape, exact structure, or serialization (e.g. `valueOf()`). If two selectors are equivalent — they would select the same element(s) — they match. An exactly equivalent selector is a match. We never match by "exact AST" or "exact serialization."

This applies to **every** step of extend: **Finding** (where does `find` appear in `target`?) and **full-match decision** (is this location a whole match or partial?) both use equivalency. If `find` is equivalent to some part of `target` (e.g. one branch of an `:is()` plus the rest), that is a match.

**Compound equivalency** (order of simple selectors doesn’t matter; `:is()` is an or-path):

- `.a.b.c` ≡ `.b.a.c` ≡ `.c.b.a` ≡ `:is(.c, .q).a.b` ≡ `:is(.a.c.b)` ≡ `.a:is(.b).c`
- All of these would style `<div class="a b c">` the same. For a **full** match we need at least one path (when there are `:is()` or-paths) that is **exhaustively** matched from start to finish; extra alternatives in an or-path (e.g. `.q`) don’t invalidate a full match.

**Complex selector full match** (same idea, left-to-right with identical combinators):

- `.a.b > .c.d` ≡ `.b.a > .d.c` ≡ `:is(.a.b > .d).c` ≡ `:is(.b:is(.a)) > :is(.c):is(.d, .q)`
- Compounds match in any order; we join in and out of `:is()` blocks; combinators must match left-to-right. For a full complex match we need a match that **starts at the beginning** and reaches **a selector in the last position**; the last position can be any or-alternative (e.g. `.d` or `.q` sharing that position).

**Implementation gap:** Current code still uses `valueOf()` / string comparison and structure-based logic in places (e.g. `findExtendableLocations`, `isNonAllWholeSelectorItemMatch`). There is also a **shim** in `extendSelectorList` that checks selector length (e.g. complex length 3) and adds extendWith when `extended === selector`; that shim is **wrong** — extend must be one generalized path every time (equivalency, keySet subset, re-check the extended selector against other extends). Selector length has no place in the rule. The shim should be removed when equivalency-based matching is in place. See EXTEND_REVIEW_AND_QUESTIONS.md §2.1 and §6 (todos).

**Early exit (optimization):** While matching is by equivalency only, we can use cues to exit early. The most useful: if the **target** keySet does **not** include all keys of the **find** keySet, we can exit early — no match is possible. (Target and find do not need fully *matching* keysets, because of or-paths; but if target is missing any key that find has, we can skip.) Use Set prototype extensions for this (e.g. `find.keySet.isSubsetOf(target.keySet)`; if false, exit). Existing use: extend-helpers.ts (e.g. fast rejection when find.keySet is not a subset of target.keySet). We **can** use `valueOf()` for an **early-exit TRUE** (if serializations match, treat as match). We **cannot** use `valueOf()` to early-exit as "no match" — when `valueOf()` differs we must still run equivalency; equivalent selectors can have different serialization.

## 1. Where (scope)

- Extends apply only to rulesets in the **extend root** or a **descendant** extend root. Never into ancestor roots.
- Implemented in extend-roots.ts (accessible roots, merge rule). See docs/extend-roots-architecture.md.

## 2. Modes (partial vs full)

- **Partial** (`!all`): Any match of `find` in `target` can extend; we add alternatives (often via `:is()`).
- **Full** (no `!all`): Only **whole** (full) matches extend. **Full match** is defined by **selector equivalency** (see §0):
  - **Compound**: at least one or-path in the target exhaustively matches the find (compound order and `:is()` structure don’t matter for equivalency).
  - **Complex**: at least one path from start to end matches the find with the same combinators; the “last position” can be any or-alternative.
  - **Current implementation**: The code still relies on `valueOf()` in `isNonAllWholeSelectorItemMatch`. A length-based shim in `extendSelectorList` (e.g. “complex length 3”) is **not** part of the rule — it should be removed; correct behavior comes from equivalency + the normal re-check path.

## 3. Output shape

- **Selector list**: When we add an alternative at root / whole list item → `original, extendWith` (and possibly more).
- **:is() wrapper**: When we add at a component (compound or complex component) → `:is(original, extendWith)` to preserve the rest.
- **Order**: Original selectors first, then new; no reordering in createExtendedSelectorList.

### 3a. Partial match: what gets wrapped

In **partial** mode, what we wrap in `:is(..., extendWith)` depends on whether the match stays within one compound or spans combinators:

- **Match entirely within one compound**: Wrap **only** the matched part. The rest of the compound stays outside the `:is()`.
  - Example: partial match `.a.b` within `.a.c.b`, extend with `.q` → `:is(.a.b, .q).c`
- **Match spans a combinator** (match touches multiple compounds): Wrap the **full** segment from first to last matched compound, including all compounds and combinators in between.
  - Example: partial match `.a.b > .x` within `div + .a.c.b > .y.x`, extend with `.q` → `div + :is(.a.c.b > .y.x, .q)`.

**How to decide (implementation):** Do **not** branch on target AST type (e.g. `isNode(target, 'ComplexSelector')`) or on path length (e.g. `path.length === 2`). The target can be a simple selector that is an `:is()` containing a complex selector, or a SelectorList, or a compound with an `:is()` component, etc. — recursive nesting makes type/path checks unreliable. The only reliable approach: use **keySet** and **equivalency** for matching, and base the wrap scope on **what the match produces** — e.g. does the match result include combinators? If the match produces (or spans) combinators, wrap the full segment; otherwise wrap only the matched part. Track match results, not structure.

## 4. Normalization

- Single place: **createProcessedSelector** (flatten generated `:is()`, dedupe). Used by createExtendedSelectorList and by extend-roots after applying an extend.

## 5. Ampersand

- **Extend target:** Do **not** flatten / make visible the ampersand in the ruleset selector we are extending. Keeping it implicit allows nested output to show only the "own" selector (e.g. `.replace, .rep_ace, .c`) without a parent prefix.
- **ExtendWith:** **Do** flatten (materialize) the invisible ampersand in extendWith when applying **only when** it does **not** match the inherited (ruleset frame) ampersand. Same context ⇒ keep implicit; different context ⇒ materialize.
- Cloning after extend must preserve implicit ampersand where needed (**preserveImplicitAmpersandOnClone**).
- **No sourceNode for nested header:** Serialization must not use `selector.sourceNode` for the ruleset header; the correct behavior comes from the ampersand rule above, not from storing an "own" selector on the node.

## 6. Self-reference

- If the extend’s **find** equals the selector that carries the extend (**selectorWithExtend**), skip. Handled in extend-roots.ts.

## 7. Responsibility

- **extendSelector(target, find, extendWith, partial)** does not decide *whether* to extend; it only computes the extended selector (or returns unchanged). Policy (which extends run, skip self-ref, etc.) lives in extend-roots.ts.
