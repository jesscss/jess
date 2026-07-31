# CSS grammar rewrite — Candidate C: loose skeleton plus validator tier

Lane `lane/css-rewrite-candidate-c`, based on `origin/dev` at `131cd9d1b`,
parseman `0.45.0`. Every number here was measured in this worktree with the
command shown; nothing is quoted from another lane.

The assigned approach: the hot grammar recognises only **shape** — balanced
delimiters, prelude/block boundaries, statement termination — and captures
spans. A second tier parses tightly, on demand, when validity or a diagnostic
is actually needed.

---

## 1. The discriminator, in three buckets

The owner split the original two-way discriminator into three. Every at-rule
constraint sorts into exactly one:

| bucket | question | where it lives |
| --- | --- | --- |
| **shape** | where does the prelude end, is the block balanced, statement or block at-rule, where does a token boundary fall | hot grammar — non-negotiable |
| **structurally wrong** | unclosed paren, crossed closure, missing required block, garbage after the prelude | hot grammar detects, because the skeleton cannot proceed without knowing |
| **keyword compliance** | is `onlyé` a legal media qualifier, is this a real container name | validator tier |

The middle bucket is the load-bearing one, and §4 is the finding that it is
harder to serve than it looks.

---

## 2. Finding 1 — most at-rule preludes are ALREADY opaque

The loose tier is not a new idea being introduced to this grammar. It is the
incumbent AST contract for the majority of at-rules, arrived at ad hoc.

`packages/syntax/css/css-parser/src/grammar.ts`:

- `AtRulePrelude` (:2717) and `StatementPrelude` (:2725) both take
  `g.AtRulePreludeSegments` and reduce to `text === '' ? null : any(text)`.
  A single `Any` carrying trimmed source text. No structure survives.
- `grep -n 'g.AtRulePrelude' packages/syntax/css/css-parser/src/grammar.ts`
  returns **21 consumer sites**: `@layer`, `@page`, `@scope`, `@document`,
  `@keyframes`, `@font-feature-values`, `@starting-style`, and the seven
  descriptor at-rules.
- Exactly **four** at-rule families produce a structured prelude tree:
  `@media` (`QueryPrelude` :3056), `@container` (`ContainerPrelude` :3107),
  `@supports` (`SupportsPrelude` :3286), `@import` (`ImportTail` :2586).

So on the AST surface the tight at-rule mass is not 68 consts' worth of tree.
It is 68 consts' worth of *recognition* feeding four consts' worth of
*structure*. The rest spend combinators proving a prelude is well-formed, then
discard the proof and keep the bytes.

Three further places already run a loose tier with bespoke local machinery:

- `RoutedQueryFunction` (:2990) — `scanTo(literal(')'), { skip: [balancedParens] })`
  reducing to `funcCall(name, [any(text)])`. A raw span inside the *tight*
  family.
- `GeneralEnclosed*` (5 consts, :3130–) — raw text.
- `OpaqueAtPrelude` / `OpaqueBody` (:2733, :2741) — the shared
  `opaqueAtRuleRecognition` `scanTo` captures.

**The incumbent already has a loose tier in at least five places, each with its
own hand-rolled scanner consts.** Candidate C's honest contribution is one
capture primitive used wherever a flat span is the AST contract, instead of
five bespoke ones.

## 3. Finding 2 — a dead const and a dead 430-character regex

`OpaqueAtRuleBlock` (grammar.ts:2746) is defined and exported in the rules map
(:4027) but **referenced by no production**. Only `RoutedOpaqueAtRuleBlock`
(:2770) is reachable, via `otherwise(...)` on the three at-rule dispatches.

Verified: `grep -n 'OpaqueAtRuleBlock\b' … | grep -v RoutedOpaque` yields no
`g.OpaqueAtRuleBlock` use anywhere in `css-parser` — not in the grammar, not in
its tests. The CSS tests at `test/ast-grammar.test.ts:1351,1368` assert the
output *type*, reached through the routed path.

Its only distinguishing child is `g.GenericAtRuleName`, and
`grep -n GenericAtRuleName` returns exactly one consumer: line 2740, inside the
dead const. `genericAtRuleName` (`packages/parser-shared/src/recognition.ts:210`)
is a ~430-character negative lookahead over the entire known at-keyword set. It
is dead for CSS.

Less has its own `g.OpaqueAtRuleBlock` (`less-parser/src/grammar.ts:4184`) and
is unaffected.

## 4. Finding 3 — `balanced()` detects crossed closures but cannot reject them

