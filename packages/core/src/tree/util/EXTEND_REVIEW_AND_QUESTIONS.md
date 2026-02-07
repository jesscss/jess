# Extend: Review, Critical Questions, and Documentation Plan

## Purpose

This document records a careful review of the extend feature: what the code and docs say, what is unclear or inconsistent, and what should be simplified or clarified before further test fixes. **No behavior changes or test fixes are proposed here**—only understanding and documentation.

---

## 1. What the Code and Docs Already State (Summary)

### 1.1 Core concept (extend.ts header, docs/extend.md)

- **Extend** = add the extending selector to the target’s selector list, or wrap in `:is()` when appropriate.
- **Two modes**: `partial: true` (with `!all`) vs `partial: false` (without `!all`).
  - **Partial**: component-level matches → create `:is()` wrappers.
  - **Full**: only “whole” selector/list-item matches extend; partial matches are rejected (selector returned unchanged).

### 1.2 Responsibility split (EXTEND_ARCHITECTURE_ANALYSIS.md)

- **extend-roots.ts**: orchestration, which extends run, self-reference skip, merge rule (same/descendant root only).
- **extend.ts**: given (target, find, extendWith, partial), perform the extension; no policy.
- **findExtendableLocations** (in extend-helpers.ts): find all match locations; no policy.

### 1.3 Extend roots (docs/extend-roots-architecture.md)

- Extend roots = scopes (document root, at-rule bodies, import/compose).
- **Accessible** = same root + descendant roots only; **no ancestor** targeting.
- Merge only into rulesets in extend root or a descendant root.

### 1.4 Order and normalization (EXTEND_FUNCTION_AUDIT.md)

- **Order**: determined in `extendSelectorList`: `[...originalSelectors, ...newSelectors]`; no reordering in `createExtendedSelectorList`.
- **Normalization**: single place = `createProcessedSelector` (flatten `:is()`, dedupe); invoked via `createExtendedSelectorList`.

---

## 2. Critical Questions and Gaps

### 2.1 "Whole selector" in full mode — and the length-3 shim (wrong)

**Intended behavior:** Extend uses **one generalized path** every time. We re-check the (possibly extended) selector against other registered extends: find a subset of (new) keySet, early exits, equivalency-based full match. Selector **length has no place** in the rule.

**Rule in code today:** For full mode we use `isNonAllWholeSelectorItemMatch(target, findValue)` (valueOf-based). If false, `extendSelector` returns target unchanged.

**Shim that must go:** In `extendSelectorList`, when `extended === selector`, there is a block that pushes extendWith into `newSelectors` only when the selector is a ComplexSelector with **length 3** and the last component's value equals find. That is a **test-specific shim**, not a generalization of how extend works. It contradicts the design: we should not branch on selector length. Correct behavior should come from equivalency-based matching and the normal "start over" / re-check path (extended selector is re-evaluated against other extends; keySet subset, etc.). **Recommendation:** Remove this block when equivalency-based full-match is implemented. Do not document it as "the rule" or generalize it; delete it.
### 2.2 Partial vs full and “all” flag

- **Source of truth**: `context.extends` stores `[target, resolvedSel, flag === ExtendFlag.All, ...]` → partial = true when `!all` is used.
- **Question**: For `.ff:extend(.dd,.bb all)`, is partial true for **both** `.dd` and `.bb`? (Yes, from the code: one extend, one flag.)
- **Observed**: In some code paths we saw `partial: false` when extending the `.dd` ruleset by `.ff`; that was traced to full-mode handling. So the **caller** can pass partial correctly, but **inside** extend we may still take the “full” path (e.g. because of `isNonAllWholeSelectorItemMatch` returning false and then the extendSelectorList workaround applying). No contradiction once the workaround is in place, but the mental model is “partial flag from Less vs. full-mode branch inside extend”.

**Recommendation**: In docs, state clearly: “partial is set once per extend from the Less `!all` flag; it is passed through to extendSelector.” (The length-3 shim in extendSelectorList is not part of the intended design; see §2.1.)

