# Benchmark extend-fold "correct expected output" — evidence vs real Less 4.x

**Question under test (from a prior agent, previously UNVERIFIED):**
> "For benchmark's extend shapes, jess-eval is buggy and jess-spine is correct."

This document adjudicates that claim against the **parity reference: real Less 4.x**,
per case, with reproducible inputs. It does **not** change any ratchet or gate.

## Method / provenance (so every line is checkable)

- **Real Less 4.x** = a clean `npm i less@4.6.7` (bin `lessc`), run on each repro
  `.less` file. Version confirmed `4.6.7`. (The `~/git/worktrees/less.js/less-4x`
  checkout is also `v4.6.7-2-g8e3504d5`; the clean npm install was used for the
  numbers below to avoid any local-build drift. `~/git/oss/less.js` was never touched.)
- **jess-eval** = the eval render path, forced by passing `preSerializeRoot: r => r`
  to the render (the spine gate requires `!preSerializeRoot`; identity hook pins eval).
  This is the same technique the in-repo `emit-render-probe.test.ts` uses.
- **jess-spine** = default routing: `isSpineEligibleRoot` decides; a spine-eligible
  extend shape folds through `renderRootViaSpine`. Verified to equal the **production
  `Compiler`** output (no pre-render visitor ⇒ spine engaged) for the routed cases.
- Unless noted, jess is rendered with `collapseNesting: true` (**flat**) to compare
  apples-to-apples with Less 4.x, which only ever emits flat CSS. Where it matters,
  the v5-default `collapseNesting: false` (**nested**) output is shown too.
- Repro inputs live in this doc verbatim; they are faithful reductions of
  `packages/jess/benchmark/benchmark.less`. For case 5, property *bodies* were
  simplified (the original uses cross-file mixins/vars) but every `.panel`-containing
  **selector** is preserved verbatim — only selector shape drives extend matching.

**Note on the benchmark's own expected `.css`:** `packages/jess/benchmark/benchmark.css` is a
2-line stub (no committed extend expected output), and the two `@import` targets
(`benchmark-import-reference-target.less`, `benchmark-import-target.less`) are **empty
files** on `origin/dev`. So there is no pre-existing expected output to defend — the corrected
output below is derived fresh from Less 4.x.

---

## Case 1 — nested extender

**INPUT** (`packages/jess/benchmark/benchmark.less` ~4369, ~4384):
```less
.typography-base {
  font-family: sans-serif;
  line-height: 1.6;
}
.prose {
  p:extend(.typography-base) {
    margin-bottom: 1em;
  }
}
```

| REAL Less 4.6.7 | jess-eval | jess-spine (= production) |
|---|---|---|
| `.typography-base,`<br>`.prose p { … }`<br>`.prose p { margin-bottom: 1em }` | `.typography-base,`<br>**`p`** ` { … }`<br>`.prose p { margin-bottom: 1em }` | `.typography-base,`<br>`.prose p { … }`<br>`.prose p { margin-bottom: 1em }` |

**Verdict: Less 4.x sides with SPINE. Eval is buggy.**
The nested extender must compose to `.prose p`. Eval emits the **bare fragment `p`**
(over-matches every `<p>`); spine emits the composed `.prose p`, byte-identical to Less
4.x. This is the exact bug `emit-render-probe.test.ts` pins. **Production already routes
this through the correct spine path.** Claim TRUE for this case.

---

## Case 2 — chained extend

**INPUT** (~4369, ~4373, ~4377–4378):
```less
.typography-base { font-family: sans-serif; line-height: 1.6; }
.heading-base:extend(.typography-base) { font-weight: bold; margin-bottom: 0.5em; }
h1:extend(.heading-base) { font-size: 2.5em; }
h2:extend(.heading-base) { font-size: 2em; }
```

| REAL Less 4.6.7 | jess-eval | jess-spine |
|---|---|---|
| `.typography-base, .heading-base, h1, h2 { … }`<br>`.heading-base, h1, h2 { font-weight… }`<br>`h1 { font-size: 2.5em }`<br>`h2 { font-size: 2em }` | *identical* | *identical* |

