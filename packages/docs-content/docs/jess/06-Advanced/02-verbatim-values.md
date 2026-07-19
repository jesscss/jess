---
title: "Verbatim (lazy-print) values"
sidebar_label: Verbatim values
audiences:
  - jess
origin: jess
---

Jess preserves value literals **exactly as you write them** unless an operation
actually computes a new value. A dimension or color that nothing operates on is
emitted source-verbatim; only computed results are canonicalized.

```jess
.a {
  width: 1.0px;   // literal in, literal out
  height: 2PX;
  color: #989;
}
```

```css
.a {
  width: 1.0px;
  height: 2PX;
  color: #989;
}
```

As soon as a value is operated on, the result is a fresh computed value and prints
in canonical form:

```jess
.b {
  width: 1.0px + 1px;  // -> 2px
  color: #989 + #010;  // -> #9a9a9a
}
```

The rule: **literal in, literal out; computed in, canonical out.** This keeps
authored CSS from being silently rewritten and makes output predictable.

Valid-CSS constructs that resemble functions (for example an un-operated
`rgb(50%, 0, 0)`) also pass through verbatim; the corresponding function only runs
when the value is operated on or its arguments are non-CSS forms.

## Function shape vs. grouping parens

Whether parentheses are a **function call** or **math grouping** comes down to a
single space before the `(`:

- **No space** — `name(...)` — is a function shape: passes through verbatim, even for
  a name that is not a real CSS function.
- **A space** — `keyword (expr)` — is math grouping: once the expression computes,
  the grouping parens **dissolve** and do not survive to output.

```jess
$a: #a80000;
$b: #00000b;
.a {
  border-a: 1px solid(#a8000b);             // no space -> verbatim
  border-b: 1px solid ($a * .66 + $b * .33); // space -> grouping, dissolves
}
```

```css
.a {
  border-a: 1px solid(#a8000b);
  border-b: 1px solid #a8000b;
}
```

For the full rule set and more examples, see the Less
[Verbatim Values](https://lesscss.org/docs/advanced/verbatim-values) page — the same
value engine underlies both.