### 2.3 Ampersand and “implicit” vs “materialized”

- **Implicit ampersand**: `F_IMPLICIT_AMPERSAND`; not serialized as `&` when context is the same (nested). Used to avoid output like `:is(.aa,.cc) .dd` when we want `.dd, .ee, .ff` under `.aa, .cc`.
- **Extend target vs extendWith:** Do **not** flatten the ampersand in the extend target; **do** materialize in extendWith when context differs. See EXTEND_RULES.md §5. No sourceNode for nested header.
- **Materialization**: When context differs, we replace implicit `&` with the concrete parent (e.g. `.aa,.cc`) so serialization is correct.
- **preserveImplicitAmpersandOnClone**: After cloning an extended selector, we copy implicit-ampersand flag and clear F_VISIBLE so nested output stays compact.
- **maybeHoistMixedNestingSelectorList**: When we have a mixed list (some with implicit `&`, some without), we may wrap in `:is(parent)` and hoist; same-context implicit ampersands are kept implicit (no F_VISIBLE).

**Question**: Is there a single, written rule like “same context ⇒ keep implicit ampersand; different context ⇒ materialize”, and is that rule implemented in one place or scattered (dematerialize, materialize, hoist, createProcessedSelector)?

**Recommendation**: Single rule in EXTEND_RULES.md §5: extend target = do not flatten; extendWith = materialize when different context; no sourceNode for header.

### 2.4 Functions that look narrow or duplicated

- **extendSelectorList length-3 block**: A **shim** that should be **removed**. Extend must not depend on selector length; see §2.1.
- **maybeHoistMixedNestingSelectorList**: Very specific to “mixed” lists and Less output shape. The name and a single comment at the top describe intent; the rest is hard to skim. A short “Contract: when we do X, we produce Y” in a comment or in this doc would help.
- **preserveImplicitAmpersandOnClone**: Single purpose, clear name. No duplication.
- **createProcessedSelector vs createExtendedSelectorList**: The audit says normalization lives in createProcessedSelector and is invoked via createExtendedSelectorList. No duplication; the split is clear.
- **findExtendableLocations**: Lives in extend-helpers.ts (re-exported from find-extendable-locations.ts to avoid cycles). The find-extendable-locations.ts file also holds normalizeSelectorForExtend. So “finding” is in extend-helpers; “normalization for extend” is in find-extendable-locations. Acceptable but could be noted in one sentence in the architecture doc.

### 2.5 Analysis docs vs current code

- **EXTEND_CALL_GRAPH_ANALYSIS.md**: Says handleCompoundFullExtend, getIsSelectorArg, extendWithinIsArg are unused and should be removed. EXTEND_FINAL_SUMMARY says they were removed. If they’re gone, the call graph doc is outdated; if not, the summary is wrong. **Action**: Grep for those names and then mark the doc as “as of date X” or update it.
- **EXTEND_FUNCTION_AUDIT.md**: Very long; mentions “.foo.foo bug” and “duplicate applyExtension* in find-extendable-locations”. Duplicates were consolidated (applyExtension* only in extend.ts). The “.foo.foo” bug and “process ALL locations” may or may not still apply. **Action**: Treat the audit as historical; add a one-paragraph “Current state” at the top (e.g. “As of 2025-02: applyExtension* only in extend.ts; findExtendableLocations in extend-helpers; length-3 shim in extendSelectorList — to be removed, not generalized.”).
- **EXTEND_BASELINE.md / EXTEND_FINAL_SUMMARY.md**: Describe refactors and test counts. Useful as history; not the place for the single source of “rules of extend”.

---

## 3. Proposed “Single Set of Rules” (for documentation)

A minimal set of rules that could live in one place (e.g. extend.ts file header or EXTEND_RULES.md):

1. **Scope (where)**  
   - Extends are applied only to rulesets in the extend root or a descendant extend root (never ancestors).  
   - Implemented in extend-roots.ts (accessible roots, merge rule).