**Verdict: ALL THREE AGREE — both jess paths correct.**
Note the (correct) Less behavior: because `.heading-base` is itself extended into the
`.typography-base` group, `h1`/`h2` (extending `.heading-base`) transitively land in the
typography group too. Both jess paths reproduce this exactly. Claim N/A (no divergence).

---

## Case 3 — element-name self-extend inside `.prose`

**INPUT** (~4369–4382, ~4384–4387):
```less
.typography-base { font-family: sans-serif; line-height: 1.6; }
.heading-base:extend(.typography-base) { font-weight: bold; margin-bottom: 0.5em; }
h1:extend(.heading-base) { font-size: 2.5em; }
h2:extend(.heading-base) { font-size: 2em; }
.prose {
  h1:extend(h1) {}
  h2:extend(h2) {}
}
```

| REAL Less 4.6.7 | jess-eval | jess-spine (flat AND nested) |
|---|---|---|
| `.typography-base, .heading-base, h1, h2,`<br>**`.prose h1, .prose h2`** ` { … }`<br>`.heading-base, h1, h2,`<br>**`.prose h1, .prose h2`** ` { font-weight… }`<br>`h1,` **`.prose h1`** ` { font-size:2.5em }`<br>`h2,` **`.prose h2`** ` { font-size:2em }` | `.typography-base, .heading-base, h1, h2 { … }`<br>`.heading-base, h1, h2 { … }`<br>`h1 { … }`<br>`h2 { … }`<br>*(no `.prose h1/.prose h2` anywhere)* | *identical to eval — no `.prose h1/.prose h2`* |

**Verdict: Less 4.x agrees with NEITHER — both jess paths are buggy.**
Less 4.x adds `.prose h1` / `.prose h2` everywhere `h1`/`h2` appear (the nested
element-name self-extend). **Both** jess paths silently **drop** the nested
element-name self-extend — confirmed in flat *and* v5-default nested mode, eval *and*
spine. Claim FALSE (spine is not "correct" here). **NEW bug flagged**, independent of
the eval-vs-spine question: nested `el:extend(el) {}` contributes nothing in jess.

---

## Case 4 — extend over `@import (reference)` target

**INPUT** (~3987, ~4042):
```less
@import (reference) "benchmark-import-reference-target.less";   // EMPTY file
.my-grid:extend(.ref-grid-system all) {}
```

| REAL Less 4.6.7 | jess-eval | jess-spine (= `Compiler`) |
|---|---|---|
| `WARNING: extend ' .ref-grid-system' has no matches` — **empty output** | **empty** | **empty** |

**Verdict: ALL THREE AGREE (empty).**
The benchmark's reference target is an **empty file**, so `.ref-grid-system` is never
defined and the extend matches nothing; `.my-grid` has an empty body ⇒ no output. Claim
N/A (there is nothing to fold). Control checks confirm the machinery, not just the empty
edge:
- *No target present* (`.my-grid:extend(.ref-grid-system all) {}` alone): Less 4.x =
  warning + empty; jess-eval = empty; jess-spine = empty. **Agree.**
- *Target present* (`.ref-grid-system { display:grid; gap:10px } .my-grid:extend(.ref-grid-system all) {}`):
  Less 4.x = `.ref-grid-system, .my-grid { display:grid; gap:10px }`; jess-eval and
  jess-spine both **identical**. **Agree.**

---

## Case 5 — panel `all`-extend across scattered `div.panel` occurrences

`.card`/`.widget` `&:extend(.panel all)` matches **every** selector containing `.panel` —
not just the local class-based `.panel` block (~4045) but the scattered `div.panel …`
rules earlier in the file (~459, 529, 530, 531, 540). Faithful repro (selectors verbatim;
property bodies simplified):

**INPUT** (`case5-panel-all.less`):
```less
.panel {
  border: 1px solid #ddd;
  border-radius: 4px;
  .panel-heading { padding: 10px 15px; background: #f5f5f5; border-bottom: 1px solid #ddd; }
  .panel-body { padding: 15px; }
  .panel-footer { padding: 10px 15px; background: #f5f5f5; border-top: 1px solid #ddd; }
}
div.panel {
  margin: 0 0 20px;
  > div.header  { padding: 5px; }
  > div.content { padding: 10px; }
  > div.footer  { padding: 4px; }
}
div.panel.no_footer div.content { border-bottom-left-radius: 3px; }
div.panel.no_header div.content { border-top-left-radius: 3px; }
div.panel.collapsable { div.header { cursor: pointer; } }
div.panel.collapsed  { div.content, div.footer { display: none; } }
.card   { &:extend(.panel all); box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.widget { &:extend(.panel all); margin-bottom: 20px; }
```

