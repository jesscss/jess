# Handoff: Extend / implicit ampersand bug (for new LLM chat)

## Problem (one sentence)

A nested ruleset whose selector was **not extended** is nonetheless serialized with its implicit ampersand **visible** as `:is(.b, .a) .a, :is(.b, .a) .c` instead of staying **invisible** and outputting `.a, .c`.

## Rules you must follow

1. **Do not invent new extend rules.** The single source of truth is `packages/core/src/tree/util/EXTEND_RULES.md`. All matching is equivalency-based (§0); do not add new "only match when…" or "skip when…" conditions unless they follow from that doc.
2. **Do not assume the bug is "we need to skip nested rulesets" or "filter the match set."** The intended behavior is: if a selector is **not matched** by extend, we never overwrite it; if we never overwrite it, the invisible ampersand stays invisible at serialization. The bug may be (a) we are incorrectly treating it as matched and overwriting it, or (b) we are not overwriting it but something else is making the ampersand visible when serializing. Let evidence decide.
3. **Validate with the exact test and snippets below.** Use the provided input/output to confirm any fix.

---

## Validation: test and I/O

**Test to run (from repo root):**
```bash
cd packages/core && pnpm test -- --run extend-less-fixtures -t "2. extend-exact"
```

**Relevant test:** `extend-less-fixtures.test.ts`, test name: `"2. extend-exact.less – :is() form and .effected merged with .a, .b, .c"`.

**Setup (conceptual):**
- `collapseNesting: false`.
- One ruleset has selector `.c, .a` and **nested** inside it: a ruleset with selector `.b, .a`, and inside that a ruleset with selector **`.a, .c`** and one declaration `prop: not_effected`.
- A **different** ruleset (selector `.effected`) contains `extend .a`, `extend .b`, `extend .c` (targets `.a`, `.b`, `.c`).

So the **`.a, .c`** block is nested under `.c, .a` → `.b, .a`; it has an **implicit** ampersand (parent context). That ruleset’s selector is **not** the one that carries the extend.

**Expected output (excerpt):**
```css
.c,
.a,
.effected {
  .b,
  .a {
    .a,
    .c {
      prop: not_effected;
    }
  }
}
```

**Actual output (excerpt):**
```css
.c,
.a,
.effected {
  .b,
  .a {
    :is(.b, .a) .a,
    :is(.b, .a) .c {
      prop: not_effected;
    }
  }
}
```

So the **validation criterion** is: the inner block must serialize as **`.a,\n    .c {`** (implicit ampersand stays invisible), **not** as **`:is(.b, .a) .a,\n    :is(.b, .a) .c {`**.

---

## Relevant code (for tracing only)

- **Serialization:** `Ruleset.getHeaderString` → `ensureSelectorVisible` → `renderSelector.toString()`. `ComplexSelector.toTrimmedString` skips components with `F_IMPLICIT_AMPERSAND` and the following space combinator. So if the selector still has an implicit ampersand, it should not render as `:is(...)`.
- **Where selector can be replaced:** `extend-roots.ts`: `ruleset.value.selector = normalizedSelector` (phase 1 and phase 2). If that runs for the `.a, .c` ruleset, the stored selector becomes the extended/materialized form and the ampersand is no longer implicit.
- **How rulesets are chosen for extend:** `extend-roots.ts` around 1605–1665: scan over roots, for each ruleset check `sel.valueOf() === targetValue` or `findExtendableLocations(...).hasMatches`. That determines which rulesets get passed to the code that does `tryExtendSelector` and then `ruleset.value.selector = normalizedSelector`.
- **Ampersand visibility:** `ensureSelectorVisible` in `extend-roots.ts` and `ruleset.ts`: must not add `F_VISIBLE` to nodes with `F_IMPLICIT_AMPERSAND` and must not recurse into them (so the ampersand’s stored `:is(...)` is never surfaced). See EXTEND_RULES.md §5 (ampersand).

Use these only to trace where the `.a, .c` ruleset’s selector is (or isn’t) modified and how it’s serialized; do not invent new “when” rules.

---

## What to do

1. Run the test above and confirm failure with the exact expected vs actual snippets.
2. Trace **whether** the `.a, .c` ruleset’s selector is ever overwritten by extend (e.g. by logging or a temporary assert in `extend-roots.ts` where `ruleset.value.selector = normalizedSelector` is set).
3. If it is overwritten: determine **why** that ruleset was considered a match and why overwriting it violates EXTEND_RULES.md (equivalency, §5 ampersand, etc.).
4. If it is **not** overwritten: trace why serialization shows `:is(.b, .a) .a` (e.g. is the wrong selector used at serialization time, or is the implicit ampersand being materialized somewhere else?).
5. Propose a minimal change that fits EXTEND_RULES.md and re-run the test until the expected excerpt matches.

---

## What not to do

- Do not add new “only match when selector list item equals find” or “skip when nested under another match” or “don’t overwrite when selector has implicit ampersand” logic without tying it explicitly to EXTEND_RULES.md.
- Do not assume the fix is “filter the match set” or “skip nested rulesets”; the issue may be matching policy, or serialization path, or both.
- Do not use `console.log` in tests; use `syncLog()` (see project rules).