2. **Modes (partial vs full)**  
   - **Partial** (`!all`): any match of find in target can extend; we add alternatives (often via `:is()`).  
   - **Full** (no `!all`): only "whole" matches extend (by equivalency). No selector-length special cases; the extend loop re-checks the extended selector so one path suffices.

3. **Output shape**  
   - **Selector list**: when we add an alternative at “root” (whole selector or whole list item), we produce `original, extendWith` (and possibly more).  
   - **:is() wrapper**: when we add an alternative at a component (compound/complex component), we wrap in `:is(original, extendWith)` to preserve the rest of the selector.  
   - **Order**: original selectors first, then new (from extend); no reordering in normalization.

4. **Normalization**  
   - Single place: createProcessedSelector (flatten generated :is(), dedupe). Used by createExtendedSelectorList and by extend-roots after applying an extend.

5. **Ampersand**  
   - Same context (nested under same parent selector): keep implicit ampersand (no materialization).  
   - Different context: materialize so serialization is correct.  
   - Cloning after extend must preserve implicit ampersand where appropriate (preserveImplicitAmpersandOnClone).

6. **Self-reference**  
   - If the extend’s target (find) equals the selector that carries the extend (selectorWithExtend), skip (extend-roots.ts).

7. **No policy in pure extend**  
   - extendSelector(target, find, extendWith, partial) does not decide *whether* to extend (that’s extend-roots); it only computes the extended selector (or returns unchanged) for the given inputs.

---

## 4. Recommendations (no code/test changes in this pass)

1. **Add or update a single “Rules of extend” doc**  
   - Either add `EXTEND_RULES.md` with §3 above (and keep it short), or expand the extend.ts file header to include a “Rules” subsection that matches §3.  
   - Reference it from EXTEND_ARCHITECTURE_ANALYSIS.md and EXTEND_FUNCTION_AUDIT.md.

2. **Do not document the length-3 block as correct behavior**  
   - The block in extendSelectorList that checks complex length 3 and adds extendWith is a shim to remove. In code: comment it as “SHIM: remove when equivalency-based full-match is in place; selector length must not affect extend.” In the rules doc: no “single-descendant exception” — one path, re-check, keySet subset only.

3. **Mark analysis docs as historical / add “Current state”**  
   - In EXTEND_FUNCTION_AUDIT.md: add a “Current state (as of …)” paragraph (where applyExtension* lives, where findExtendableLocations lives, single-descendant workaround).  
   - In EXTEND_CALL_GRAPH_ANALYSIS.md: either update for current code or add “(Historical; some removed functions may already be deleted).”

4. **Extend-roots and ampersand**  
   - In docs/extend-roots-architecture.md: no change needed; it’s already clear.  
   - In extend.ts or EXTEND_RULES: add the short “Ampersand and nesting” note (same context = implicit; different = materialize; cloning preserves).

5. **When fixing tests later**  
   - Run full extend test suites (core + jess) after any change.  
   - Prefer generalizing a rule (e.g. “whole” = last segment for complex) over adding more special-case branches; if a special case is added, document it in EXTEND_RULES and in a comment at the call site.

---

## 5. Open Questions for Maintainer

1. ~~Should "whole" for full mode be generalized~~ **Resolved:** "Whole" / full match is defined by **selector equivalency**, not serialization (see EXTEND_RULES.md §0). Implementation todo: replace valueOf()-based checks with equivalency-based matching.
2. ~~Circular-reference selector order (.x/.y/.z)~~ **Separate bug.** Unrelated to equivalency/whole. Likely causes: (1) extend **registration** order, and/or (2) extend **application** order, and/or (3) match **bubbling** to the outer list — e.g. when merging into the selector list we may be inserting the new match into the **middle** instead of **pushing to the end**; if registration and application order are correct, the bug may be insert position on merge. To investigate/fix separately.
3. ~~Other Less fixtures/spec as canonical~~ **Resolved:** Our Less fixtures are intended to be fairly exhaustive. We reference all existing extend tests via `packages/jess/test/less/all-less.test.ts`. No separate canonical spec needed; that test set is the source of truth for “exact” vs “all” and nested extend output.