### 5a — flat (`collapseNesting: true`), for Less 4.x parity

| REAL Less 4.6.7 | jess-eval (flat) | jess-spine (flat = production-flat) |
|---|---|---|
| `.panel, .card, .widget { border… }` | `.panel, .card, .widget { border… }` | `.panel, .card, .widget { border… }` |
| `.panel .panel-heading,`<br>`.card .panel-heading,`<br>`.widget .panel-heading { … }` | `:is(.panel, .card, .widget) .panel-heading { … }` | `:is(.panel, .card, .widget) .panel-heading { … }` |
| `div.panel > div.header,`<br>`div.card > div.header,`<br>`div.widget > div.header { padding:5px }` | `div:is(.panel, .card, .widget) > div.header { padding:5px }` | **`div.panel > div.header,`<br>`.card,`<br>`.widget { padding:5px }`  ← BROKEN** |
| `div.panel.collapsable div.header,`<br>`div.card.collapsable div.header,`<br>`div.widget.collapsable div.header { cursor:pointer }` | `div:is(.panel, .card, .widget).collapsable div.header { … }` | **`div.panel.collapsable div.header,`<br>`.card,`<br>`.widget { … }`  ← BROKEN** |
| `div.panel.collapsed div.content, … div.footer,`<br>`div.card.collapsed …, div.widget.collapsed … { display:none }` | `div:is(.panel, .card, .widget).collapsed :is(div.content, div.footer) { … }` | **`div.panel.collapsed :is(div.content, div.footer),`<br>`.card,`<br>`.widget { … }`  ← BROKEN** |
| `div.panel.no_footer div.content, div.card…, div.widget… { … }` | `div:is(.panel, .card, .widget).no_footer div.content { … }` | `div:is(.panel, .card, .widget).no_footer div.content { … }` (correct) |

(`> div.content` / `> div.footer` behave like `> div.header`: eval correct via `:is()`,
spine emits bare `.card`/`.widget`.)

**Verdict (flat): the claim is REVERSED — jess-EVAL is correct, jess-SPINE is BROKEN.**
- **eval** compacts each extended group with `:is()` — e.g. `div:is(.panel, .card, .widget) > div.header`. `:is()` here holds only same-specificity class args, so it is **semantically identical** to Less 4.x's expansion (specificity-preserving). Correct.
- **spine (flat)** emits **bare extending-selector fragments** — `div.panel > div.header, .card, .widget` — dropping the `div` prefix and the `> div.header` context. This both over-matches (`.card` anywhere) and under-matches (never `div.card > div.header`). **Wrong.**

### 5b — nested (`collapseNesting: false`, the **v5 default**)

In v5-default nested mode the spine output is **CORRECT**:
```less
div:is(.panel, .card, .widget) {
  margin: 0 0 20px;
  > div.header  { padding: 5px; }
  > div.content { padding: 10px; }
  > div.footer  { padding: 4px; }
}
div:is(.panel, .card, .widget).collapsable { div.header { cursor: pointer; } }
div:is(.panel, .card, .widget).collapsed  { div.content, div.footer { display: none; } }
.panel, .card, .widget { … .panel-heading { … } … }
```
i.e. the spine's extend **fold** is correct; only the **flatten** step
(`collapseNesting: true`) of an extended-and-nested group corrupts the child/descendant
rows into bare fragments.

**Verdict (case 5 overall):** The spine's extend fold is correct in the v5-default
(nested) representation and matches Less 4.x semantically. The `collapseNesting: true`
flatten path has a **spine×flatten bug** that produces bare `.card`/`.widget` fragments
for extended groups carrying combinators/descendants; on that flat path **eval is the
correct one**. So "spine correct / eval buggy" is FALSE for this case as stated.

