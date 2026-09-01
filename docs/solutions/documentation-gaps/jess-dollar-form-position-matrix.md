---
module: jess-interpolation
date: 2026-09-01
problem_type: documentation_gap
component: documentation
severity: low
applies_when:
  - "Deciding which of the three Jess $ forms is legal in a given syntactic position"
  - "Working on interpolation grammar in any of the four dialect grammars"
  - "Reconciling a test that asserts a $ form parses/rejects in a position"
tags:
  - jess
  - interpolation
  - dollar-forms
  - position-matrix
  - design-decisions
  - p13
---

# Jess `$(…)` / `${…}` / `$[…]` — the position-legality matrix lives in P13

## Context

Jess has **three `$` forms**, and *the position decides which one is legal* —
one form per position, no overlap. The question "which `$` form is legal here?"
recurs whenever interpolation grammar or an interpolation-related test is touched.

The canonical record is **`docs/architecture/core/DESIGN-DECISIONS.md` row P13**
(SETTLED, owner 2026-07-24, landed), doc home
`packages/docs/docs-content/docs/jess/02-Language/08-interpolation.mdx` (P13
cites it by the `docs/jess/…` shorthand). Rediscovering it cost several
doc-wide greps because two *adjacent* docs look authoritative but are not:

- `docs/design/SIGIL-DOLLAR-PAREN.md` is an **exploration** doc (its own header
  says "Nothing here is decided") that only *questions whether `$(…)` earns its
  place. It is not the matrix.
- `docs/design/RESOLVED-SEMANTICS-AND-NAMING.md` is not it either.

## Guidance

Go straight to **P13**. The settled matrix:

| Position | `${…}` (interp) | `$[…]` (lookup) | `$(…)` (expr) |
|---|:--:|:--:|:--:|
| **Interpolated identifiers** — selectors, property names, custom-prop names, `&`-suffixes, mixin names, **at-rule preludes** | ✅ **only** | ❌ | ❌ |
| **Quoted strings**, `~"…"`, **quoted `url()` bodies** | ✅ | ❌ | ✅ |
| **Unquoted decl-value `url()` bodies** | ✅ **only** (any other `$` = literal URL-token text) | ❌ (literal) | ❌ (literal) |
| **Value positions** (declaration values) | ❌ | ✅ | ✅ |
| **CSS at-rule URL bodies** | — CSS-only — | — CSS-only — | — CSS-only — |

Namespace rule *inside* `${…}` (same rule `[…]` follows everywhere): `${tone}` =
the variable; `${[tone]}` = a lookup (in a name position, the property `tone` in
scope); `${[$k]}` = a computed key. Quoting carries nothing — `[foo]` ≡
`["foo"]` (P14) — so quotes appear only for a non-identifier string
(`${["a b"]}`).

`${…}` exists because `$[…]` is a lookup against the ambient scope (`$[$foo]`
already means "the variable named by `$foo`"), leaving no plain interpolation
spelling; and bare interpolation is impossible because `-` is an identifier byte
(`--$name-color` has no name boundary).

## Why This Matters

Two other "resolved-looking" docs sit next to the real one and neither is the
record — the exploration doc even opens by re-litigating one of the three forms.
Without a direct pointer, the settled answer reads as still-open. P13 is
`SETTLED`/landed; treat the exploration and naming docs as leads, not the record.

## When to Apply

Any time a `$`-form legality question arises — grammar edits, or a test that
asserts a form parses or rejects in a position. Confirm against P13 before
changing a test's accept/reject set.

## Examples

**`@import url(${path})` — worked example (this session).** An unquoted `url()`
body is a **URL token** (matrix row 3): only `${…}` is recognized; every other
`$` is literal URL text. So `${path}` is the one legal interpolation there, which
is why `@import url(${path})` parses (→ resolve → name-not-found) rather than
rejecting. The one wrinkle: P13's trailing clause "CSS at-rule URL bodies stay
CSS-only" and `@import` *is* an at-rule — but that clause targets **passthrough
CSS at-rules** (`@namespace url(...)`, unknown at-rules) whose url is a real CSS
asset, not `@import`'s preprocessor *path*. Owner confirmed this reading in
session (2026-09-01): `@import` takes row 3, so `@import url(${path})` is
correct. The two jess-parser negative-assertion tests that had it in a rejected
set were the ones out of date, not the grammar
(`packages/syntax/jess/jess-parser/test/ast-grammar.test.ts`,
`.../test/cst-public.test.ts`).

**What each form is NOT.** `$(foo)` ≠ `${foo}`: `$(foo)` splices the *keyword*
`foo`; `${foo}` splices the *value of `$foo`*. `$[…]` is a lookup, never an
interpolation.
