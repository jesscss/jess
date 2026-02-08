# extend-less-fixtures test failures – analysis

## Summary

| # | Fixture | Expected vs received | Likely cause |
|---|--------|----------------------|--------------|
| 1 | extend-clearfix | Nested `&:after { }` inside block | We output flattened `:is(...):after`; serialization or nesting keeps materializing `&` |
| 2 | extend-exact | Nested `.b, .a { }` and `&:hover { }` | Same: we materialize to `:is(.c,.a,.effected) .b, ...` and `:is(.e.e,.dbl):hover` instead of keeping short nested form |
| 3 | extend-nest | `:is(.sidebar,...) .box` and `.button:hover, .submit:hover` | We output `.sidebar .box` (single parent) and `.button .button:hover` (wrong) – nested & not seeing merged parent or wrong selector for extended rule |
| 4 | extend-selector | Nested `.attributes { [data="test3"], .attribute-test { } }` | Received has no leading newline; expected has `\n` at start. Possibly just expected string trimming. |
| 5 | extend.less | `.bb, .ff { }` in second inner (no `.cc`) | We output `.bb, .cc, .ff` – extra `.cc` in nested block selector |

---

## 1. extend-clearfix.less

- **Expected:** One block `.clearfix, .foo, .bar { *zoom: 1; &:after { content:""; ... } }` (nested `&:after`).
- **Received:** Block closes after `*zoom: 1;` then `:is(.clearfix, .foo, .bar):after { ... }` (flattened).
- **Less reference** (`node_modules/@less/test-data/.../extend-clearfix.css`): Less also outputs the **flattened** form (`:is(...):after`), not nested `&:after`.
- So the **fixture expected** is “nested with `&`” while **Less** flattens. Either:
  - Fixture is intentional (we want nested when `collapseNesting: false`), or
  - Fixture expected should be updated to match Less.
- **Code to check:** Serialization of rulesets with implicit `&` – do we resolve `&` to full selector and then flatten, instead of keeping “&:after” in a nested block when `collapseNesting === false`?

---

## 2. extend-exact.less

- **Expected:** Nested `.b, .a { .a, .c { ... } }` and `&:hover { hover: not-extended; }` inside `.e.e, .dbl`.
- **Received:** `:is(.c, .a, .effected) .b, :is(.c, .a, .effected) .a { ... }` and `:is(.e.e, .dbl):hover, .dbl { ... }` (materialized, not nested).
- Same pattern as #1: we’re expanding implicit `&` and emitting flat `:is(...)` instead of preserving nested blocks and short selectors.
- **Code to check:** Same as #1 – when and where we materialize implicit ampersands for output; interaction with `collapseNesting` and block structure.

---

## 3. extend-nest.less (collapseNesting: **true**)

- **Expected:**  
  - `.box` rule: `:is(.sidebar, .sidebar2, .type1 .sidebar3, .type2.sidebar4) .box`  
  - `:hover` rule: `.button:hover, .submit:hover`
- **Received:**  
  - `.sidebar .box` (only first parent, not merged list)  
  - `.button .button:hover` (wrong; should be `.button:hover, .submit:hover`)
- So when **collapseNesting is true** (flat output like Less):
  - Nested rule’s `&` is not seeing the **merged** parent after extend (we still see `.sidebar` only).
  - The extended `:hover` rule is serialized with wrong selector (`.button .button:hover` instead of merging `.button:hover` and `.submit:hover`).
- **Code to check:**
  - That nested rulesets’ ampersand uses **live** `parentRuleset.value` and that extend really updates `ruleset.value.selector` so `getResolvedSelector()` / valueOf sees the merged selector.
  - Serialization/header for rules that were extended (e.g. `.submit:extend(.button)`) – why we get `.button .button:hover` instead of `.button:hover, .submit:hover`.

---

## 4. extend-selector.less

- **Expected string** starts with `\n` (template has newline before `.attributes`).
- **Received** is the same content but **without** leading newline.
- So the diff is only leading newline. Quick fix: ensure expected string matches what we actually want (e.g. trim or remove leading `\n` in the expected template).

---

## 5. extend.less

- **Expected:** Second inner block selector is `.bb, .ff` (no `.cc`).
- **Received:** `.bb, .cc, .ff`.
- So we’re including `.cc` in the inner block when we shouldn’t (or Less merges the outer list differently so `.cc` is not in that inner list).
- **Code to check:** How we build/merge selector lists for rules that have multiple extends (e.g. `.cc`, `.ee`, `.ff` and their nested blocks); why `.cc` appears in the inner “.bb, .ff” block.

---

## Suggested order of work

1. **#4** – Adjust expected string (leading newline) and re-run; confirms no behavioral bug.
2. **#3** – Focus on “live” merged parent for nested rules and correct `.button:hover, .submit:hover`-style output (collapseNesting true, matches Less).
3. **#1 & #2** – Decide whether we want nested `&` when `collapseNesting: false`; then either fix serialization to keep nesting or update expected to match Less.
4. **#5** – Debug selector-list construction for multi-extend so inner block is `.bb, .ff` not `.bb, .cc, .ff`.
