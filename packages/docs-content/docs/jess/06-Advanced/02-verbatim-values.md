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

For the full rule set and more examples, see the Less
[Verbatim Values](https://lesscss.org/docs/advanced/verbatim-values) page — the same
value engine underlies both.
