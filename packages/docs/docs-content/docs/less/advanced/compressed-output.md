---
title: "Compressed Output (compress)"
slug: "/advanced/compressed-output"
audiences:
  - less
origin: less
---

> `compress: true` emits minified CSS: all non-significant whitespace removed and
> every value written in its shortest still-valid form. Jess's compressed output
> is a **superset** of what Less 4.x and dart-sass (`compressed`) each produce —
> it applies every safe fold either tool does, plus a few trivial ones common to
> other minifiers — and never a transform that could change what the CSS *means*.

## Enabling it

```ts
render(source, { output: { compress: true } })
```

`compress` is orthogonal to [`collapseNesting`](/advanced/output-model): nesting
decides *placement* (whether a nested block bubbles out of its parent), `compress`
decides *spelling* (how the emitted bytes are written). Both can be set together.

## Principle

Two rules govern what is in scope:

1. **Safe only.** A compress transform may change bytes but never meaning: the
   compressed stylesheet must parse to the same cascade, the same declarations in
   the same order, and the same computed values as the pretty-printed one.
   Whitespace, comments, and the shortest-form spelling of a value are byte-level;
   merging rules, reordering, or dropping "redundant" declarations are not — those
   are a separate *optimization* concern and are **out of scope** (see
   [Non-goals](#non-goals)).
2. **Shortest valid form wins.** Where Less 4.x and dart-sass disagree on a byte,
   Jess takes the shorter form that is still valid in that context. Each such call
   is recorded below.

Compressed output stays fully **source-map-compatible**: the emitter records
mappings from output offsets regardless of the bytes it writes, so a compressed
render produces a correct [source map](/usage/sourcemaps) — this is why source-map
support was built before compression.

## Structural transforms (whitespace & layout)

| Transform | Pretty | Compressed |
| --- | --- | --- |
| Indentation | `  color: red;` | *(removed)* |
| Block open | `.a {\n` | `.a{` |
| Between declarations | `red;\n  ` | `red;` |
| Last declaration's `;` | `red;\n}` | `red}` |
| Block close | `\n}` | `}` |
| Selector list join | `.a,\n.b {` | `.a,.b{` |
| After `:` in a declaration | `color: red` | `color:red` |
| Combinator spacing | `.a > .b`, `.a + .b`, `.a ~ .b` | `.a>.b`, `.a+.b`, `.a~.b` |
| At-rule prelude | `@media (min-width: 40em)` | `@media(min-width:40em)` |
| Value-list comma | `1px, 2px` | `1px,2px` |
| Empty rule (`.a {}`) | `.a {\n}` | *(removed)* |

Space-separated value lists keep exactly one space (the space *is* the separator —
`margin: 1px 2px` cannot lose it).

## Comments

All comments are removed **except** "bang" comments (`/*! … */`), which are
preserved for license headers — matching Less 4.x, dart-sass, cssnano, and
lightningcss. `//` line comments are already trivia and never reach output.

## Value shortening

| Value | Pretty | Compressed | Notes |
| --- | --- | --- | --- |
| Foldable hex | `#ffffff`, `#ffffffff` | `#fff`, `#ffff` | 6→3 and 8→4 (`#rrggbbaa`→`#rgba`) when each channel's pair is equal |
| Color → shortest name/hex | `#ff0000` | `red` | a value CLASSIFIED as a color prints as whichever is shorter, its folded hex or a named color (`#ff0000`→`red`, `#ffffff`→`#fff`) |
| Leading zero | `0.5`, `-0.5` | `.5`, `-.5` | |
| Trailing zeros | `1.50px` | `1.5px` | already applied to computed numbers; compress extends it to authored literals |

Function-form colors (`rgb()`/`hsl()`/`hwb()`/…) are **not** rewritten to hex —
`rgb(255,0,0)` stays `rgb(255,0,0)` (whitespace-tightened only). Converting a
color between representations is a lossy-of-intent optimization that belongs
behind a finer-grained option, not the default `compress`.

**An authored bare color keyword is left verbatim** — `color: white` stays
`white`. Every fold is driven by the value's **classification**: `#ffffff` is a
`Color`, `0.5px` is a `Dimension`, but a bare `white` is a `Keyword`. Knowing
whether that `Keyword` is a *color* (`color: white`) or an *identifier*
(`animation-name: white`, `font-family: white`, `counter-reset: white 0`) would
require a per-property value grammar that jess deliberately does not consult, so
`compress` never folds a keyword — it can't be done without guessing the
property, and guessing wrong would corrupt the value. Only a value already
classified as a color folds (and it folds to the shortest of hex/name).

**Zero units are kept** (`0px` stays `0px`, `0s` stays `0s`). A unitless `0` is
valid only as a `<length>` — and not even inside `calc()` (the unit types the
operand) — while `<time>`/`<angle>`/`<percentage>`/`<frequency>`/`<resolution>`
have no unitless-zero production at all (`transition-duration: 0` is invalid;
`hsl(0 0% 0%)` is not `hsl(0 0 0)`). Rather than special-case the one safe
context, Jess keeps every unit for consistency and correctness — the trade is two
bytes on a length zero.

Jess normally preserves an **authored** literal verbatim (see
[Verbatim values](/advanced/verbatim-values)); `compress` is the one mode that
re-spells authored literals into their shortest equivalent.

## Conflict resolutions

Where Less 4.x and dart-sass differ, and Jess's call (per the *shortest valid form*
rule):

| Case | Less 4.x | dart-sass `compressed` | Jess |
| --- | --- | --- | --- |
| Zero units (`0px`, `0s`, `0%`) | drops the unit on zero **lengths** → `0` | keeps every unit | **keeps every unit** (match dart-sass) — unitless `0` is valid only as a `<length>`, and not inside `calc()`; the drop needs context analysis to stay correct and saves two bytes, so Jess doesn't do it. |
| `!important` spacing | ` !important` | `!important` | **`!important`** — no leading space; valid and shorter. |
| Colors, name vs hex | never swaps | shortest of name/hex | **shortest of {name, hex} on a value already CLASSIFIED as a color** — `#ff0000`→`red`, `#ffffff`→`#fff`. See the note below on why an authored bare keyword is left alone. |
| `@media (` tightening | keeps the space | removes it | **remove** — `@media(…)`/`@supports(…)` parse without the space. |

## Extra folds (other minifiers)

Trivial, always-safe folds also emitted by cssnano / lightningcss / esbuild and
folded in here: leading/trailing-zero trimming, foldable-hex shortening, and
bang-comment preservation (all above). Anything beyond a local, context-free byte
rewrite is deliberately excluded — including the zero-unit drop (not context-free,
see conflicts) and color-representation conversion (`rgb()`→hex), which is a
separate finer-grained option, not part of `compress`.

## Non-goals

These change structure or risk the cascade and are **not** part of `compress`
(some may land later behind a distinct *optimize* flag):

- Merging or deduplicating rules, selectors, or declarations.
- Reordering declarations or rules.
- Longhand ↔ shorthand rewriting (`margin: 0 0 0 0` → `margin: 0`).
- Color-representation conversion (`rgb()`/`hsl()` → hex) — a future
  finer-grained option; `compress` only shortens a value already classified as a
  color (hex fold; shortest of hex/name).
- Folding a color **keyword** (`color: white` → `#fff`) — a firm non-goal, not a
  deferral. A bare keyword can only be recognized as a color from its property's
  value grammar (`color` vs `animation-name`/`font-family`), and jess does not
  consult a per-property table; folding it without one would corrupt non-color
  uses of the same word. `white` stays `white`.
- Dropping the unit on a zero value (`0px` → `0`) — not context-free.
- `calc()` simplification / constant folding of authored expressions.
- `@media` query merging — Jess never merges media queries regardless of
  `compress` (see [output model](/advanced/output-model)); nested conditional
  group rules are valid CSS.

Everything a compress pass does is a local, reversible-in-meaning byte rewrite;
nothing it does depends on, or alters, the cascade.
