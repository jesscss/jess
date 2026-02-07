# Extend: narrow logic review (type / path / :is() branches)

**Current extend test run:** 186 passed, 11 failed, 1 skipped (as of last run). See EXTEND_REVIEW_AND_QUESTIONS.md §7 for test-alignment principle: we **question, update, and expand tests to conform to EXTEND_RULES.md**; rules are source of truth.

**Known failures (not from unified-path work):**
- Selector order when multiple extends apply: extend-eval-integration (snapshot .d/.e and .x/.z/.y order), extend-rules (circular .x/.y/.z order).
- @media direction: .b:extend(.a) inside @media — expected .b to get root .a decls, currently doesn’t.
- Validation (element/ID conflict): some paths may bypass validation; fix code so tryExtendSelector returns original + error.
- Other: partial match example 6, .foo :is() partial mode — see §7 (update test vs expand rule vs fix code).

---

## Narrow logic: reject or duplicate by type/path instead of match results

**Principle:** Do not branch on `isNode(target, 'ComplexSelector')`, `path.length === 2`, or “we’re inside :is()” to decide behavior. Use keySet, equivalency, and **what the match produces** (e.g. includes combinators).

### extend.ts

| Location | What it does | Risk |
|----------|--------------|------|
| `handlePartialModeExtension`: `path.length === 1 && isNode(target, 'CompoundSelector')` | Wrap one component in compound. | Fails when target is :is(compound), list, etc. |
| `handlePartialModeExtension`: `path.length === 1 && isNode(target, 'ComplexSelector')` | Wrap one compound in complex. | Fails when target is :is(complex), SelectorList, etc. |
| `handlePartialModeExtension`: `path.length === 2 && isNode(target, 'ComplexSelector')` | Wrap one simple inside compound inside complex. | Fails for nested target. |
| ~1163: `location.isPartialMatch && isNode(target, 'ComplexSelector') && isNode(find, 'ComplexSelector')` | Remainder extraction for “.a>.b” in “.a>.b.c”. | Type-narrow; duplicate path for complex+complex. |
| ~1214: `isNode(target, 'CompoundSelector') && searchResult.locations.length > 1` | Multiple component matches in compound. | Compound-only path. |
| ~1244: `isNode(target, 'ComplexSelector') && searchResult.locations.length > 1` | Multiple component matches in complex. | Complex-only path. |
| ~1384: `!partial && isNode(find, 'SimpleSelector')` | Full-mode whole-match check (isNonAllWholeSelectorItemMatch). | Find-type branch; full match should be equivalency-based. |
| ~1415: `isNode(target, 'CompoundSelector') && isNode(find, 'CompoundSelector')` | Compound+compound partial check. | Duplicate path by type. |
| ~1503: `path.length === 1 && isNode(target, 'ComplexSelector') && path[0] === 0` | First component match in complex. | Path + type narrow. |
| ~1523: `path.length === 1 && isNode(target, 'CompoundSelector')` | Component match in compound (selectBestLocation?). | Type narrow. |
| ~1663: `!partial && isNode(find, 'SimpleSelector') && isNode(selector, 'ComplexSelector')` | Length-3 shim (single-descendant). | Already marked for removal. |
| ~1962: `loc.path.length === 1 && isNode(target, 'ComplexSelector') && loc.path[0] === 0` | Prefer location. | Type/path narrow. |
| handleFullExtend: `isNode(target, 'SelectorList')`, `isNode(target, 'PseudoSelector')` | Where to add extendWith. | Structural (we must handle list vs pseudo); may still duplicate logic vs “match result says list vs single”. |

### extend-helpers.ts

| Location | What it does | Risk |
|----------|--------------|------|
| Fast paths: `isNode(target, 'CompoundSelector') && isNode(find, 'SimpleSelector')`, `target.value.length <= 4`, etc. | Early exits / fast path by type and size. | Length/type narrow; should be keySet + equivalency. |
| `isNode(target, 'SelectorList') && target.value.length <= 3`, `isNode(target, 'ComplexSelector') && target.value.length <= 7` | Size-based fast path. | Arbitrary limits; duplicate path by type. |
| `isNode(find, 'SelectorList')`, `isNode(find, 'ComplexSelector')` in findExtendableLocations | Different search for find type. | Duplicate paths by find type instead of one path driven by match results. |
| `isNode(target, 'PseudoSelector') && target.value.arg` (e.g. :is) | Recurse into :is() argument. | Necessary structure; but “entering :is()” shouldn’t duplicate *logic* — track match result instead. |

---

## Reductions done

- **Length-3 shim removed** (extendSelectorList): The block that pushed extendWith when `extended === selector` and `selector` was ComplexSelector with length 3 and last component equals find has been removed. Re-run: same 5 failures (no new failures). See EXTEND_REVIEW_AND_QUESTIONS.md §2.1.

- **handlePartialModeExtension narrow branches (Option A) — reverted:** Removed the three path/type branches and fell through to `applyExtensionAtLocation`. Re-run: **42 failures** (was 5). The single path does not produce the `:is()` wrapping that the narrow branches did (e.g. `.a>:is(.b,.c)` for partial match). **Conclusion:** Do not remove these branches until match-result-based logic is implemented in a single path that produces the same wrap behavior. Then remove the branches and re-run.

## Unified path and equivalency tests

- **Unified path in place:** `handlePartialModeExtension` uses a single path: when `location.path.length >= 1`, set `extensionType = 'wrap'` and call `applyExtensionAtLocation(target, { ...location, extensionType }, extendWith)`. No narrow type/path branches there.
- **Validation on wrap:** `applyExtension(..., 'wrap')` uses `createValidatedIsWrapperWithErrors(...)` so element/ID conflict validation runs where that path is taken.
- **§3a and equivalency:** Within-one-compound wrap, spans-combinator wrap, and the five “Unified path (equivalency)” tests all pass. Generated :is() is not preserved arbitrarily — it is flattened per §4 (createProcessedSelector / valueOf).
- **Test alignment:** Tests are updated to conform to EXTEND_RULES.md; see EXTEND_REVIEW_AND_QUESTIONS.md §7.

## Reduction strategy

1. **One change at a time** — remove or relax one narrow branch (or unify two paths).
2. **Re-run extend core tests** after each change.
3. **Prefer:** Replace type/path checks with “what does the match produce?” (e.g. combinators, list vs single) and keySet/equivalency. Unify :is() handling so we don’t duplicate logic when entering :is().
