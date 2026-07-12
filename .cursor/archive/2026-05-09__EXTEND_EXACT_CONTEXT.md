# Extend-exact: where we are and what’s next

**One-page context for a new session.** Update this as work progresses.

---

## 1. Recent work (done)

- **css-guards.less:** Fixed “No matching mixins found for '.scope-check'”. Root cause: guarded rulesets with plain `&` were not indexed in the mixin registry. Fix in `packages/core/src/tree/util/registry-utils.ts`: index by first indexable key; use `ownSelector` when resolved selector has empty keySet; skip only plain `&` from mixin indexing (not `&.foo`). All-less css-guards test now passes.
- **Debug cleanup:** Removed agent log regions and `syncLog` from core tree (including `selector-match-core.ts`, `extend-eval-integration.test.ts`). All-less still has some agent log in `packages/jess/test/less/all-less.test.ts`; optional to clean later.

---

## 2. Extend-exact: the real bug

**Less source (extend-exact.less, first rule + extend):**

```less
.replace.replace,
.c.replace + .replace {
  .replace,
  .c {
    prop: copy-paste-replace;
  }
}
.rep_ace:extend(.replace.replace .replace) {}
```

Later in the file: `.effected { &:extend(.a); &:extend(.b); &:extend(.c); }` (exact extend, no `all`).

**Expected (Less test-data extend-exact.css):**  
First rule: `:is(.replace.replace, .c.replace + .replace) :is(.replace, .c), .rep_ace { prop: copy-paste-replace; }`  
`.effected` must **not** appear in that first rule (there is no bare `.c` there; only `.replace.replace`, `.c.replace + .replace`, and nested `.replace`, `.c`).

**What Jess does wrong:**

1. **Wrong first-rule output:** We emit `.replace, .c, .rep_ace, .effected { ... }` instead of the `:is(...) :is(.replace, .c), .rep_ace` form. So exact extend isn’t producing the right selector shape / `:is()`.
2. **Wrong merge of .effected:** We merge `.effected` into the first rule even though `&:extend(.c)` (exact) should not match anything in that rule (no “all”).

---

## 3. Why we thought extend-exact was passing

- **all-less** (Less test-data): one `it()` per Less file; the one for `tests-unit/extend-exact/extend-exact.less` **fails** (always did; not caused by removing logging).
- **Core fixture test “2”** (`extend-less-fixtures.test.ts`): **passes** but uses the **wrong** extend for `.rep_ace` — `ExtendFlag.All` instead of `ExtendFlag.Exact`. So it was asserting extend-all behavior, not the real extend-exact first rule.
- **Core fixture test “2a”** is the **canonical** case: same first rule + `.rep_ace:extend(.replace.replace .replace)` with **Exact**, and we added `.effected { &:extend(.c) }` to lock in “exact extend must not merge .effected into this rule.” **2a has never passed**; it fails with the same wrong output as all-less.

---

## 4. Canonical test and files

| What | Where |
|------|--------|
| **Canonical fixture test** | `packages/core/src/tree/__tests__/extend-less-fixtures.test.ts` — test **2a** (title: “2a. extend-exact ISOLATED – replace + rep_ace only (first rule); .effected &:extend(.c) must not apply”) |
| **Input it models** | `.replace.replace`, `.c.replace + .replace { .replace, .c { prop: copy-paste-replace } }; .rep_ace:extend(.replace.replace .replace) {}; .effected { &:extend(.c); } |
| **Expected** | First rule: `:is(.replace.replace, .c.replace + .replace) :is(.replace, .c), .rep_ace { ... }` then `.effected { }`. Assertion that the first rule block does not contain `.effected`. |
| **Extend logic** | `packages/core/src/tree/util/` — extend.ts, extend-roots.ts, selector-match-core.ts (findExtendableLocations, tryFastPathExtendMatch, processExtends, :is() materialization). |

Run 2a only:

```bash
pnpm --filter @jesscss/core build
pnpm --filter @jesscss/core test -- --run extend-less-fixtures -t "2a"
```

---

## 5. What to do next

1. **Fix exact-extend first rule:** So we output `:is(.replace.replace, .c.replace + .replace) :is(.replace, .c), .rep_ace { ... }` instead of `.replace, .c, .rep_ace, .effected { ... }`. That’s the :is() / exact-match path in extend (selector-match-core, extend-roots, processExtends).
2. **Fix exact-extend “no all” semantics:** So `&:extend(.c)` does **not** merge `.effected` into the first rule (only merge where there is an exact match of `.c`). Likely in how we decide which rulesets get which extendees (exact vs all).
3. **Re-run 2a and all-less extend-exact:** After fixes, 2a should pass and `tests-unit/extend-exact/extend-exact.less` in all-less should match `extend-exact.css`.

Use **2a** as the single source of truth for “replace + rep_ace exact extend and .effected must not apply there.”
