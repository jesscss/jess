---
title: "Merge Operators & Last-Occurrence Anchoring"
slug: "/advanced/merge-anchoring"
audiences:
  - less
origin: less
---

> How `+:` (comma-merge) and `+_:` (space-merge) combine values in Less 5.x, and
> why the merged property renders at the **last** occurrence.

The [merge](../features/merge.md) feature lets several declarations of the same
property aggregate into one comma- or space-separated value. Less 5.x keeps the
familiar `+`/`+_` syntax but changes one observable behavior: **where** the merged
result renders.

## The two operators

- `+:` — **comma** merge. Values join with `, `.
- `+_:` — **space** merge. Values join with a single space.

```less
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

## Last-occurrence anchoring (a deliberate 5.x divergence)

When a property is merged across multiple declarations, Less 5.x renders the
combined value at the position of the **last** occurrence in source order — not the
first. Less 4.x anchored the merged output at the first occurrence; 5.x anchors at
the last. This is an intentional divergence, not a bug.

```less
.shadow-base {
  box-shadow+: rgba(0, 0, 0, 0.12);
}
.shadow-elevated {
  .shadow-base();
  box-shadow+: rgba(0, 0, 0, 0.1);
  box-shadow+: rgba(0, 0, 0, 0.15);
}
```

```css
.shadow-elevated {
  box-shadow: rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.15);
}
```

The single merged declaration appears where the last `box-shadow+` was written, and
the values are collected in source order.

## How it works under the hood

A merge declaration lowers to an ordinary **self-referencing** declaration — the
property reads its own prior value and appends to it with the chosen separator. If
there is no prior value (the first occurrence in the chain), the self-reference is
empty and the separator that would precede it is dropped, so the output has no
leading comma or space. There is no special merge pass; normal evaluation and the
value resolver produce the result. An `!important` on any member of the chain
propagates to the merged output.

Because merging is resolved at serialize time, it composes cleanly through mixin
calls — a mixin that contributes a `box-shadow+` value merges into a caller that
also declares `box-shadow+`.

See also: [Merge](../features/merge.md).
