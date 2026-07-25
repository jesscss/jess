---
title: "Number precision"
sidebar_label: Number precision
audiences:
  - jess
origin: jess
---

A **computed** number is emitted as the **shortest decimal that is still the same
number** — within a relative tolerance of `1e-10`. One policy, every position.

This is noise removal, not a precision limit. Jess does its arithmetic in JavaScript
doubles, and `0.1 + 0.2` really is `0.30000000000000004` — a different double from
`0.3`. Printing the shortest string that reads back as the *same* double therefore
cannot help; what Jess does instead is emit the shortest decimal within `1e-10`
(relative) of the computed value, which drops digits that are only float residue and
keeps digits that mean something.

## Noise goes, earned digits stay

```jess
.a {
  a: $(0.1 + 0.2);   // float noise
  b: $(100% / 3);    // a real repeating decimal
  c: pi();
}
```

```css
.a {
  a: 0.3;
  b: 33.333333333%;
  c: 3.1415926536;
}
```

There is **no significant-figure cap** and no per-unit rule. A cap would discard real
digits at larger magnitudes — `15.4px + 10cm` is `393.3527559px`, because the
`cm`-to-`px` factor `96/2.54` is a repeating decimal, and an 8-figure cap would print
`393.35276px` — to save a fraction of a percent of output size. CSS Values 4 §5
leaves numeric precision explicitly implementation-defined, so nothing requires
one.

Two consequences worth knowing:

- **Small magnitudes survive.** The tolerance is relative, not a fixed number of
  decimal places, so a computed `0.00000000123456789` stays itself rather than
  collapsing to `0`.
- **Exact integers are never touched.** An integer carries no float noise, so there
  is nothing to remove — however many digits it has.

Output is never written in scientific notation, per
[CSSOM §6.7.2](https://drafts.csswg.org/cssom-1/#serializing-css-values) ("scientific
notation is not used"). That section also caps *its own* serialization at six
decimals; this policy deliberately does not, because CSSOM governs what
`getComputedStyle` hands back rather than what a compiler may write, and a
decimal-place cap is the axis argued against above.

## Un-operated literals are emitted verbatim

Only a **computed** number goes through the policy. A literal you wrote is emitted
exactly as written — see [Verbatim values](./02-verbatim-values.md):

```jess
.a {
  a: 1.50000px;
  b: 2PX;
  c: 0.00000000123456789;
}
```

```css
.a {
  a: 1.50000px;
  b: 2PX;
  c: 0.00000000123456789;
}
```

The one spelling adjustment is a leading decimal point: `.3s` is emitted as `0.3s`.

## Every position spells a value the same way

A number spliced into a selector, a property name, or a string prints the **same
bytes** it would print in a declaration value:

```jess
$n: pi();
.a {
  width: $n;
  content: "$[n]";
}
```

```css
.a {
  width: 3.1415926536;
  content: "3.1415926536";
}
```

This is a language rule, not an implementation detail: position may change *whether*
a value is emitted, never *how* it is spelled.

:::note Where interpolation splices

Interpolation is written `$[name]` in string, selector, and property-name
position (`$( … )` is value-position only). A `$[…]` splice is grammar
structure everywhere it is accepted, including inside a custom-property name
and value (`--raw: $[n]`, `--$[name]: 1`), inside a plain quoted string
(`content: "fonts/$[family].css"`), and inside an escaped `~"…"` string.

The one place it is *not* spliced is a quoted string nested inside a
custom-property value: `--raw: "$[n]"` keeps the whole string as authored CSS
bytes, because a custom property's value is a verbatim token stream. Splice the
value directly (`--raw: $[n]`) instead of wrapping it in quotes.

:::

If you want fewer digits than the policy gives you, round explicitly with
[`round()`](../04-Functions/08-math.md) — that is a value operation, not an output
setting.
