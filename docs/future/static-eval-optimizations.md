# Static Eval Optimizations

## Goal

Make fully static stylesheets cheap to compile without introducing correctness
risks or adding a second tree walk just to decide whether eval can be skipped.

The intended long-term model is:

- `F_STATIC` means "no dynamic value evaluation"
- a future, separate flag or equivalent parse-time signal means
  "render-safe without eval"
- the root can decide in O(1) whether it can skip eval entirely

This note captures likely future directions. It is not an active implementation
plan.

## Current Problem

Today, `F_STATIC` bubbles correctly through many trees, including selectors,
rulesets, and root `Rules`, but first eval still walks `preEval()` / `evalNode()`
for the stylesheet.

That mismatch exists because some trees are "static" in the value sense but
still rely on eval-time structural work, for example:

- nested property expansion from collection-valued declarations
- selector/frame bookkeeping used by `collapseNesting`
- legacy root-only at-rule bubbling / hoisting
- class hashing side effects in module mode

A runtime scan gate can patch around that, but it is the wrong shape: we should
not walk the tree to decide whether we can avoid walking the tree.

## Preferred Direction

Introduce a second bubbled capability distinct from `F_STATIC`.

Possible names:

- `F_RENDER_STATIC`
- `F_EVAL_FREE`
- `F_SERIALIZE_DIRECT`

Meaning:

- the subtree needs no eval-time structural rewrite
- serialization of the canonical tree is already semantically correct
- root eval can return immediately after marking the tree as pre-evaluated /
  evaluated for the active context

This should be assigned and bubbled at construction time, just like the existing
 flag model, rather than discovered later by scanning.

## Candidate Exclusions For A Future Render-Safe Flag

These are the main cases that should likely clear a future eval-free flag even
when the subtree remains `F_STATIC`.

### Nested Property Expansion

Collection-valued declarations and sequence tails ending in collections still
need eval-time declaration expansion today.

Examples:

- `font: { size: 1rem; weight: bold; }`
- `margin: auto { left: 1px; right: 2px; }`

These are static in the value sense, but not render-safe on the canonical tree.

### Collapse Nesting

`collapseNesting` changes output shape, not just formatting.

Current eval stores frame / hoist state and resolves effective selectors used by
flat serialization. As long as that remains an eval-time responsibility, static
trees compiled with `collapseNesting: true` are not eval-free.

Longer term, this should likely move toward serialization-time computation.

### Root-Only At-Rule Bubbling

`bubbleRootAtRules` is a legacy Less-oriented option that hoists nested
root-only at-rules like `@font-face` or `@keyframes`.

Today that behavior is driven from at-rule eval. If the option remains, it
should ideally become a serializer concern rather than an eval concern, similar
to other at-root output shaping already handled during render.

### Module-Mode Class Hashing

Basic selector eval currently calls `context.hashClass()` for class selectors.

If module mode remains supported, this should likely move out of selector eval
and into a serializer-time or render-time name mapping concern. As long as the
side effect lives in eval, static trees in module mode are not safely eval-free.

### Other Eval-Time Structural Rewrites

Any future node that:

- rewrites tree shape during eval
- records serialization-only frame state during eval
- depends on eval for hoist decisions

should clear a future eval-free flag at construction time.

## Serialization-Time Opportunities

The cleanest future direction is to move more output-shaping work out of eval
entirely.

Promising candidates:

- `collapseNesting` selector composition and frame handling
- root-only at-rule bubbling / hoisting
- other at-root serialization behaviors that do not need lookup/eval semantics
- module-mode class hashing, if kept

This would shrink the set of "static but still needs eval" cases and make a
future eval-free flag much more useful.

## Why This Is Better Than A Scan Gate

A scan gate would:

- add another tree walk before compilation can skip eval
- duplicate structural knowledge already available at node construction time
- become a maintenance trap as more special cases are added

A bubbled parse-time capability keeps the decision local, cheap, and explicit.

## Suggested Future Work Order

1. Audit nodes that are `F_STATIC` but still need eval-time structural work.
2. Decide whether to add a new eval-free flag or equivalent metadata.
3. Move `collapseNesting` and root-at-rule bubbling toward serialization-time
   handling where possible.
4. Revisit module-mode class hashing and move it out of selector eval if that
   feature remains.
5. Only then add a root fast-path that trusts the new parse-time capability.

## Non-Goal

This document does not propose weakening semantics just to make static trees
look faster. If a shape still needs structural rewrite, it should not be treated
as eval-free until that rewrite is moved or eliminated.