---

## Bottom line — is "eval buggy / spine correct" TRUE?

**Not globally.** Per case, against real Less 4.6.7:

| Case | Less 4.x sides with | Prior claim holds? |
|---|---|---|
| 1 — nested extender | **spine** (eval emits bare `p`) | **TRUE** (and production already uses spine) |
| 2 — chained | both (identical) | N/A — no divergence, both correct |
| 3 — element-name self-extend | **neither** (both drop `.prose h1/h2`) | **FALSE** — both buggy (new bug) |
| 4 — reference-import (empty target) | all three (empty) | N/A — nothing to fold; controls agree |
| 5 — panel `all`-extend | nested: **spine**; flat: **eval** | **FALSE / reversed** in flat mode (spine breaks under flatten) |

### Actionable flags for the owner
1. **Case 1** validates the spine extend-fold and the eval bare-fragment bug — production
   is already on the correct (spine) path. If any expected output is written for this section, use
   the Less-4.x form below.
2. **Case 3** is an **un-fixed bug in BOTH paths**: nested `el:extend(el) {}` contributes
   nothing; Less 4.x adds `.prose h1`/`.prose h2`. Independent of the cutover.
3. **Case 5** exposes a **`collapseNesting: true` × spine-extend flatten bug** (bare
   `.card`/`.widget` fragments). The fold itself is right (nested output correct); the
   flattener mishandles extended groups with combinators. If the benchmark is ever
   rendered flat, this is a live spine regression vs both Less 4.x and jess-eval.
4. **`:is()` vs expansion** (case 5, eval + nested-spine) is an **owner call**: jess emits
   `:is(.panel, .card, .widget)`; Less 4.x expands. They are semantically equivalent here
   (same-specificity class args). Decide whether the v5 expected output standardizes on `:is()`.

### Proposed corrected expected output (derived from Less 4.6.7), where Less 4.x confirms jess

**Case 1** (Less 4.x, flat — spine already matches this):
```css
.typography-base,
.prose p {
  font-family: sans-serif;
  line-height: 1.6;
}
.prose p {
  margin-bottom: 1em;
}
```

**Case 5** (Less 4.6.7 flat = the parity expected output; jess-eval reproduces it semantically via
`:is()`, and nested-spine reproduces it in v5-default form):
```css
.panel, .card, .widget { border: 1px solid #ddd; border-radius: 4px; }
.panel .panel-heading, .card .panel-heading, .widget .panel-heading {
  padding: 10px 15px; background: #f5f5f5; border-bottom: 1px solid #ddd; }
.panel .panel-body,  .card .panel-body,  .widget .panel-body  { padding: 15px; }
.panel .panel-footer,.card .panel-footer,.widget .panel-footer{
  padding: 10px 15px; background: #f5f5f5; border-top: 1px solid #ddd; }
div.panel,          div.card,          div.widget          { margin: 0 0 20px; }
div.panel > div.header,  div.card > div.header,  div.widget > div.header  { padding: 5px; }
div.panel > div.content, div.card > div.content, div.widget > div.content { padding: 10px; }
div.panel > div.footer,  div.card > div.footer,  div.widget > div.footer  { padding: 4px; }
div.panel.no_footer div.content, div.card.no_footer div.content, div.widget.no_footer div.content { border-bottom-left-radius: 3px; }
div.panel.no_header div.content, div.card.no_header div.content, div.widget.no_header div.content { border-top-left-radius: 3px; }
div.panel.collapsable div.header, div.card.collapsable div.header, div.widget.collapsable div.header { cursor: pointer; }
div.panel.collapsed div.content, div.panel.collapsed div.footer,
div.card.collapsed div.content,  div.card.collapsed div.footer,
div.widget.collapsed div.content,div.widget.collapsed div.footer { display: none; }
.card   { box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); }
.widget { margin-bottom: 20px; }
```

**No corrected expected output emitted for case 3** — Less 4.x sides with neither jess path, so
the fix is a code fix (make nested `el:extend(el)` contribute), not an expected-output edit. For
reference, the Less-4.x-correct case-3 output adds `.prose h1`/`.prose h2` to every
`h1`/`h2` group (shown in the case-3 table).
