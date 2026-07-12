# Uncommitted changes vs dev that may affect extend-nest failures

Summary of `git diff dev` for extend-related code and how each relates to extend-nest.

---

## 1. **packages/jess/test/less/all-less.test.ts** — direct cause of extend-nest failure

**Change:** Added `extendNeedsNoCollapse` and set `collapseNesting: false` for extend fixtures, including `extend-nest`.

**Effect:** extend-nest is now run with **collapseNesting: false**. The expected file `extend-nest.css` is the **collapsed** (flattened) Less output. So:
- **Received:** Nested structure with literal `&` (e.g. `.type2 { &.sidebar4 { ... } }`, `.amp-test-f& + &.amp-test-g`).
- **Expected:** Flat selectors (e.g. `.type2.sidebar4`, `:is(...).amp-test-g`).

**Conclusion:** This change alone makes the extend-nest test fail: we force no-collapse but assert against collapse output. Fix by either removing extend-nest from `extendNeedsNoCollapse` (and fixing any extend bugs with collapse: true) or changing the expected file (would diverge from Less).

---

## 2. **packages/core/src/tree/at-rule.ts**

**Changes:**
- **preEval:** For **nestable** at-rules we no longer push the body’s `rules` onto the extend root stack; we only push for **non-nestable**. Rationale: the body’s `Rules.preEval` pushes the **clone** so rulesets register to the tree that ends up in the AST; pushing the original would leave the clone’s registry empty (extend + collapseNesting bug).
- **evalNode:** After registering the at-rule’s extend root we do `pushExtendRoot(rules)` then immediately `popExtendRoot()`, so the at-rule root is registered but not left on the stack.
- **New:** `registerInnerExtendRootIfHoisted` — when the at-rule body is wrapped in a single `Ruleset(&)` (collapseNesting/hoist), the real rulesets (e.g. `.ma`) live under that wrapper’s inner `Rules`; we register that inner `Rules` as a child extend root so processExtends can find them.

**Effect on extend-nest:** With **collapseNesting: true**, extend-nest relies on correct registration of nested/hoisted blocks so that:
- Rulesets inside nested/hoisted structures register to the right extend root.
- processExtends can see those roots (via getAccessibleRoots / getAlts) and merge selectors (e.g. `.sidebar` + `.sidebar2` + `.type1 .sidebar3` + `.type2.sidebar4`).

So these at-rule changes are central to extend-nest **when** we run with collapse: true (i.e. once extend-nest is removed from extendNeedsNoCollapse).

---

## 3. **packages/core/src/tree/util/extend-roots.ts**

**Changes:**
- Removed `setExtendOrderMap` import and all agent/syncLog debug blocks.
- **anyPrefixedByParent / anyNotPrefixedByParent:** Now use `materializeImplicitAmpersand(s)` so relative selectors (e.g. `.header-nav` with implicit `&`) count as “prefixed by parent” when deciding whether to hoist.
- Doc comments updated (visibility / mergeable roots).

**Effect on extend-nest:** Hoisting and “prefixed by parent” affect when nested selector lists are hoisted to root and wrapped in `:is(...)`. That directly affects output like `:is(.sidebar, .sidebar2, .type1 .sidebar3, .type2.sidebar4) .box`. So this file is relevant to extend-nest (especially with collapse).

---

## 4. **packages/core/src/tree/util/extend.ts**

**Changes:**
- Removed **extendOrderMap** and **sorting in createExtendedSelectorList**. Merged selectors (e.g. into `:is(...)`) are no longer sorted by “extend order”; order is now registration/traversal order only.
- **isNonAllWholeSelectorItemMatch:** Added recursion into nested `:is()` (e.g. `:is(:is(.foo))`) when matching.

**Effect on extend-nest:** Selector order in merged groups (e.g. `.sidebar, .sidebar2, .type1 .sidebar3, .type2.sidebar4`) can change. Tests that depend on exact order may fail. Nested `:is()` matching can change which selectors are considered “whole” matches.