> **This section was published in a stronger form and is corrected here.** The
> original claim was that multi-kind balanced matching is not expressible. The
> parseman lane read `scanTo.ts`/`expect.ts` and pushed back before building on
> it, and they were right. The corrected finding is smaller, and the resulting
> upstream ask is much more actionable. The superseded reasoning is kept below
> the correction because the call-site pricing still depends on it.

**Correction 1 — crossed closures ARE detected.** `balanced()`'s close is
wrapped in `expect()`, which never fails: it returns
`{ ok: true, value: ParseError }`, pushes onto `ctx._errors`, and reports a
zero-width span. The original probe measured **consumption only**, so it could
not distinguish acceptance from recovery. Re-run with errors surfaced
(`probes/balanced-errors.mjs`):

```
"([a)]"  -> ok consumed=5/5 errors=1     <- DETECTED
"({a)}"  -> ok consumed=5/5 errors=1     <- DETECTED
"([a])"  -> ok consumed=5/5 errors=0
```

**Correction 2 — one expectation was fabricated.** `([a}])` was asserted to be
malformed from a reading of "crossed", never checked against the incumbent.
Verified against the built parser:

```
ACCEPT   a { b: var(--x, ([c}])) }
REJECT   a { b: var(--x, ([c)]) }      REJECT   a { b: var(--x, ({c)}) }
REJECT   a { b: var(--x, [c(d]) }      REJECT   a { b: var(--x, {c[d}) }
```

The incumbent **accepts** `([c}])`, so `errors=0` there is correct behaviour.
Those five lines are the real acceptance set for anyone building a replacement.

**The corrected finding.** `balanced()` is *unfailable once its opener is
consumed*. The information needed to reject a crossed closure is already
computed and sitting in `ctx._errors`; what is missing is a way to make it a
**match failure**. The six `varFallback*Cross*` guards exist purely to perform
that conversion by hand.

**The corrected ask: a strict/failing mode for `balanced()`** —
`balanced(open, close, { strict: true })` — not a shared-stack multi-kind
primitive. Smaller, already-computed, and checkable against the five cases
above. Worth **60 call sites, 6.7%** of the CSS grammar's call-site mass (§5).

The escape hatch remains closed either way: `gate(predicate)` is zero-width over
`ctx.state` only, so it cannot validate a captured span, and reducer-throw is
explicitly wrong (grammar.ts:2805–2814 records a raw `Error` escaping `parse()`;
the fix was to make the shape fail to match).

### Superseded reasoning, kept for the record

This is the finding that most constrains the approach, and it is the one the
owner should decide on.

Six consts — `varFallbackBracketCrossParen`, `varFallbackBracketCrossBrace`,
`varFallbackBraceCrossParen`, `varFallbackBraceCrossBracket`,
`varFallbackParenCrossBracket`, `varFallbackParenCrossBrace` — plus two leading
`not(choice(...))` gates exist for exactly one purpose: rejecting **crossed
closures** such as `([a)]`, `({a)}`, `[a(b]`, `{a[b}`.

That is textbook bucket 2, "structurally wrong". The owner's insight is that a
loose skeleton gets this **by construction**, because a balanced-delimiter
scanner necessarily knows when delimiters do not balance.

**The insight is correct. The primitive is missing.** Measured, not reasoned —
`packages/syntax/css/css-parser/probes/balanced-multikind.mjs`:

```
--- bare balanced, no skips ---
PASS  "([a)]"   want=false got=false consumed=4/5     <- caller rejects the stray ']'
FAIL  "([a}])"  want=false got=true  consumed=6/6

--- literal nested skips (one level) ---
FAIL  "([a)]"   want=false got=true  consumed=5/5
FAIL  "({a)}"   want=false got=true  consumed=5/5
FAIL  "([a}])"  want=false got=true  consumed=6/6

--- mutually recursive g. skips ---
FAIL  "([a)]"   want=false got=true  consumed=5/5
FAIL  "({a)}"   want=false got=true  consumed=5/5
FAIL  "([a}])"  want=false got=true  consumed=6/6
```

Three results, in order of importance:

1. `balanced()` tracks **one** delimiter pair. `balanced('(', ')')` reading
   `([a}])` sees `}` as an ordinary byte and accepts.
2. Adding a nested `balanced()` to the `skip` set makes crossing **worse, not
   better**: `([a)]` goes from correctly rejected to accepted, because the
   bracket skipper happily eats the foreign `)`.
