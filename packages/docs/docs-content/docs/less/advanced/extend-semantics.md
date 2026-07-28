---
title: "Extend Semantics"
slug: "/advanced/extend-semantics"
audiences:
  - less
origin: less
---

> The full behavior of `:extend()` in Less 5.x — exact vs. `all` matching, sibling
> compaction, nested re-nesting and its flatten triggers, the fixpoint, `@media`
> scoping, and `@import (reference)` visibility. For the `:is()` grafting mechanic
> itself see [Extend and `:is()` Wrapping](./extend-is-wrapping.md); for the syntax
> reference see [Extend](../features/extend.md).

`extend` merges the selector it is attached to onto **every** selector that matches
its target, wherever that target appears in the compiled CSS. It is the inverse of a
mixin: instead of copying the target's declarations into the extender, it copies the
extender's *selector* up to the target's rule. Matching always runs against the
**compiled** selectors — after nesting and parent selectors are resolved — never
against the source text. The `:extend()` clause is stripped before output.

## Exact match (default) vs. `all`

Two matching modes, selected by the `all` keyword (spelled `!all` in 5.x):

- **Exact (default)** — matches only where the target is the *whole* compiled
  selector. The extender is **appended** to the matched rule's selector list.
- **`all` (partial)** — matches the target *wherever it appears as part of* a
  compound, and substitutes the matched span **in place**, grafting
  `:is(<matched>, <extender…>)` into the compound.

```less
.clearfix {
  *zoom: 1;
  &:after { content: ''; clear: both; }
}
.foo { &:extend(.clearfix all); color: red; }
.bar { &:extend(.clearfix all); color: blue; }
```

```css
.clearfix, .foo, .bar { *zoom: 1; }
:is(.clearfix, .foo, .bar):after { content: ''; clear: both; }
.foo { color: red; }
.bar { color: blue; }
```

Where the target is the **whole** compound (`.clearfix`), the extenders simply join
the selector list. Where the target is **part** of a compound (`.clearfix:after`),
the matched span is wrapped `:is(.clearfix, .foo, .bar):after`. See
[Extend and `:is()` Wrapping](./extend-is-wrapping.md) for the grafting rule in
depth.

## Sibling-branch compaction

Exact extenders that append rows differing in exactly **one compound** are compacted
into a single `:is(...)` at that position, rather than left as a comma list.

```less
.button { color: black; &:hover { color: inherit; } }
.submit { &:extend(.button); &:hover:extend(.button:hover) {} }
```

```css
.button, .submit { color: black; }
:is(.button, .submit):hover { color: inherit; }
```

`.button:hover, .submit:hover` share every part except the leading compound, so they
compact to `:is(.button, .submit):hover`.

Two guard rails on this compaction:

- **Single-compound rows** only merge when they share a trailing suffix. Two whole
  branches that share *nothing* (`.ext8.ext9` and `.fuu`) stay a plain comma list —
  they are never forced into an `:is()`.
- **Multi-segment (descendant-complex) rows** compact **only** when they carry a
  shared parent-composition prefix (a flattened nested rule's hoisted header). A
  top-level rule's own header keeps `.foo .bar, .foo .baz` as a comma list — 5.x
  does not `:is()`-collapse authored complex rows.

## Nested output: re-nesting and its flatten triggers

In nested output mode (the 5.x default, `collapseNesting: false`), extend does **not**
re-derive its result per nesting level. It computes the correct flat result once and
then **re-nests** it: a rule stays nested and its extend simply rewrites the local
selector in place.

**Shared-prefix strip.** A folded-in extender that shares an ancestor with its target
drops the shared levels, contributing only its own-local remainder. So an extender
`.attributes .attribute-test` folded into `.attributes [data="test"]` strips the
shared `.attributes` and surfaces as the sibling `.attribute-test`. A top-level
extender with no shared ancestor is unchanged.

```less
.error { border: 1px #f00; }
.error.intrusion { font-weight: bold; }
.intrusion .error { display: none; }
.badError { &:extend(.error all); border-width: 3px; }
```

```css
.error, .badError { border: 1px #f00; }
:is(.error, .badError).intrusion { font-weight: bold; }
.intrusion :is(.error, .badError) { display: none; }
.badError { border-width: 3px; }
```

**Flatten triggers.** Re-nesting cannot express an extend match that **crosses the
`&`** — the join between a parent context and a child-appended compound. When that
happens the rule (and its descendants) flatten to a top-level block instead. Three
triggers force a flatten:

- **A nested rule that itself carries `:extend()`.** Its extender contribution
  incorporates the parent context, so it crosses the `&`.
- **A nested rule whose parent is aliased by an `all`-extender that does *not* also
  match the child's own local compound** (a foreign parent-context alias, e.g.
  `.sidebar2:extend(.sidebar all)` reaching into `.sidebar .box`). The child's parent
  context changed under it. A *uniform* alias that also rewrites the child's own
  compound does **not** cross and stays nested.
