---
title: "Selector Compaction (`:is()` Nesting)"
slug: "/advanced/selector-compaction"
audiences:
  - less
origin: less
---

> When a `&`-less nested rule collapses onto its accumulated ancestor, Less 5.x
> factors the common ancestor out **once** and wraps each multi-branch side in a
> single `:is(...)` — instead of repeating the whole prefix or cartesian-expanding
> it into one row per combination.

This is the *nesting-collapse* form of `:is()` compaction. It is distinct from the
[extend `all` wrapping](./extend-is-wrapping.md), which grafts `:is()` into a matched
compound. Here the rule is about how a descendant block joins onto the selector it
is nested inside.

:::info Mode
The examples below show the **`collapseNesting: 'compact'`** flatten style, which folds
every multi-branch **child** list into a single `:is(…)`. The default flatten,
**`'native'`**, keeps the parent `:is()` and folds a child list only where the fold
cannot change specificity or matching — see
[`'native'`: fold only what keeps native specificity](#native-fold-only-what-keeps-native-specificity).
Every example below whose child branches are single compounds of equal specificity
(`.c, .d`) prints the same under both. `false` (the overall default) preserves authored
nesting and emits no `:is()`.
:::

## The rule

Joining a nested `&`-less descendant `B` onto its ancestor `A` emits:

```
<A> <combinator> render(B)
```

where **each side** wraps in a single `:is(...)` **only if it is a multi-branch
comma list** (a single selector joins plainly). The ancestor `A` is emitted
**once**, as one opaque unit — never repeated inside the child's `:is()`, never
cartesian-distributed.

| Input | Output |
|---|---|
| `.a, .b { .c {…} }` | `:is(.a, .b) .c {…}` |
| `.a { .c, .d {…} }` | `.a :is(.c, .d) {…}` |
| `.a, .b { .c, .d {…} }` | `:is(.a, .b) :is(.c, .d) {…}` — one row |
| `.a, .b { & .c {…} }` | `.a .c, .b .c {…}` — `&` nesting cartesian-expands |
| `.a, .b {…}` | `.a, .b {…}` — a rule's own header stays a plain list |

Two things to internalize:

- **`&`-less descendant** → factored `:is()` join (the rows above).
- **`&`-based** child is a *different* path: each `&` substitutes over the full
  cartesian ancestor list (no `:is()`), producing one selector per combination.

## Worked example

A deeply-nested block factors its prefix instead of exploding combinatorially:

```less
#first #deux {
  #fourth, #five, #six {
    .seven, .eight > #nine { margin: 0; }
    #ten { padding: 0; }
  }
}
```

```css
#first #deux :is(#fourth, #five, #six) :is(.seven, .eight > #nine) {
  margin: 0;
}
#first #deux :is(#fourth, #five, #six) #ten {
  padding: 0;
}
```

The common ancestor `#first #deux :is(#fourth, #five, #six)` is written once per
child rule. Without compaction this would be `3 × 2 = 6` selectors for the first
rule alone; with it, each rule stays a single row.

## Why it differs from Less 4.x

Less 4.x fully expanded nested selector lists into a cartesian cascade — one rule per
combination. Less 5.x keeps output nested and compact: the prefix is factored so a
deep multi-selector block stays one row per rule instead of a combinatorial
explosion, matching how modern CSS engines evaluate `:is()`.

## Specificity and `:is()` grouping (nesting & extend)

Folding branches into `:is(...)` — whether from the nesting collapse above or from
[extend's `all` grafting](./extend-is-wrapping.md) — changes how a browser scores the
selector, because `:is()` does **not** score as zero. Per the CSS spec, *the
specificity of an `:is()` is the specificity of its most specific argument*
([Selectors Level 4 — specificity](https://www.w3.org/TR/selectors-4/#specificity-rules)).

So when a low-specificity branch is grouped with a high-specificity one, the whole
group scores at the **maximum** — and every branch inside it inherits that score:

- `:is(.a, #b)` scores as the ID `#b` — `(1,0,0)` — for *both* branches, including the
  plain-class `.a` one.

**Nesting collapse.** A multi-parent header that collapses onto a descendant carries
its group specificity into the join:

```less
.a, #b {
  .c { color: red; }
}
```

```css
:is(.a, #b) .c {
  color: red;
}
```

`:is(.a, #b)` scores `(1,0,0)`, so the whole selector scores **`(1,1,0)`** — the
`.a .c` match now carries ID-level weight it would not have on its own.

**Extend.** A partial-match extender grafts `:is(...)` into the compound (see
[Extend and `:is()` Wrapping](./extend-is-wrapping.md)), but only alongside
alternatives of the same specificity, in every output mode. An ID extender of a class
target is written as its own selector:

```less
.a > .c { color: red; }
#b:extend(.c all) {}
```

```css
.a > .c,
.a > #b {
  color: red;
}
```

### Migration note vs. Less 4.x

Less 4.x expanded the nesting case into a comma-separated cascade, each row keeping its
**own** specificity. 5.x groups a multi-parent header into one `:is()` scored at the
group maximum:

| Source | 4.x output (per-row specificity) | 5.x output |
|---|---|---|
| `.a, #b { .c {} }` | `.a .c` `(0,2,0)`, `#b .c` `(1,1,0)` | `:is(.a, #b) .c` — both `(1,1,0)` |
| `.a > .c {}` + `#b:extend(.c all)` | `.a > .c` `(0,2,0)`, `.a > #b` `(1,1,0)` | `.a > .c`, `.a > #b` — per-row, as 4.x |

When the grouped branches have **equal** specificity — the common case, e.g. all
classes (`:is(.a, .b)`) — nothing changes. The shift is observable only when branches
of **different** specificity are grouped: the lower-specificity branch inherits the
group's higher score, which can flip a close cascade that 4.x resolved per-row.

A common real-world shape is a table reset that nests several element selectors of
**different lengths** under one class:

```less
.table-borderless {
  th, td, thead th, tbody + tbody { border: 0; }
}
```

```css
.table-borderless :is(th, td, thead th, tbody + tbody) {
  border: 0;
}
```

`th` and `td` are `(0,0,1)` while `thead th` and `tbody + tbody` are `(0,0,2)`, so the
`:is()` scores `(0,0,2)` and the whole selector scores **`(0,1,2)`**. Under 4.x the
`.table-borderless th` row scored `(0,1,1)`; collapsed, it now scores `(0,1,2)`, so a
later `(0,1,1)` rule that used to override `.table-borderless th` no longer wins.
There is no `:is()`-internal fix — the score is the group maximum by definition.

This unconditional child-list fold is the **`'compact'`** flatten style. The default
flatten, **`'native'`**, folds only the part that keeps every branch's own specificity
(next section). Nested output (`collapseNesting: false`) emits no `:is()` at the join
at all.

## `'native'`: fold only what keeps native specificity

`'native'` folds a nested child list into `:is(…)` only where the result behaves
exactly like the browser's own nesting: same specificity, same matched elements, and
the same reaction to a selector the browser does not understand. Child branches share
an `:is()` when **all** of these hold:

- **Equal specificity.** Every branch in the group scores the same, so the `:is()` group
  maximum is each branch's own score. Specificity follows
  [Selectors Level 4](https://www.w3.org/TR/selectors-4/#specificity-rules): `:is()`,
  `:not()` and `:has()` score their most specific argument and `:where()` scores zero.
- **A single compound per branch.** `.a :is(.b .c)` also matches when `.a` sits
  *between* `.b` and `.c`, because an `:is()` argument is matched against the whole
  document. A branch with a combinator therefore stays distributed.
- **No pseudo-element.** `::before`, `:after` and the rest are not allowed inside
  `:is()`.
- **Only standard, widely implemented selectors.** `:is()` is forgiving: it drops
  an argument the browser does not understand and keeps the rest. A plain selector list
  is not: one unknown branch drops the whole rule. So a branch stays distributed when it
  has a vendor-prefixed pseudo-class (`:-webkit-autofill`, `:-moz-focusring`), an
  unknown one, or one not every engine implements; a namespace prefix (`svg|a`, invalid
  without its `@namespace`); or the attribute `s` flag (`[type="a" s]`, which Chromium
  does not implement).
- **No functional pseudo-class other than `:is()`, `:not()`, `:has()` and `:where()`.**
  Jess does not yet read the argument of `:nth-child()`, `:nth-of-type()`, `:lang()`,
  `:dir()` and the like, so it can neither score `:nth-child(2n of .x)` nor tell
  whether an argument is one every browser accepts (`:lang(en, fr)` is not, in
  Chromium). These branches stay distributed for now.
- **No `:scope`.** Inside `@scope`, a selector that does not mention `:scope` is
  matched inside the scope root; `.t :is(:scope, .x)` mentions it, so the `.t .x` branch
  would lose that limit.

Branches that fail a check join the ancestor on their own, and the rest still fold:

```less
.table-borderless {
  th, td, thead th, tbody + tbody { border: 0; }
}
```

```css
.table-borderless :is(th, td),
.table-borderless thead th,
.table-borderless tbody + tbody {
  border: 0;
}
```

`th` and `td` both score `(0,0,1)` and fold; `thead th` and `tbody + tbody` contain a
combinator and stay as they were. Every branch keeps the score it has in the native
nesting desugaring — `(0,1,1)` for `th`/`td`, `(0,1,2)` for the other two.

Equal-specificity branches fold even when other branches sit between them: the order
of selectors inside one rule changes neither the cascade nor specificity. Groups
appear in the order their first branch appears:

```less
.t {
  th, .x, td, .y { border: 0; }
}
```

```css
.t :is(th, td),
.t :is(.x, .y) {
  border: 0;
}
```

The same rule decides which alternatives extend's own `:is()` groups hold, in every
output mode — see
[Extend and `:is()` Wrapping](./extend-is-wrapping.md#grouping-keeps-each-selectors-specificity).

:::caution What "native" promises
`'native'` reproduces native nesting's **specificity, matching and invalid-selector
behaviour** — not its exact bytes. The browser's desugaring of `.t { th, td {} }` is
`.t th, .t td`; `'native'` may print `.t :is(th, td)`, which behaves identically.

The invalid-selector half holds in a browser that implements every pseudo-class in the
folded branches. An older browser that lacks one — `:has()` before Firefox 121, say —
drops only that branch from the `:is()`, where it would have dropped the whole rule.
:::

:::note
`collapseNesting` selects the flatten STYLE: **`false`** (default) preserves authored
nesting; **`'native'`** flattens with native nesting's specificity and matching, folding
only the child branches described above; **`'compact'`** folds every descendant child
branch into one `:is(…)` (the group-max specificity shown above). The
**parent** `:is()` (`:is(.a, #b) .c`) is emitted by BOTH `'native'` and `'compact'` —
it is the native desugaring of a multi-parent header, and its group-max specificity is
unavoidable. A parent ending with a pseudo-element is the one exception: `:is()` cannot
hold a pseudo-element, so where the child's `&` keeps it last — `&` followed only by
`:hover`, `:active`, `:focus`, `:focus-visible` or `:focus-within` — that parent is
written on its own and the other parents still share the `:is()`
(`.a::before, .b, .c { &:hover {} }` → `.a::before:hover, :is(.b, .c):hover`). Anywhere
else nothing may follow the pseudo-element, so the branch is invalid however it is
written, and the parent stays inside the `:is()`, which drops only that branch where a
plain selector list would drop the whole rule (`.a::before, .b { .e {} }` →
`:is(.a::before, .b) .e`). Extend's `:is()` grafting appears in every mode and keeps the `'native'`
guard in every mode, `'compact'` included. (`true` is a deprecated alias for
`'native'`.)
:::

See also: [Output Model](./output-model.md) ·
[Extend and `:is()` Wrapping](./extend-is-wrapping.md).