3. Mutual recursion through `g.` rule references resolves (it does not crash,
   and behaves identically to the literal nesting) but **does not help**. Each
   balancer still owns only its own pair.

So multi-kind balanced matching is not expressible with `balanced()` plus
skips, recursively or otherwise. The six cross-guards are not an authoring
oversight; they are a necessary workaround for a missing primitive, and they
are an O(n²) workaround — three delimiter kinds give six ordered pairs, a
fourth kind would need twelve.

The `FAIL` rows above are what a consumption-only probe reports; per the
correction, the two genuinely-crossed rows were being reported through
`ctx._errors` all along, and the `([a}])` row was a bogus expectation. What
survives from this reasoning is the *shape* of the workaround: the six guards
are an O(n²) cross-product — three delimiter kinds give six ordered pairs, a
fourth would need twelve — and they exist because the grammar needs a match
failure where `balanced()` offers only a recovered error.

## 5. Pricing every boundary before building it

`probes/callsite-price.mjs`. An independent count of the incumbent factory
gives **900** combinator call sites against Candidate B's **904** — same method,
two authors, no coordination.

| boundary | consts | sites | % of factory |
| --- | --- | --- | --- |
| B0 dead code | 1 | 6 | 0.7% |
| B2 flat-prelude scanners | 7 | 20 | 2.2% |
| B3 query/supports/container | 30 | 142 | 15.8% |
| B4 varFallback (blocked) | 16 | 104 | 11.6% |
| — of which cross-guards | 6 | 60 | 6.7% |
| **addressable total** | **54** | **272** | **30.2%** |

**Bytes are not linear in call sites.** Candidate A measured a 13.69x spread
between by-const and by-name sub-rule references on otherwise identical
grammars. These figures therefore price each family *as the incumbent currently
writes it* — an upper bound on what removal saves, not a prediction of what a
replacement costs.

## 6. Finding 5 — the incumbent inlines its body grammars

`probes/inline-audit.mjs`, applying A's mechanism. A composite const referenced
by bare const is inlined at every reference, transitively; one referenced
through `g` is emitted once. **41 composite consts are referenced 2+ times and
are not in the returned rules map.** The expensive ones are body grammars,
whose transitive closure is the whole statement/declaration grammar:

```
RoutedAtRuleStatement       x11
declarationListBlock        x7    (grammar.ts:3314, confirmed not in map)
descriptorBodyBlock         x5
pseudoArgumentContent       x5
CustomPropertyValue         x5
stylesheetBodyBlock         x4
conditionalGroupBodyBlock   x3
```

This is a **baseline** property, not a candidate's: it belongs to whatever the
tournament decides the incumbent baseline is.

Two contamination bugs were found and fixed inside that probe before its
numbers were reported. Slicing from line 0 counted imports, the `type` union of
every node name, and helper functions; and counting through string literals let
every `node('X', ...)` self-reference. Fixing both dropped A's second hazard
class from **109 to 4**. The tell was an `OpaqueAtRuleBlock` row claiming eight
references for a const already proven unreachable in §3.

## 7. Finding 4 — the keyword sets that must stay hot, and why

Candidate A flagged the shared at-keyword regexes as disambiguators. Verified,
and the reason is sharper than "known-name check".

`atRuleKeyword` (`recognition.ts:217`) is one fused router regex with three
alternatives:

1. a literal list of fourteen known names guarded by
   `(?=[^-_0-9A-Za-z]|$)` — the **legacy ASCII boundary**;
2. `(?:-[a-z]+-)?keyframes(?![-\w])`;
3. any other CSS identifier, excluding `import|media|container|supports`,
   using the **full CSS ident** grammar with `-￿` and escapes.

The known-name list is therefore **not a validity check — it is a boundary
policy switch**. `@font-feature-valuesé` is the known keyword
`@font-feature-values` followed by a prelude starting `é`, exactly as the
comment at `recognition.ts:222–226` states. A loose scanner that matched "any
`@ident`" would take `@font-feature-valuesé` as one unknown at-keyword and the
tree would move.

That is bucket 1, shape: the keyword set decides **where the token ends**. It
stays hot. Alternative 3's exclusion of `import|media|container|supports` is
also shape — those four are routed before the dispatch.

`mediaTypeKeywordReserved` (`['only', 'layer']`, :2939) and
`containerNameReserved` (`['none']`, :2943) were the two to reason hardest
about, and they split:

