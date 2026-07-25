---
title: "Property merge & last-occurrence anchoring"
sidebar_label: Property merge
audiences:
  - jess
origin: jess
---

Jess supports Less-style property merge for aggregating several declarations of the
same property into one comma- or space-separated value:

- `+:` — **comma** merge (values join with `, `)
- `+_:` — **space** merge (values join with a single space)

```jess
.mixin() {
  box-shadow+: inset 0 0 10px #555;
}
.myclass {
  .mixin();
  box-shadow+: 0 0 20px black;
}
```

```css
.myclass {
  box-shadow: inset 0 0 10px #555, 0 0 20px black;
}
```

## Last-occurrence anchoring

When a property is merged across several declarations, the combined value renders at
the position of the **last** occurrence in source order. (Less 4.x anchored at the
first occurrence; Jess and the Less 5.x engine anchor at the last — a deliberate
divergence.)

## It's a self-reference under the hood

A merge declaration lowers to a plain **self-referencing** declaration: the property
reads its own prior value and appends to it. You can write the self-reference
explicitly with the property-access form instead of the `+` sugar:

```jess
.myclass {
  box-shadow: inset 0 0 10px #555;
  box-shadow: $['box-shadow'], 0 0 20px black;  // same result
}
```

If there is no prior value, the self-reference is empty and the leading separator is
dropped, so the first occurrence prints cleanly. `!important` on any member of the
chain propagates to the merged output.

See also the Less
[Merge Operators](https://lesscss.org/docs/advanced/merge-anchoring) page.