---

## 5. **packages/core/src/tree/util/extend-helpers.ts**

**Changes:** Partial-match handling when the target is a **multi-component** complex selector:
- **Before:** Only matches at **position 0** were marked partial and got remainders.
- **After:** **Any** match in a component (position 0, 1, 2, …) is marked `isPartialMatch = true`; **remainders** are still only set when `lastPathSegment === 0`.

**Effect on extend-nest:** Nested/partial extends (e.g. `.box` inside `.sidebar` extending something multi-part) could behave differently if the target has multiple components; matches at non-zero positions are now partial but have no remainders.

---

## 6. **packages/core/src/tree/ampersand.ts**

**Changes:**
- When creating a `:is(...)` wrapper from ampersand eval, we now set `result.generated = true` explicitly (for processLeadingIs / “unwraps evaled &[e] with frame * b”).
- Removed debug vars and the “only set frame selector if no stored selector” comment; logic unchanged (still `if (!amp.value.selector && frame && frame.selector)` then set).

**Effect on extend-nest:** Ensures `:is()` created from `&` is marked generated so downstream unwrapping (e.g. processLeadingIs) can treat it consistently. Affects selector shape when collapse/hoisting is on.

---

## 7. **packages/core/src/tree/selector-complex.ts**

**Changes:** Removed the **unwrap step** in eval that turned `:is(BasicSelector)` back into `BasicSelector` inside a ComplexSelector (including propagation of `hoistToRoot`).

**Effect on extend-nest:** Selectors that used to be normalized to a bare basic selector may now stay as `:is(basicSelector)`. That can change serialization and matching (e.g. for `.amp-test-f& + &.amp-test-g`-style cases). This unwrap was likely helping produce the “expected” flattened form; removing it can contribute to differences when collapse is on.

---

## 8. **packages/core/src/tree/selector-compound.ts**

**Changes:** Removed the **collapse-nesting-only** block that merged a leading `:is(ComplexSelector)` with following simple selectors (e.g. attributes) into the last component of the complex selector to get `* b[e]` instead of `:is(* b)[e]`.

**Effect on extend-nest:** With collapse on, we may now emit `:is(* b)[e]` where the expected Less output is `* b[e]`. So this change can cause selector-format mismatches in extend-nest (and similar fixtures).

---

## 9. **packages/core/src/tree/rules.ts** and **packages/core/src/tree/ruleset.ts**

**Changes:** Only removal of agent/syncLog debug blocks; no behavioral logic changes observed in the diff.

**Effect on extend-nest:** None expected.

---

## 10. **packages/core/src/tree/util/selector-utils.ts**

**Change:** Not fully inspected; may contain normalization/unwrap logic used by extend. Worth a quick check if extend-nest still fails after addressing the above.

---

## Recommended order to address extend-nest

1. **Test config:** Remove `extend-nest` from `extendNeedsNoCollapse` in `all-less.test.ts` so extend-nest runs with **collapseNesting: true** and is compared to the existing (collapsed) expected CSS. This aligns the test with the intended Less output and exposes real extend/collapse bugs.
2. **At-rule registration:** Keep the at-rule changes (no push of original in preEval for nestable, registerInnerExtendRootIfHoisted, register then push/pop) and verify that with collapse: true, rulesets inside nested/hoisted blocks are found and extended correctly.
3. **Selector shape:** If output still differs (e.g. `:is(...)` vs flat, or `:is(* b)[e]` vs `* b[e]`), consider restoring or reimplementing the **selector-complex** unwrap of `:is(BasicSelector)` and/or the **selector-compound** merge of leading `:is(ComplexSelector)` + suffix in a way that matches Less and respects project rules (e.g. centralize in processLeadingIs if appropriate).
4. **Order and partials:** If order or partial-extend behavior still fails, re-evaluate removal of extendOrderMap (and possibly partial-match semantics in extend-helpers) against Less behavior and test expectations.

This file can be deleted once the work is done or folded into another doc.