- **`mediaTypeKeywordReserved` is shape.** It appears under `not(...)` in
  `QueryNonOnlyKeyword` (:2947) and inside `queryIdentOrFunction` (:2965).
  In `@media only screen`, `only` must not be consumed as the media type, or
  `screen` has no clause to attach to. The reserved set is what selects the
  `QueryOnlyClause` arm over the plain-term arm. Removing it changes which arm
  matches. Stays hot.
- **`containerNameReserved` is shape too, marginally.** `containerName` (:3072)
  is `sequence(not(g.QueryFunctionOpen), not(containerNameReserved), g.Keyword)`,
  and `ContainerPrelude` (:3107) chooses between "name then optional query" and
  "query only". `@container none (…)` must take the second arm. This is a
  one-keyword disambiguator, so it stays hot, but it is the cheapest of the
  three and worth re-testing if the arms are ever left-factored.

`@media onlyé` is resolved without an exception: the ASCII boundary makes
`onlyé` a single identifier that is not `only`, so it takes the media-type
slot as a matter of shape, and whether `onlyé` is a *legal* media type is a
vocabulary question the validator tier answers.

## 8. The tier boundary, and why the gate reshapes it

Referee ruling R1: the identity gate hashes **all three shipping surfaces** —
`parse` (ast), `parseCssCst` (cst), `parseCssDoc` (doc) — and a CST node carries
both `type` and `grammarType`, so **the CST surface pins the production set
itself**. Identity is byte-identity modulo a declared **injective** rename map,
so merging productions cannot pass as a rename.

That is the crux for this lane, stated plainly: **a loose skeleton has fewer
productions, and the CST gate pins production count.** The AST-side collapse in
§2 is nearly free; the CST side is the entire fight.

It does not follow that the approach is dead, and the resolution is already
precedent in this repo — the `ast/` v2 unified node model with **lazy
materialisation**. The productions must still *appear* in the CST. They do not
have to be *parseman productions*.

**The submitted shape:**

- **Tier 1, hot, parseman combinators.** Structure only: statement and block
  boundaries, prelude spans, at-keyword routing with the boundary-policy
  keyword set of §7, balanced delimiters.
- **Tier 2, plain TypeScript, lazy.** Materialises the prelude's node tree on
  demand with the incumbent production names and absolute spans derived from
  the captured span base; also owns diagnostics and keyword compliance.

Why this can win on the rank key while staying identical: the harness walks the
CST to hash it, which forces materialisation, so CST bytes match. The hot AST
path never materialises, so parse speed improves. And the compiled artifact
shrinks twice over — once because ~68 productions leave the macro-compiled
grammar, and again because, per R5, the artifact ends with an inlined
`Symbol.for('parseman.grammarReflection')` table whose size tracks node-name
count and length. A plain-TS materialiser reproduces those names at
approximately zero marginal artifact cost.

Per R3 this is reported **grammar tier and validator tier separately and
summed**, on every metric, every round.

### Boundaries under evaluation

| # | boundary | what moves to tier 2 | expected identity risk |
| --- | --- | --- | --- |
| B0 | dead-code only | §3's dead const and regex | none — pure deletion |
| B1 | vocabulary only | keyword sets that do not disambiguate | none on any surface |
| B2 | flat preludes | the 21 `AtRulePrelude` sites' 7 segment-scanner consts | AST none; CST loses `AtRulePreludeGroup`/`Quoted`/`Text` nodes — needs lazy materialisation |
| B3 | query/supports/container | the ~32-const tight family | CST loses the whole family — the real test of lazy materialisation |
| B4 | var() fallback | the 16-const `varFallback*` family | blocked on §4 until a multi-kind `balanced()` exists |

B0 and B1 are unconditional wins and land first. B2 is the first real test of
the lazy-materialisation mechanism. B3 is where the mass is. B4 is blocked
upstream, and that blockage is a finding, not a defeat.

### One hypothesis, tested and dead

`QueryPrelude` is a comma list of space-joined terms, and `ValueList` is a
comma list of space-joined terms, so I tested whether the query prelude is
structurally just the CSS value list with a restricted vocabulary — which would
have collapsed the family without any tier-2 machinery at all.

**It is not.** The reducers produce a genuinely different tree:
`QueryColonFeature` (:2847) emits `block(operation(':', keyword(name), value))`,
`QueryRangeFeature` (:2887) emits nested `Operation`s for `(100em < width <
200em)`, and `QueryBareFeature` (:2838) emits `block(keyword(name))`. The CSS
value grammar has no top-level `:` and no comparison operators, and
`ParenValue` does not produce `Block(Operation(...))`. Killed by the reducers at
grammar.ts:2838–2928.