## 6. Todos (from review and maintainer answers)

- **Equivalency-based matching everywhere:** All extend matching (finding and full-match decision) must be by **selector equivalency** only — never by exact AST or exact serialization. One generalized path: equivalency, keySet subset early exit, re-check extended selector against other extends. **Selector length must not affect extend.** We may use `valueOf()` for **early-exit TRUE** (match); we must not use `valueOf()` to early-exit as "no match". Replace any logic that uses `valueOf()` (or structure) to *reject* or decide non-match with equivalency-based matching. This includes: (1) **Finding** — `findExtendableLocations` and ExtendLocation/paths by equivalency; (2) **Full-match decision** — e.g. `isNonAllWholeSelectorItemMatch` by equivalency. **Remove** the length-3 (single-descendant) block in `extendSelectorList`; it is a shim, not a rule. Rules: compound = any order, :is() = or-path, one path exhaustively matched for full match; complex = left-to-right, same combinators, last position can be any or-alternative.
- **Selector order when multiple extends apply (e.g. .x/.y/.z):** Separate bug. Investigate: (1) extend registration order, (2) extend application order, (3) merge/bubbling — are we inserting the new match into the middle of the list instead of pushing to the end?
- **Extend test coverage (equivalency variants):** Canonical fixtures = extend tests referenced in `packages/jess/test/less/all-less.test.ts`. Add tests where equivalency might have masked gaps (logic was too narrow). Include order & equivalency variants: compound == compound, complex == complex, simple == complex, compound == complex (simple find may be `:is()`). Review core extend tests exhaustively for opportunities; avoid duplicating coverage.
- **Partial match wrap rule (docs + tests + code):** In partial mode, what gets wrapped: (1) Within one compound → wrap only matched part. (2) Spans combinator → wrap full segment. Documented in EXTEND_RULES.md §3a. **Do not** implement by branching on target type (ComplexSelector, etc.) or path length — target can be :is(complex), SelectorList, compound with :is(), etc. Use keySet + equivalency and **what the match produces** (e.g. does the match include combinators?) to decide wrap scope. Unified path is in place; §3a and equivalency tests pass. Ensure any new tests match this behavior.

## 7. Test alignment with EXTEND_RULES

**Principle:** We question, update, and expand tests to conform to the simpler, generalized extend rules in EXTEND_RULES.md. The rules are the source of truth; tests that assert behavior that conflicts with the rules should be updated (or removed), not used to justify special-case code.

**When a test fails:**
1. Does the **test expectation** match the rules (e.g. §0 equivalency, §3 output shape, §3a wrap scope, §4 flatten generated :is())? If not → **update the test**.
2. Does the **rule** need clarifying or expanding? If so → update EXTEND_RULES.md (or this doc), then align tests.
3. Is the rule clear and the implementation wrong? → **fix code**.

**Current failure categories (as of last run):**
- **Validation (element/ID conflict):** Rules require we reject invalid extensions. Tests expect `tryExtendSelector` to return original selector + error. If we produce an extended selector and no error, the **code** path is bypassing validation (fix code). If the API contract is “throw” but tests expect “return error”, that’s a test/API alignment question.
- **Selector order / circular refs / @media:** Documented as separate bugs or scope issues; not rules changes. Fix when investigating those areas.
- **Partial match “example 6” / “.foo :is(.bar,:is(.ext3,.ext4))”:** §3 says add at component → `:is(original, extendWith)`. §4 says flatten **generated** :is() in normalization. If extendWith is an :is() that is not generated (e.g. test-authored), valueOf does not flatten it. Tests that expect a single flat list may be asserting “extract :is() when appending” — that would be a **rule expansion** (document if we want it) and then implement; or update test to expect nested :is() when extendWith is non-generated.
- **Snapshot / eval integration:** Update snapshots or expectations to match rule-based output (original first, then new; flatten generated :is() only).
