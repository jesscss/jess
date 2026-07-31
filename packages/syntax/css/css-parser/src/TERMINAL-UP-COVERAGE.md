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

| shape | artifact | gzip -9 | H1 | H2 |
| --- | --- | --- | --- | --- |
| Shape 1, sub-rules by const | 3,777,733 | 382,484 | — | — |
| Shape 2, sub-rules by name | 276,023 | 35,448 | 2 | 0 |
| Shape 3, Shape 2 with H1 closed | 255,671 | 33,209 | 0 | 0 |
| incumbent `lib/grammar/ast.js` | 3,341,439 | 428,305 | 39 | 2 |

All three shapes have identical productions, identical combinator call sites,
identical terminals, identical reducers, and emit byte-identical trees on every
smoke fixture. The 13.69x between Shape 1 and Shape 2, and the further 7.4%
between Shape 2 and Shape 3, are entirely reference style.

All three artifacts are macro-compiled. None carries a runtime `parseman`
import, which is the interpreter-fallback signature.

Shape 3 closes the two remaining `H1` sites — `Quoted` referenced by const 3
times, `CompoundSelector` twice — by naming them and referencing through `g`.
Five by-const references to two trivial closures (`Quoted` is two literals and
a text leaf) were worth **20,352 B, 7.4%**. That is the floor for what the
class is worth, not an estimate of it: the incumbent's heaviest instance,
`declarationListBlock` at 7 references, is `{ many(declarationListItem) }` and
drags the whole declaration/at-rule/ruleset body closure through every copy.

**No number here is extrapolated to `src/grammar.ts`.** The lever is real and
its size there is unmeasured.

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

## Retracted claims, kept visible

A document that quietly self-corrects teaches nobody that it drifted.

| claimed | corrected | why |
| --- | --- | --- |
| incumbent has 160 by-const composites and 86 emitted twice | 39 and 2 | the first `inline-audit.mjs` counted identifiers over raw source, matching each rule's own `node('Name')` string literal, the `GrammarRuleName` union, type imports and return annotations, comment prose, and the map key. Candidates B and C caught it independently; B hand-verified that `SelectorList` at 11 has **zero** by-const combinator references |
| Shape 2 still carries 21 by-const composites | 2 | same contamination |
| the by-const lever is "worth more than the tournament outcome" | overstated | it rested on the wrong count. The mechanism survives and is measured at −7.4% here; its size on `src/grammar.ts` is unmeasured |
| `balanced()` cannot detect delimiter crossing, so the `varFallback*Cross*` guards are permanent | crossing **is** detected | `expect()` recovers rather than failing, so it is a surfacing problem. Candidate C retracted their own probe. Ground truth: `var(--x, ([c}]))` **accepts**; `([c)])`, `({c)})`, `[c(d]`, `{c[d}` reject. Do not "fix" the accepting row |

| scss H2 15 / jess H2 28 (Candidate B) | 1 / 0 | type-position false positives — the sixth contamination class. scss and jess write `node<Declaration>(…)`, so the generic argument **is** the rule name. Toggling filter 5 alone reproduces B's figures (14 / 25). Hand-verified: all nine bare `Declaration` occurrences in `scss-parser/src/grammar.ts` are the type import, four `Combinator<Declaration>` annotations, a type predicate, comment prose, and its own generic argument — zero by-const references |

Three lanes wrote this audit independently in one round and got 86, 109, and 65
before de-contamination, all inflated in the flattering direction. That is the
failure this tournament exists to stop, reproduced inside the fix for it. The
harness should own one audit script, not three.

Corrected record on how the seven were caught: **some by peers, some by their
own authors before publication, and one by a consistency invariant** — B's
generics bug, caught because "38 composite consts against 143 map rules" is
impossible. Invariants are the cheapest of the three, so `inline-audit.mjs` now
throws rather than reporting when map keys exceed composites, when factory-start
detection fails, or when the composite count is far below the factory's const
count.

## The CST is not a rendering of this grammar's production tree

Candidate C's finding, and it bounds what a terminal-up build can achieve.
In `hostMode: 'cst'` the reducers do not run; nodes are built by a **repo-local**
host, `src/cst-host.ts`, which changes a node's type from its children, remaps
grammar names through `TYPE_NAMES` (`AtRuleBlock`/`AtRuleStatement` → `AtRule`,
`Ruleset` → `QualifiedRule`, `Call` → `Function`, `Paren` → `SimpleBlock`,
`Quoted` → `String`), and **fabricates children no production produced** —
`publicChildren` manufactures a joined `name(` leaf for `Url` at :305–315.

Consequences for this file: production names here are not what a CST gate
grades; the production→CST-name map is already non-injective in the baseline;
and the fabricated `Url` leaf cannot be reproduced by a from-scratch grammar
however correct it is. That last one is the most likely way this entry fails an
identity gate while looking right.

## Open question this shape does not answer

Whether routing terminals through shared `g.*` leaves costs parse speed by
leaving a choice arm's first set unresolved. That is the incumbent's documented
reasoning for keeping grammar-local copies of `pseudoColon`,
`simpleSelectorToken`, `hexColor`, and `numberValue`. Shape 2 leans hard on
`g.*` references, so it is the shape most exposed to that cost, and only a
measured parse number settles it.