- **A nested rule whose whole composed complex is matched exactly by an extender that
  does not descend from its parent** (a hoisted whole-complex sibling).

When there is **no** shared prefix to strip and the match does not cross the `&`, the
whole complex simply flattens. A flatten whose subject still has surviving nested
children re-nests the corrected subtree under its hoisted header rather than composing
the children flat.

## Exact extend into a rule with children

An **exact** extender cannot propagate into a target's sub-parts (only `all` does). If
the exact target has surviving nested children, the extender **splits out** to a
separate sibling rule carrying only the target's *direct* declarations (dropped if
empty) — it does not fold into the block header and leak into the children. An
`all`-extender folds into the header and does propagate to children.

## Fixpoint: chained and circular extends

Extend runs to a fixpoint — an extender's produced selector is itself a match target,
so chains resolve fully, and ordering is irrelevant (the extender may precede the
target).

```less
.a { color: black; }
.b:extend(.a) {}
.c:extend(.b) {}
```

```css
.a, .b, .c { color: black; }
```

Termination is guaranteed: each instruction fires once and produced branches are
value-deduped, so self-references and circular references resolve and stop rather than
loop. A branch equal to an extender is never self-wrapped.

## `@media` scoping

An extend inside `@media` only matches selectors in the **same** (or a descendant)
media scope; it does not reach the top level or a sibling media. A **top-level** extend
reaches everything, including inside nested media. Unlike Less 4.x, 5.x keeps nested
`@media` blocks nested — it does not merge or flatten them.

## `@import (reference)` visibility

`@import (reference)` hides the imported sheet's own rules from output. An extend that
matches a referenced target pulls the matched declarations into the **extender's**
selector only — the referenced target header never surfaces on its own. Internally each
composed branch carries a visibility bit: a hidden subject's own seed branches stay
hidden, but a visible extender folded in later carries its own visible provenance, and
an `:is(a, b)` group is visible if *either* member is visible.

## What extend does *not* do

- **No partial-property extend.** Extend is selector-level only — it shares a rule's
  whole declaration block. It cannot pull in a single property.
- **No variable-target matching.** An interpolated selector as a match *target*
  matches nothing (`:extend(@{variable})` finds nothing, and a `@{variable}` rule is
  never matched *by* an extend). An interpolated selector as the *extender* — i.e.
  `@{variable}:extend(.target)` — does work.
- **No normalization of the target form.** Matching is byte-exact: a leading star
  (`*.class` ≠ `.class`), pseudo-class order (`:hover:visited` ≠ `:visited:hover`),
  and `nth` form (`1n+3` ≠ `n+3`) all matter. The one exception is attribute-selector
  quote type, which is normalized (`[t=x]` ≡ `[t='x']` ≡ `[t="x"]`).

See also: [Extend](../features/extend.md) ·
[Extend and `:is()` Wrapping](./extend-is-wrapping.md) ·
[Selector Compaction](./selector-compaction.md) · [Output Model](./output-model.md).
