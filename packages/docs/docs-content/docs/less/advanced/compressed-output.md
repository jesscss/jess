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
| Foldable hex | `#ffffff` | `#fff` | 6→3 when each channel's pair is equal |
| Named ↔ hex | `white` | `#fff` | shortest of the two (see conflicts) |
| Leading zero | `0.5`, `-0.5` | `.5`, `-.5` | |
| Trailing zeros | `1.50px` | `1.5px` | already applied to computed numbers; compress extends it to authored literals |
| Zero length | `0px`, `0rem` | `0` | length units only (see conflicts) |
| Opaque `rgb()`/`hsl()` | `rgb(255, 0, 0)` | `#f00` | fold to the shortest color spelling |

Jess normally preserves an **authored** literal verbatim (see
[Verbatim values](/advanced/verbatim-values)); `compress` is the one mode that
re-spells authored literals into their shortest equivalent.

## Conflict resolutions

Where Less 4.x and dart-sass differ, and Jess's call (per the *shortest valid form*
rule):

| Case | Less 4.x | dart-sass `compressed` | Jess |
| --- | --- | --- | --- |
| Zero **length** (`0px`) | drops unit → `0` | keeps `0px` | **`0`** — shorter, and `0` is a valid `<length>`. Non-length zero units (`0s`, `0deg`, `0%`, `0fr`) are **kept**, because the unit changes the type and `0%` inside `hsl()`/gradients is semantically required. |
| `!important` spacing | ` !important` | `!important` | **`!important`** — no leading space; valid and shorter. |
| Named colors vs hex | never swaps | shortest of name/hex | **shortest of {name, hex}** — `white`→`#fff`, but `red` stays `red` (`< #f00`); ties keep the keyword. |
| `@media (` tightening | keeps the space | removes it | **remove** — `@media(…)`/`@supports(…)` parse without the space. |

## Extra folds (other minifiers)

Trivial, always-safe folds also emitted by cssnano / lightningcss / esbuild and
folded in here: unitless zero, leading/trailing-zero trimming, `rgb()/hsl()`→hex,
and bang-comment preservation (all above). Anything beyond a local, context-free
byte rewrite is deliberately excluded.

## Non-goals

These change structure or risk the cascade and are **not** part of `compress`
(some may land later behind a distinct *optimize* flag):

- Merging or deduplicating rules, selectors, or declarations.
- Reordering declarations or rules.
- Longhand ↔ shorthand rewriting (`margin: 0 0 0 0` → `margin: 0`).
- `calc()` simplification / constant folding of authored expressions.
- `@media` query merging — Jess never merges media queries regardless of
  `compress` (see [output model](/advanced/output-model)); nested conditional
  group rules are valid CSS.

Everything a compress pass does is a local, reversible-in-meaning byte rewrite;
nothing it does depends on, or alters, the cascade.
