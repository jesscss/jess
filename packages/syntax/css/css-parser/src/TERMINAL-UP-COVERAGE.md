# Terminal-up CSS grammar — coverage and status

Tournament Candidate A. Two shapes of one grammar, kept side by side because
the pair **is** the finding.

- `grammar-terminal-up.ts` — Shape 1, sub-rules referenced by const.
- `grammar-terminal-up-byname.ts` — Shape 2, the same grammar with sub-rules
  referenced through the `g` proxy and named in the returned rules map.

Neither is wired into the package build. `src/grammar.ts` is owned by another
lane and is untouched. Both compile through `probe/tsdown.config.ts`.

## Measured

parseman 0.45.0, base `131cd9d1b`, node v24.11.1, raw ESM bytes.

| shape | artifact | gzip -9 |
| --- | --- | --- |
| Shape 1, by const | 3,777,733 | 382,484 |
| Shape 2, by name | 276,023 | 35,448 |
| incumbent `lib/grammar/ast.js` | 3,341,439 | 428,305 |

Shape 1 and Shape 2 have identical productions, identical combinator call
sites, identical terminals, identical reducers, and emit byte-identical trees
on every smoke fixture. The 13.69x is entirely the reference style.

Both artifacts are macro-compiled. Neither carries a runtime `parseman` import,
which is the interpreter-fallback signature.

## The mechanism this file exists to demonstrate

A rule referenced by const is **inlined at every reference, transitively**.
Inlining `ValueList` into `Declaration` also copies `ValueSequence`,
`Component`, the `IdentOrFunction` dispatch, `Url`, `Quoted`, `Group`, and
everything below them. From several positions in a recursive value grammar the
copies multiply with depth rather than adding across sites.

A rule referenced through the `g` proxy is emitted once and called.

The worst case is a rule that is in the returned map **and** still referenced by
const at the call site: it is emitted twice, and the map entry looks like it
helped.

## What is covered

Stylesheet, at-rule (block and statement forms, routed on the shared
`AtRuleKeyword` boundary leaf), qualified rule, block, declaration, custom
property, `!important`, and the value spine — keyword, generic function,
`url()` in both spellings, quoted strings, hex colour, unicode range, numbers
and dimensions, parenthesised groups, value punctuation, space runs, and
comma lists. Selector spine — element/class/id/universal, attribute selectors
with operator and modifier, argument-less pseudo selectors, compound and
complex selectors, selector lists.

Nine smoke fixtures parse and agree between the two shapes
(`probe/check-shape.mjs`).

## What is NOT covered, and the number must be read with this

Typed conditional preludes (`@media`/`@container`/`@supports` query grammar),
`calc()` structure, `var()` fallbacks and the delimiter-crossing guards they
need, `@page` and its margin at-rules, `@keyframes`, `@font-feature-values`,
`@layer`/`@scope`/`@document`, the `@import` tail, the `:nth-*` families and
their malformed-argument rejection, and functional pseudo-selector arguments.

276,023 B is therefore **not a score** and must not be ranked as one. It will
grow substantially. The 13.69x ratio between the two shapes is the result.

## Known non-conformance to GRAMMAR-REVIEW-STANDARD

**Item 4, the lint floor: 28 `no-unsafe-type-assertion` errors.** The reducers
cast `children[n]` because the factory takes `Record<string, Combinator>`.
The incumbent avoids this with a typed rule-name union and `FieldMap`, which
gives reducers typed children. Adopting that pattern removes every one of the
28 and is the next change this file needs. Recorded rather than suppressed:
none of them is an `as any`, `: any`, `@ts-ignore`, or `@ts-nocheck`.

## Open question this shape does not answer

Whether routing terminals through shared `g.*` leaves costs parse speed by
leaving a choice arm's first set unresolved. That is the incumbent's documented
reasoning for keeping grammar-local copies of `pseudoColon`,
`simpleSelectorToken`, `hexColor`, and `numberValue`. Shape 2 leans hard on
`g.*` references, so it is the shape most exposed to that cost, and only a
measured parse number settles it.
