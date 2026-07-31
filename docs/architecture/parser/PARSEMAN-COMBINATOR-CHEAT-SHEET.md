# Parseman combinator cheat sheet

**Cut against `parseman@0.46.0`** — the version this repo pins (`^0.46.0`, root
`package.json`, `parser-shared`, and all four `*-parser` packages, since
`ff685793a`) and the version actually resolved in
`node_modules/.pnpm/parseman@0.46.0`. Claims first measured against the previous
`0.45.0` floor are marked as such inline and were re-run against 0.46 when the
floor moved; the probes below all pass at 0.46.

Every spread/arity contract below was established from that package's
`dist/index.cjs` — by enumerating the nine call sites that push into the CST
child buffer, and by running each combinator and counting the children the
reducer actually received. Neither inference from the type signature nor an
upstream working copy ahead of the installed floor (e.g.
`/Users/matthew/git/oss/parser-thing`) is a valid source for these contracts —
read the resolved package in `node_modules`.

Every arity, nullability, and commit claim below is **measured**, not read off a
docstring. The probes are committed at `scratchpad/cheat-sheet/` and are the
regression test for this document — run them after any parseman floor bump:

```
node scratchpad/cheat-sheet/coverage.mjs           # export-coverage gap
node scratchpad/cheat-sheet/probe-arity.mjs        # children contribution
node scratchpad/cheat-sheet/probe-empty-commit.mjs # nullability + rollback
node scratchpad/cheat-sheet/probe-balanced-expect.mjs
node scratchpad/cheat-sheet/probe-zero-arity.mjs
node scratchpad/cheat-sheet/probe-structural.mjs
```

Claims that are **not** measured are labelled `UNVERIFIED` at the point of use.
That labelling is required, not optional.

This is the working grammar-authoring guide for the four host-mode grammar
files. Use the language production name first, keep rules small, and prefer the
Parseman combinator that states the ownership boundary directly.

---

## Spread and arity: read this first

**This section is first because it has now cost six separate lanes a debugging
round, and because every one of those defects was invisible to a parse-success
check and to a green test suite.**

### The one rule that explains all of it

A reducer's `children` array is **not** the value array of the `sequence()` you
passed to `node()`. It is an **ambient capture buffer**. Combinators do not
"return children"; a small set of them *push* into that buffer as they match,
and everything else is **transparent** — it contributes exactly the sum of what
its own inner parsers pushed.

In `parseman@0.46.0` exactly these combinators push (re-verified by `probe-arity.mjs` at this floor), and each pushes **exactly
one** child:

> `literal` · `regex` · `keywords` · `word` · `makeWord` · `scanTo` · `routed` ·
> `node` · `token` · `leaf`

`peek`, `not`, and `gate` are zero-width and push **nothing**. **Every other
combinator in the library is transparent.** That single fact is the whole
defect class:

```js
sequence(literal('('), ident, literal(')'))   // 3 children — sequence pushes nothing itself
many(item)          // matched 3 times -> 3 children, NOT one array child
transform(seq3, fn) // 3 children — fn's return value NEVER reaches the parent
node('X', seq3, fn) // 1 child — node() is the only structural combinator that groups
```

### The failure signature

**The parse succeeds.** You get a plausible, well-typed tree. What you see is:

- everything after the **first** element of a repeated group is missing; or
- a child appears **one slot to the left** of where it belongs; or
- a block comes out **empty** while its first statement turns up in the
  *preceding* slot (a prelude, a name, a selector).

### The diagnostic rule — three for three this session

> **When a compound splits, check what the reducer RECEIVES before checking what
> the grammar CONSUMES.**

Whitespace-and-glue hypotheses have lost to arity hypotheses three separate
times this session, and in every case the losing hypothesis was the intuitive
one and cost a full round. Print `children.length` and the children *first*.
Reach for `noTrivia` second, if at all.

Confirmed instances:

- **`a:is(.x,.y)` split at the compound boundary.** First diagnosis: trivia,
  reach for `noTrivia`. Second: whitespace. Actual cause: `transform()` is
  transparent, so the compound term never arrived as one child. `node()` fixed
  it, one line.
- **A five-defect chain from `many()`.** Every multi-declaration rule kept only
  its first declaration, and at-rule bodies came out empty while the body's
  first statement appeared in the prelude slot. **One root cause, five
  symptoms, none of which looked like arity.**
- A third instance was reported by the reviewing lane. Its write-up had not
  arrived when this sheet was cut, so the details are deliberately not
  reconstructed here — add them when that lane lands them.

The reason this is worth stating as a rule rather than a caveat: the symptoms —
missing trailing content, a child one slot left, an empty block — all look like
*consumption* problems. Nothing about them points at the reducer's argument
list, which is where the evidence actually is.

### The headline case

```js
Block = node('Block', sequence(literal('{'), many(item), literal('}')),
             children => children[1])
run(Block, '{a:b;c:d}')   //  -> a single Declaration. NOT a list.
```

`children[1]` is the **first statement**, not the statement list. The children
are `['{', decl, decl, '}']`, so `children[1]` is `decl#1` and `decl#2` sits at
index 2 where the author expected `'}'`.

**The fix is to wrap the group in `node()`,** which is the only structural
combinator that collapses its subtree to one child:

```js
Block = node('Block', sequence(literal('{'), node('Body', many(item)), literal('}')),
             children => children[1])   // now genuinely the body
```

**Cost fact, stated plainly:** `node()` measures **3,425 B per site against
`transform()`'s 46 B — 74×**. The correct spelling for a grouped compound
currently costs 74× the incorrect one. Pay it: do **not** use `transform()` as
an economy where the tree needs `node()`. A codegen lane is separately tasked
with itemising and reducing that 3,425 B; this number will be updated if it
moves.

### The same trap from the other side: variable arity shifts every later index

```
sequence(literal('('), optional(X), literal(')'))  on "(hover)" -> 3 children ['(','hover',')']
                                                    on "()"     -> 2 children ['(',')']
```

`"()"` yields `[')' at index 1]` — **not** `[undefined, ')']`. A non-matching
`optional()` contributes **nothing** and shifts every later index down. Any
reducer indexing past an optional reads the wrong child, with no arity error and
no exception. Confirmed live: `sequence(routed(), optional(prelude), Block)`
read with `children[1], children[2]` put the **body in the prelude slot** for
`@font-face{a:b}`.

`literal()` matches are **NOT** dropped from the child array. That is the
obvious single explanation for both symptoms, and it is **false** — verified
above, where `'('` and `')'` are both present.

> **The rule: do not read a fixed position when any preceding child combinator
> has variable arity.** Put variable-arity combinators last, or destructure by
> identity/type rather than by index.

Two established fixes in this codebase, both preferred over indexing past an
`optional()`:

- **A node that always matches and may be empty.** `AtRuleStatement`
  (`packages/syntax/css/css-parser/src/grammar.ts:2628`) uses `g.StatementPrelude`
  rather than `optional(...)`, so the arity is fixed at 3.
- **Wrap in `token(...)`.** `lessDeclarationProperty`
  (`packages/parser-shared/src/recognition.ts:298`) is
  `token(noTrivia(sequence(optional(literal('*')), cssIdentifier)))` — the
  `optional` is variable-arity inside, but `token()` collapses the whole thing
  to one leaf, so the caller sees fixed arity.

### Why no test catches this

A wrong positional read produces a **plausible, well-typed tree**. It parses, it
type-checks, and the suite passes. The only instruments that see it are a
byte-level tree diff against a known-good baseline, and asserting
`span.end === source.length` — because `many()` succeeds on zero matches, so a
root of `many(Item)` returns `ok=true` with `span={0,0}` on pure garbage.

### Related: separated lists spread their separators too

`sepBy` and `oneOrMoreSep` are transparent. On `a,b,c` the reducer receives
**five** children `['a', ',', 'b', ',', 'c']`, not three items. Parseman's own
duplication analyzer describes `sepBy` as yielding "a flat item list" — that
describes the combinator's **value**, not the CST children. Do not read items
by index off a separated list; wrap the items in `node()` or filter by type.

---

## Mechanical contract for all 107 runtime exports

`parseman@0.46.0` has **107 runtime exports**. All 107 appear below, each with an
explicit spread contract. The four contract values are:

| Contract | Meaning |
| --- | --- |
| **ONE** | Pushes exactly one child into the parent's children, whatever its subtree did. |
| **SPREADS** | Transparent. Contributes exactly the sum of what its inner parsers contributed — zero, one, or many. |
| **ZERO** | Zero-width assertion. Contributes no child. |
| **N/A** | Not a parse-time combinator; contributes nothing because it never participates in a parse. |

### Terminals and grouping — contribute exactly ONE child (10)

| Export | Contract | Use it when |
| --- | --- | --- |
| `literal` | **ONE** | A fixed spelling is syntax, punctuation, or glue. |
| `regex` | **ONE** | The language genuinely needs a character pattern Parseman has no structured helper for. |
| `keywords` | **ONE** | A fixed set should compile as one longest-first terminal with optional boundary and case policy. |
| `word` | **ONE** | One keyword needs a trailing word-boundary guard. |
| `makeWord` | **ONE** | Many words share the same boundary/case policy. Returns a `word`-shaped factory; each built word is ONE. |
| `scanTo` | **ONE** | A bounded opaque run is permitted and has an explicit sentinel. Emits the whole run as a single leaf. |
| `routed` | **ONE** | A selected dispatch branch should own the already-parsed value and span. |
| `node` | **ONE** | A branch owns a public CST boundary or AST projection. **The only structural combinator that groups a subtree into one child.** |
| `token` | **ONE** | A terminal span/value should be available as one leaf. Collapses variable-arity interiors to fixed arity. |
| `leaf` | **ONE** | A value should be represented as a CST leaf. |

### Structural — SPREAD into the parent's children (22)

Every one of these is transparent. **None of them groups.** If you need a group,
that is what `node()` is for.

| Export | Contract | Use it when |
| --- | --- | --- |
| `sequence` | **SPREADS** | Several pieces must appear in order. Contributes the sum over its terms. |
| `choice` | **SPREADS** | Alternatives are real alternatives. Contributes whatever the winning arm contributed. |
| `many` | **SPREADS** | Zero or more repetitions and nullable is correct. **N matches contribute N children.** |
| `oneOrMore` | **SPREADS** | At least one repetition is required. Implemented as `many(..., {min:1})`; same spread. |
| `optional` | **SPREADS** | A local piece may be absent. Contributes its inner count on a hit and **zero on a miss** — the index-shift trap. |
| `sepBy` | **SPREADS** | A separated list may be empty or needs min/trailing options. **Separators are children too.** |
| `oneOrMoreSep` | **SPREADS** | A separated list cannot be empty. Implemented as `sepBy(..., {min:1})`; separators are children. |
| `transform` | **SPREADS** | A value changes shape without needing a CST node boundary. **`fn`'s return value never reaches the parent's children** — only the inner parser's pushes do. |
| `skip` | **SPREADS** | A main parser should ignore a specific skipped parser around it. Contributes main + skipped pushes. |
| `noTrivia` | **SPREADS** | Pieces must be adjacent or must not skip ambient trivia. Thin `parser({trivia:null}, …)` wrapper. |
| `parser` | **SPREADS** | A nested parser needs local trivia policy. Transparent to children. |
| `attempt` | **SPREADS** | A speculative arm may consume before failing and must allow outer backtracking. |
| `label` | **SPREADS** | Diagnostics need a clearer expected label. Rewrites `expected`, not children. |
| `trivia` | **SPREADS** | A parser describes trivia for a grammar or nested parser mode. Rebinds inner `parse` unchanged. |
| `classifiedTrivia` | **SPREADS** | Root trivia needs named arms. Built from `trivia(oneOrMore(choice(…)))`; inherits that spread. |
| `withCtx` | **SPREADS** | A parser branch must read or adjust parse context explicitly. |
| `field` | **SPREADS** | A semantic reducer needs a named captured child. Adds a **field** entry; the child still spreads positionally. |
| `dispatch` | **SPREADS** | A parsed string value routes known/generic continuations without reparsing the opener. Contributes what the selected branch contributes. |
| `ref` | **SPREADS** | A grammar references a rule by name outside the `rules()` proxy shape. |
| `rules` | **SPREADS** | A grammar factory needs recursive named rules. Each named rule contributes per its own shape. |
| `expect` | **SPREADS** | A missing delimiter needs a stronger diagnostic at a known point. Contributes its inner parser's children. |
| `balanced` | **SPREADS** ⚠️ | A scanner must skip balanced delimiter pairs inside a bounded run. **See the defect note below — this one is a trap.** |

> ⚠️ **`balanced` is inconsistent with its sibling `scanTo` and this is a
> parseman defect, not a doc gap.** `scanTo` emits its whole run as ONE leaf.
> `balanced` is declared `Combinator<string>` and its implementation ends in a
> reassembly callback that concatenates the interior back into a single string —
> but it is spelled
> `transform(sequence(literal(open), many(choice(self, …)), expect(literal(close))), fn)`,
> and because `transform` is transparent that reassembled string **never reaches
> the parent's children**. Measured: `balanced('(', ')')` on `"(a(b)c)"`
> contributes **7** children `['(','a','(','b',')','c',')']`, not one.
> `token(...)` or `leaf(...)` in place of `transform(...)` would make it ONE and
> match both its type and `scanTo`. Filed as **P19** in
> `docs/architecture/core/DESIGN-DECISIONS.md`. Until it is fixed upstream,
> **wrap every `balanced(...)` whose children you read in `token(...)`.**

### Zero-width assertions — contribute NO child (3)

| Export | Contract | Use it when |
| --- | --- | --- |
| `peek` | **ZERO** | The parser must assert a small required shape without consuming it. |
| `not` | **ZERO** | The parser must assert a small forbidden shape without consuming it. |
| `gate` | **ZERO** | A custom predicate is the smallest correct guard. Signature is `gate(predicate)` — it takes no inner combinator. |

### Dispatch case descriptors — not parsers (6)

These build case-table entries consumed by `dispatch(...)`. They never parse, so
they contribute nothing themselves; the branch parser they carry contributes per
its own contract.

| Export | Contract | Use it when |
| --- | --- | --- |
| `when` | **N/A** (branch's own contract applies) | One dispatch branch matches an exact key or matcher. |
| `otherwise` | **N/A** (branch's own contract applies) | The same routed token family has a generic fallback. |
| `makeWhen` | **N/A** | Many dispatch branches share the same case policy. |
| `startsWith` | **N/A** | A dispatch branch is selected by a routed value prefix. |
| `endsWith` | **N/A** | A dispatch branch is selected by a routed value suffix, usually glued `(`. |
| `matches` | **N/A** | A dispatch branch needs a regex predicate over the already-routed value. |

### Grammar assembly and entry points — not combinators (7)

| Export | Contract | Use it when |
| --- | --- | --- |
| `compose` | **N/A** | A grammar composes reusable grammar pieces under the same host-mode contract. |
| `composeLeaf` | **N/A** | A grammar imports a terminal leaf rule, not a composable subtree. |
| `compile` | **N/A** | A grammar is lowered to generated parser code. The compiled path emits the **same** per-combinator contracts as the interpreter. |
| `parse` | **N/A** | A combinator should be run directly in tests or small tools. |
| `run` | **N/A** | Document-style evaluation returning a `RunResult`. |
| `parseDoc` | **N/A** | Functional/document-style Parseman evaluation outside the grammar files. |
| `runWithGrammarCoverage` | **N/A** | A run should also record grammar coverage. |

### Tooling, CST, analysis, coverage, source mapping — not combinators (47)

None of these participate in a parse; all are **N/A** for spreading.

| Exports | Contract | Use them when |
| --- | --- | --- |
| `analyzeGating`, `analyzeGatingRules`, `analyzeGrammarGating`, `formatGatingWarnings`, `firstSetToString` | **N/A** | Reviewing first-set quality, shared opener choices, and macro-buildability blockers. |
| `analyzeDuplication`, `analyzeDuplicationRules`, `formatDuplicationFindings`, `duplicationFindingCount`, `siteToString`, `alternationGroups`, `keywordRegexShape`, `extractCharClasses`, `charClassMembers`, `keywordAlternationHazards` | **N/A** | Reviewing duplicate grammar structure, keyword-regex anti-patterns, and near-identical dialect copies. |
| `diagnoseGrammar`, `formatGrammarDiagnosis` | **N/A** | Producing a whole-grammar diagnosis report. |
| `grammarCoverageDefinitions`, `compiledGrammarCoverageDefinitions`, `composedGrammarCoverageDefinitions`, `createGrammarCoverageCollector`, `GRAMMAR_COVERAGE_DEFINITIONS` | **N/A** | Enumerating and collecting grammar coverage points. |
| `createGrammarInstrumentationContext`, `createGrammarTraceSink` | **N/A** | Instrumenting or tracing a parse for diagnostics. |
| `completionsAt`, `isParseError` | **N/A** | Editor diagnostics and completion-facing parser utilities. |
| `cstBuildHost`, `createVisitor` | **N/A** | Supplying a CST build host or walking a built tree. |
| `buildTriviaIndex`, `buildRootTriviaIndex`, `triviaEntries`, `triviaKindMask` | **N/A** | Reading trivia recorded during a parse. |
| `buildLineIndex`, `createLineIndex`, `normalizeLineIndex`, `offsetToLineCol`, `recordLineRange` | **N/A** | Offset-to-line/column mapping. |
| `annotateSpan`, `annotateTreeSpans`, `absoluteSpanAt`, `absoluteSpanCST` | **N/A** | Annotating spans with line/column information. |
| `relativize`, `absolutize`, `relativizeCST`, `absolutizeCST`, `shiftAbsolute`, `applyEdit` | **N/A** | Relative/absolute span conversion and incremental edit support. |

---

## Export coverage

`parseman@0.46.0` has **107 runtime exports** (`Object.keys` of the package
entry: 106 functions + 1 symbol); the previous `0.45.0` floor had 95. Verify with
`node scratchpad/cheat-sheet/coverage.mjs`, which fails if any export is
undocumented or any documented name is a phantom — it reports 107/107 documented,
0 undocumented, 0 phantoms at this floor.

Before this revision the sheet's two Surface
tables named **13 identifiers that parseman does not export at all** — `guard`,
`walk`, `OffsetIndex`, `buildOffsetIndex`, `collectLeafSlots`, `gapText`,
`lineBreaksIn`, `blankLinesIn`, `lineStartWithin`, `indentWidth`, `indentMixed`,
`commentsIn`, `gapIsSignificant` — and left **16 real exports unmentioned**.
Worse, **zero** of the 95 had the mechanical contract (arity / empty / commit)
written down anywhere; that is the gap this revision closes.

`guard` is gone: use `gate`. The CST/offset helpers above were either renamed or
never existed under those names; `createVisitor` and the `relativize`/
`absolutize` family are the real surface.

Previously undocumented, now listed below: `diagnoseGrammar`,
`formatGrammarDiagnosis`, `examinedNothing`, `classifiedTrivia`,
`annotateTreeSpans`, `buildRootTriviaIndex`, `createLineIndex`,
`recordLineRange`, `normalizeLineIndex`, and the grammar-coverage family
(`GRAMMAR_COVERAGE_DEFINITIONS`, `grammarCoverageDefinitions`,
`compiledGrammarCoverageDefinitions`, `composedGrammarCoverageDefinitions`,
`createGrammarCoverageCollector`, `createGrammarInstrumentationContext`,
`createGrammarTraceSink`, `runWithGrammarCoverage`).

## The CSS-Family Choice

| Shape | Use | Do not use |
| --- | --- | --- |
| `dispatch(combinator, when(...), otherwise(...))` | One shared broad opener is already parsed, the matched text decides a known/generic branch, and the same token family has a generic fallback. | Closed literal tables, disjoint statement/body alternatives, or delimiter decisions that happen after the shared opener. |
| `choice(...)` | Alternatives have distinct first sets, are literal-led, are closed keyword/operator sets, or are body/list item families where each arm owns a different construct. | Sibling arms that all restart from `ident`, `name(`, `@name`, `:name`, or another broad opener before selecting known/generic continuations. |
| `keywords(...)` / `word(...)` | Fixed spelling sets with a boundary policy: CSS keywords, at-keyword names, operators, units, named colors. | Syntax whose next parser branch depends on the full matched token or suffix; use `dispatch(...)` for that. |
| `oneOrMoreSep(...)` / `sepBy(...)` | A real separated list. Use `oneOrMoreSep(...)` when the list cannot be empty; add an explicit optional terminator outside the list when the language owns one. | Hand-written `sequence(item, many(sequence(sep, item)))` unless the separator carries non-list semantics. |
| Left-factor or a context helper | The opener is shared but the decision is a later delimiter or context-owned fact. | Dispatching on the opener before the grammar has enough information. |
| `peek(...)` / `not(...)` | A small ownership assertion that would be wrong to consume. | Broad leading lookahead, reparse guards, or substitutes for a missing first-set/routed shape. |

Analyzer overlap is a prompt for review, not an instruction to use
`dispatch(...)`. A valid answer may be "`choice(...)` is the right shape here",
"left-factor this later", or "route the shared opener once"; choose the one that
matches the language boundary.

For every CSS-family `choice(...)` touched during the rewrite, classify it
before editing:

- **Routed token family**: one broad opener is consumed once, its matched value
  chooses known cases, and the same family has a generic continuation. Use
  `dispatch(...)`.
- **Closed spelling table**: the alternatives are fixed keywords, operators, or
  punctuation. Use `word(...)`, `keywords(...)`, or a small literal
  `choice(...)`.
- **Separated list**: the separator is grammar structure. Use
  `oneOrMoreSep(...)` / `sepBy(...)`, with any legal trailing terminator outside
  the list.
- **Construct family**: each arm owns a different body/list/statement shape.
  Keep `choice(...)` unless a smaller shared prefix can be left-factored.
- **Context decision**: the opener is shared, but a later delimiter or caller
  context decides the branch. Left-factor or write a context helper; do not
  dispatch on an opener that has not consumed the deciding syntax.

Canonical shared-opener dispatch:

```ts
const caseOf = makeWhen({ caseInsensitive: true });

const identOrFunction = token(noTrivia(sequence(
  ident,
  optional(literal('('))
)));

const UrlFunction = node(
  'Url',
  sequence(routed(), urlBody, literal(')')),
  children => urlFrom(children)
);

const GenericFunction = node(
  'Call',
  sequence(routed(), functionArguments, literal(')')),
  children => callFrom(children)
);

const RoutedKeyword = node(
  'Keyword',
  routed(),
  children => keywordFrom(children)
);

const Value = dispatch(
  identOrFunction,
  caseOf('url(', UrlFunction),
  caseOf('calc(', CalcFunction),
  when(endsWith('('), GenericFunction),
  otherwise(RoutedKeyword)
);
```

Note that `identOrFunction` above is wrapped in `token(...)` precisely because
it contains an `optional(...)`: that makes it ONE leaf with fixed arity instead
of a variable-arity pair.

The routed combinator must consume the syntax that decides the branch. CSS and
Less function names are glued to `(`, so `name(` belongs in the routed opener;
`name (` is an identifier followed by later parenthesized syntax if that context
allows it.

Keep `Identifier` and `Keyword` as separate slots. `Identifier` is for
identifier-shaped grammar structure outside value position, such as selector
pieces, attribute names/modifiers, property-ish names, and at-rule names.
`Keyword` is for value-position identifier facts. In value position, route
`IdentifierOrFunction`: a bare identifier can become a `Keyword` value and a
glued `name(` opener can dispatch to known/generic function bodies. Do not use
the value `Keyword` slot merely because the raw CSS recognizer happens to share
the same spelling as an identifier.

Expression-shaped values are still policy-bound. Less value math/comparison
lowers through its expression grammar according to `mathMode`; Jess math,
comparison, and leading-dot lookup are expression-only and require the explicit
`$()` boundary. Do not use a local parser retry or broad value arm to smuggle
one dialect's expression policy into another dialect's ordinary value position.

Before changing a CSS-family `choice(...)` into `dispatch(...)`, write down the
routed value the first combinator returns. If that value is only `@`, `(`, `:`,
or a bare identifier whose following delimiter decides the language branch, the
rewrite is premature. Either include the deciding syntax in the routed
combinator, left-factor the shared structure, or keep the `choice(...)`.

Use this quick review:

- **Can I name the routed value?** `identOrFunction` routes `url(`, `calc(`, and
  bare `red`; an at-keyword opener routes `@media` and `@layer`.
- **Does that value decide the branch?** `url(` decides a URL function; bare
  `@` does not decide Less variable declaration vs at-rule vs reference call.
- **Is there a same-family generic fallback?** Known CSS functions plus generic
  `name(` and bare identifiers are one family; body items and declaration-list
  items are separate constructs and should stay `choice(...)`.

CSS examples:

- Use `dispatch(...)` for `IdentOrFunction`, `CalcIdentOrFunction`,
  `TypedIdentOrFunction`, pseudo-functions, and at-keyword families with a
  generic at-rule fallback.
- If two exported/contextual names use the same routed opener, known cases, and
  generic fallback, share one internal dispatch combinator and alias the names;
  do not duplicate the table just to preserve local rule vocabulary.
- Inside `var()` fallbacks, keep the outer component-family `choice(...)`, but
  route the identifier/function-shaped component family once. Nested `var(` and
  generic `name(` need fallback-specific comma semantics, so do not blindly
  reuse the ordinary typed-value function body.
- Keep `choice(...)` for declaration-list items, page/keyframes/font body items,
  punctuation/operator tables, closed keyword sets, and local statement-vs-block
  tails after an at-keyword route.
- Declaration names belong to the enclosing **statement-start router**, not to
  a property-local preflight. The horizontal body shape is: keep the broad
  construct-family `choice(...)`; route `@` through the at-keyword family;
  send class/id starts through the mixin-or-qualified-rule gate where that
  dialect has one; send identifier and interpolation starts through one
  `IdentifierOrInterpolation` declaration-or-qualified-rule helper; send every
  remaining selector start straight to a qualified rule. That helper parses the
  name/interpolation prefix once and retains it for both continuations.
- "Retains" is mechanical, not a new grammar concept: do not introduce an
  `IdentifierStart` fact, a generic `Statement` node, or another CST wrapper to
  carry the prefix. The selected existing semantic node (`Declaration`,
  `Ruleset`, `MixinCall`, or `MixinDefinition`) owns the replayed prefix and
  builds its normal result directly. Ordinary valid statement traffic must not
  enter an `attempt(...)` rollback path merely to choose one of those families.
- The identifier/interpolation helper is a context decision, shared across all
  four grammars. After the retained prefix: no `:` continues as a qualified
  rule; `:` followed by trivia commits a declaration; `:` glued to the next
  identifier remains the pseudo-qualified-rule ambiguity. For that final glued
  shape, continue through the selector structure to its opening `{` before
  choosing the qualified-rule path; otherwise retain the declaration parsing
  error. Do not dispatch on the bare prefix alone, and do not replace this
  route with a broad declaration-name `peek(...)`.
- CSS owns the static statement-start family. Less, SCSS, and Jess override
  only the precise prefix atom or continuation they expand (for example an
  interpolation-bearing name), never the whole body or qualified-rule shape.
- Do not route `QueryFeature` on bare `(`. The feature family needs a
  left-factored helper that preserves public CST owners while sharing the opener.
  The branch is decided later by `)`, `:`, comparison operators, and whether the
  first interior value is a property or a query value.

Less examples:

- Use `dispatch(...)` for `IdentifierOrFunction` and query
  identifier-or-function leaves: route exact glued function openers, route
  `when(endsWith('('), ...)` to the generic function, and send bare identifiers
  to `otherwise(...)`.
- Use dispatch for Less `@name` families only when the routed opener includes
  enough syntax to distinguish the branch. Bare `@` is not enough: variables,
  at-rules, mixin/reference calls, and imports/plugins all begin there.
- Less `@name` and mixin families are dispatch candidates only after the routed
  opener includes the deciding delimiter or suffix. Bare `@`, bare `.foo`, and
  bare `#foo` are not enough.
- Keep `choice(...)` for body items, delimiter choices, statement/block tails,
  and public CST owner families whose safe shared-opener rewrite has not been
  designed yet.

CSS ownership, horizontal cleanup, and at-rule cleanup rule:

- All CSS structure is CSS-owned unless a downstream grammar changes that
  exact structure. Even then, override only the smallest changed child, value
  slot, or reference; a dialect change is not a license to replace the whole CSS
  rule. Less/SCSS/Jess should be lean overlays that describe only the syntax they
  add or the specific CSS substructure they change. Interpolation is a
  leaf/value extension point, not a reason to reimplement a whole CSS production
  from scratch.
- CSS may be cleaned vertically until spotless. Less, SCSS, and Jess cleanup
  should move horizontally by production family: imports, at-rules, quoted
  values, identifiers/functions, pseudo selectors/functions, selector starts,
  query/supports/container forms, guards, custom-property values, values, and
  declaration/property access should converge as one shared structure plus the
  smallest necessary dialect slots.
- Treat at-rules as routed at-keyword families. Do not "clean up" at-keyword
  regexes by replacing them with `word(...)` / `makeWord(...)` as the final
  shape.
- The target shape is one consumed at-keyword router plus `dispatch(...)`,
  `makeWhen(...)`, and `routed()` in the selected branch so the node owns the
  consumed keyword/span.
- A local `choice(...)` may remain after the at-keyword is routed when the
  branch is decided by later syntax such as `{`, `;`, a prelude form, or the
  caller's body context. Document that delimiter/context at the const.
- If a `choice(...)` has multiple sibling `@...` arms, classify it as a
  routed-at-keyword family first. Preserve it only with a written exception that
  names why the routed value cannot decide the branch.

## Floor check: what the 0.46 floor unlocked

The mechanical table above is the single source of truth for what each export is
and when to use it. This section records what changed when the floor moved from
`^0.45.0` to `^0.46.0` (`ff685793a`) — each verified by `Object.keys` on the
resolved package entry, not by reading upstream source:

| Export(s) | Status |
| --- | --- |
| `analyzeChoiceInventory`, `profileWastedWork`, `choiceSiteKey`, `armLabel`, `renderChoiceInventory`, `renderWastedWork`, `leftFactorPreview`, `checkWastedWork`, `buildWastedWorkBaseline` | **Now available.** All nine were absent from 0.45 and are present at 0.46. Choice-cost diagnostics: static shared-prefix inventory, interpreted-corpus wasted-work profile, and the gate policy over them. Quiet by default. |
| `examinedNothing` | **Now available.** Separates "measured, and it is bad" from "could not measure" for `diagnoseGrammar`. |
| `fuseInterpreted`, `isInterpretedFuse` | **Now available.** Interpreted-fuse predicates for `compose`. |
| `guard` | **Removed — not an export at any version in play.** Use `gate`. |

Two usage caveats that the contract column has no room for:

- `diagnoseGrammar` is **the** diagnostic entry point. `compile()` reports nothing
  by itself.
- Use `analyzeGrammarGating` for a **composed** grammar. A `compose()` result holds
  rule *functions*, not combinators, so `analyzeGatingRules` cannot walk it.
- `run()` returns a `RunResult` — **check its `unconsumedFrom`.** A run that
  consumed nothing still reports success without it.

## Anti-Patterns

- **Do not read a fixed child index past a `many`, `optional`, `sepBy`,
  `oneOrMoreSep`, `choice`, or `transform`.** Wrap the group in `node()`, or a
  variable-arity terminal in `token()`, first. This is the top entry because it
  is the most expensive recurring defect in the grammar lanes.
- **Do not reach for `noTrivia` when a compound splits.** Print the reducer's
  children first. Three separate lanes lost a round to this exact reflex.
- Do not write keyword regexes such as `regex(/@page(?![-\w])/i)` when a
  routed at-keyword family should own the branch. Route the at-keyword once
  with `dispatch(...)` / `makeWhen(...)` / `routed()` instead of swapping one
  at-keyword terminal spelling for another.
- Do not hand-roll non-empty separated lists as `sequence(item,
  many(sequence(separator, item)))` when `oneOrMoreSep(item, separator)` states
  the same shape.
- Do not split `url(`, `calc(`, `var(`, generic `name(`, and bare identifiers
  into sibling `choice(...)` arms. Parse the opener once and route it.
- Do not use `dispatch(...)` as a prettier `choice(...)`. Literal-to-literal
  and closed keyword/operator choices are already cheap and clearer as
  `choice(...)` or `keywords(...)`.
- Do not commit on a branch before the grammar has enough syntax. Less `@` and
  parenthesized query features are the standing examples.
- Do not preserve dialect/common prefixes when the accepted language does not
  differ. Prefer the spec production name or the smallest plain name.
- Do not parse comments as body items, selector/value leaves, or padding around
  separators. Comments are trivia. A block comment that makes an otherwise empty
  Less ruleset renderable is a trivia-backed renderability fact over the body
  span, not a `Comment` child in the rules list.

## THE MECHANICAL CONTRACT

**This section exists because five distinct defects in one session came from it,
every one invisible to a parse-success check and to a green test suite.** The
prescriptive guidance above tells you which combinator states your language
boundary. This section tells you what the combinator you picked actually *does*
to your reducer. They are different questions and the second one is where the
bugs are.

Four questions per combinator:

1. **Arity** — how many entries it contributes to the enclosing reducer's
   `children` array, and when that count varies.
2. **Empty** — can it succeed consuming nothing.
3. **Commit** — can it fail *after* consuming, so the site needs rollback.
4. **Trap** — what looks right and silently isn't.

### Arity: measured contribution to `children`

Measured by `node('P', X, children => children)` — `node()` captures exactly
what its body contributed, so wrapping `X` alone measures what `X` hands to an
enclosing children array. Source: `scratchpad/cheat-sheet/probe-arity.mjs`.

| Combinator | Arity | Measured |
| --- | --- | --- |
| `literal` | **exactly 1** | `literal('a')` on `"a"` → 1 leaf. `literal('')` still contributes a slot (empty leaf). |
| `regex` | **exactly 1** | 1 leaf |
| `keywords` / `word` / `makeWord(...)(...)` | **exactly 1** | 1 leaf |
| `token` / `leaf` | **exactly 1** | collapses its whole body to one leaf |
| `scanTo` | **exactly 1** | the scanned span as one leaf |
| `node` | **exactly 1** | the node, regardless of how many children *it* captured |
| `sequence` | **SPREADS — one per term** | `sequence(a,b,a)` → **3**. **Nested sequences FLATTEN**: `sequence(a, sequence(b,a))` → **3**, not 2. |
| `choice` | **VARIABLE — whatever the winning arm contributes** | `choice(a, sequence(b,a))` → **1** on `"a"`, **2** on `"ba"`. |
| `many` | **SPREADS — 0..n** | `many(a)` → 0 / 1 / 3 for `""` / `"a"` / `"aaa"` |
| `oneOrMore` | **SPREADS — 1..n** | `"aaa"` → 3 |
| `optional` | **0 or 1** | present → 1, absent → **0** |
| `sepBy` / `oneOrMoreSep` | **SPREADS — items *and separators*** | `sepBy(a, literal(','))` on `"a,a,a"` → **5**: `[a , a , a]`. The commas are children. |
| `dispatch` | whatever the selected branch contributes | branch is usually a `node`, so 1 |
| `routed` | 1, **only inside a dispatch branch** | outside one it fails (`expected: routed()`) |
| `transform` | **PASS-THROUGH — spreads the body's arity** | `transform(sequence(a,b), fn)` → **2**, *not* 1 |
| `attempt` / `noTrivia` / `label` / `field` / `withCtx` | **PASS-THROUGH** | body's arity unchanged |
| `not` / `peek` / `gate` | **ZERO** | contribute no child at all |
| `expect(X)` | **1 if `X` matched, ZERO if it did not** | shifts later indices exactly like `optional` |
| `skip(main, skipped)` | **2** | the skipped parser contributes a leaf of its own |
| `balanced(open, close)` | **SPREADS — 3** | `"(ab)"` → `['(', 'ab', ')']` |

Two of these have already shipped bugs and are restated with their measured
consequence below. Three more — `sequence` flattening, `choice` varying, and
`sepBy` emitting separators — have the same failure mode and no incident yet.

### `many()` SPREADS its matches into the children list

It does **not** hand the reducer one array child.

```js
Block = node('Block', sequence(literal('{'), many(item), literal('}')),
             children => children[1])
run(Block, '{a:b;c:d}')   //  -> a single Declaration. NOT a list.
```

`children[1]` is the **first statement**, not the statement list. Measured
consequence: **every multi-declaration rule dropped all but its first
declaration**, and every at-rule body was empty while the body's first
statement surfaced in the *prelude* slot.

Measured directly: `sequence(literal('<'), many(a), literal('>'))` on `"<aaa>"`
yields **5** children `['<','a','a','a','>']`.

### A non-matching `optional()` contributes NOTHING and shifts every later index

```
sequence(literal('<'), X, literal('>'))  on "<a>" -> 3 children ['<','a','>']
                                         on "<>"  -> 2 children ['<','>']
```

`"<>"` yields `['>' at index 1]` — **not** `[undefined, '>']`. Any reducer
indexing past an optional reads the wrong child, with no arity error and no
exception. Confirmed live: `sequence(routed(), optional(prelude), Block)` with
`children[1], children[2]` put the **body in the prelude slot** for
`@font-face{a:b}`.

`expect(X)` behaves the same way when `X` does not match: **zero** children, and
every later index shifts. That is a second, less obvious source of the identical
defect.

### The killed hypothesis: `literal()` matches are NOT dropped

This is the obvious explanation for both symptoms above and it is **false**.
Stated here so nobody re-derives it:

```
literal('a')                              on "a"     -> 1 child  ['a']
sequence(literal('a'), literal('b'), literal('c'))
                                          on "abc"   -> 3 children ['a','b','c']
sequence(literal('('), ident, literal(')'))
                                          on "(abc)" -> 3 children ['(','abc',')']
```

Punctuation occupies children slots. Every one of them.

### `children` arity and the raw `parse()` value arity are DIFFERENT

`not`, `peek`, `gate`, and a non-matching `expect` contribute **zero** children
to a `node()` reducer, but they **do** occupy a slot in the value array that a
raw `parse()` of a `sequence` returns:

```
node children  : sequence(M, not(...), N)   -> 2   ['<', '>']
parse() value  : sequence(not(...), a)      -> 2   [null, 'a']
parse() value  : sequence(gate(...), a)     -> 2   [null, 'a']
parse() value  : sequence(expect(z), a)     -> 2   [ParseError, 'a']
```

So a reducer written against `children` and a test written against the raw parse
value will disagree about positions. Grammar reducers see `children`. Do not
port an index from one to the other.

### Empty: can it succeed consuming nothing

Source: `scratchpad/cheat-sheet/probe-empty-commit.mjs`.

| Succeeds consuming ZERO | Cannot match empty |
| --- | --- |
| `many` (zero matches) | `literal`, `regex` (non-nullable pattern) |
| `optional` (absent) | `keywords`, `word` |
| `sepBy` (empty list) | `oneOrMore`, `oneOrMoreSep` |
| `not` (assertion passes) | `sequence` of non-nullable terms |
| `peek` (assertion passes) | `choice` of non-nullable arms |
| `gate` (predicate true) | `node` / `transform` / `label` / `field` over a non-nullable body |
| **`expect(X)` — even when `X` cannot**| `attempt` over a non-nullable body |
| `regex(/a?/)` and any nullable pattern | `scanTo` (unless the sentinel is at `pos`) |
| `regex(/(?=a)/)` — pure lookahead | `balanced` |
| `scanTo` when the sentinel is immediate | |

**`expect(X)` converts failure into a zero-width SUCCESS.** It returns
`{ok: true, value: ParseError}` — measured `value._tag === 'parseError'`, span
`{0,0}` — and pushes the error to the recovery channel. Measured: `expect` alone
on input it cannot match returns `ok=true`, zero-width, one recovered error.

Treating `expect(X)` as `matchesEmpty` produced **38 tree mismatches**. It is
nullable regardless of whether its body is.

**A pure-lookahead regex never matches the empty *string* yet always matches
zero-width.** `/(?=a)/.exec('')` is `null`, but `/(?=a)/.exec('abc')` matches at
index 0 with length 0. **A nullability check written as `exec('')` misses this
entire class.** Measured: `parse(regex(/(?=a)/), 'abc')` → `ok=true`, span
`{0,0}`.

### The analyzer's nullability table DISAGREES with runtime

parseman's internal `matchesEmpty` (`src/combinators/first-set.ts`) drives
first-set gating, `choice` disjointness, and every fast-path guard. It is
documented to err toward `true` when unsure. It does not always:

| | analyzer says | runtime does | direction |
| --- | --- | --- | --- |
| `expect(X)` | **not nullable** (it delegates to `X`) | **always** zero-width succeeds | **UNSOUND — under-reports** |
| `attempt(X)` | nullable (falls to `default`) | only if `X` is | over-reports (safe) |
| `field(n, X)` | nullable (falls to `default`) | only if `X` is | over-reports (safe) |
| `gate` | nullable (tag is `guard`, unlisted) | zero-width by nature | correct by accident |
| `scanTo` | nullable (falls to `default`) | only if sentinel is immediate | over-reports (safe) |

The `expect` row is the dangerous one and is the direct cause of the **38 tree
mismatches**: a sequence's nullable-prefix walk stops at an `expect` term, so
terms after it never contribute first characters, and a `choice` can be marked
O(1)-dispatchable when an `expect`-led arm actually matches at every position.

The over-reporting rows are safe but not free: **any arm wrapped in `attempt` or
`field` is reported nullable regardless of its body**, which silently disables
the O(1) dispatch the gating analysis exists to produce. If a `choice` you
expected to be gated is not, look for an `attempt` or `field` wrapper before
you look at the language.

*(Analyzer table read from `first-set.ts` at parser-thing `bb2e587` (0.46) and
cross-checked against measured runtime behaviour. The runtime column is
measured; the analyzer column is read from source.)*

Corollary: `many(expect(X))` is a no-progress construct. Measured on `"zzz"` it
returns `ok=true`, span `{0,0}`, and **zero recovered errors** — the repetition's
no-progress stop prevents the hang but also **silently discards the
diagnostic** `expect` existed to produce. Never put `expect` directly under a
repetition.

### Commit: can it fail after consuming

The question a call site actually needs answered: **do I need `attempt`?**

| Combinator | Fails after consuming? | Raises `committed`? |
| --- | --- | --- |
| `literal`, `regex`, `keywords`, `word` | No — terminals fail at their start position | no |
| `sequence` | **Yes** — a later term's failure leaves earlier terms consumed | propagates only |
| `choice` | Inherits from its arms; a committed arm failure is **not** retried by the next arm | propagates only |
| **`dispatch`** | **Yes — and it is the library's only true CUT** | **RAISES it** |
| `attempt(X)` | Rolls back *position* for an uncommitted failure. **Does NOT clear `committed`.** | propagates |
| `many` / `optional` / `sepBy` | **Do not swallow a *committed* body failure.** Totality holds **only when the body cannot commit.** | propagates |
| `oneOrMore` / `oneOrMoreSep` | Yes, via the first item | propagates |
| `not` / `peek` | No — assertions restore position, and they *swallow* a committed inner failure | swallows |
| `expect` | **Never fails at all — it also ERASES commit** | erases |
| `scanTo` | Fails clean at EOF unless `orEOF: true` | no |
| `balanced` | Recovers rather than failing (see below) | no |

### `dispatch()` is a hard cut, and `attempt()` does NOT undo it

Once a dispatch branch is selected, **every** failure inside it comes back
`committed: true`. Measured, on `"url("` where the selected branch then wants a
missing `)`:

```
bare dispatch                             ok=false  committed=true
attempt(dispatch)                         ok=false  committed=true   <-- NOT neutralised
optional(dispatch)                        ok=false                   <-- optional FAILS
many(dispatch)                            ok=false                   <-- many FAILS
choice(dispatch, literal('url('))         ok=false                   <-- second arm NOT tried
choice(attempt(dispatch), literal('url(')) ok=false                  <-- still not tried
```

Contrast an **uncommitted** failure (a plain `sequence` missing its second term):

```
bare sequence                             ok=false  committed=false
attempt(sequence)                         ok=false  committed=false
optional(sequence)                        ok=true                    <-- recovers
choice(sequence, literal('a'))            ok=true                    <-- second arm tried
```

> **`attempt` is not a rollback guarantee.** It restores position for an
> uncommitted failure; it does not make a committed failure recoverable. If you
> wrapped a `dispatch` in `attempt` expecting the enclosing `choice` to try its
> next arm, it will not. The only construct that erases commitment is `expect`,
> and it does so *by accident* — by never failing at all.

The design consequence is the one the prescriptive section already states from
the language side: **do not commit on a branch before the grammar has enough
syntax**, because after `dispatch` selects, there is no way back.

The practical rule for the rest: **`optional(X)` and `many(X)` are only as total
as `X` is uncommitted.** If `X` is a multi-term `sequence`, `optional(X)` can
still fail the whole enclosing rule — and `attempt` fixes that case, just not
the `dispatch` case.

### Traps, per combinator

What looks right and silently isn't. Read from parseman source at the pinned
0.46 floor unless marked *measured*; where 0.46 changed behaviour from the
previous 0.45 floor it is noted. **These are source reads, not tree dumps, except where marked.**

| Combinator | Trap |
| --- | --- |
| `literal` | `caseInsensitive` is an **ASCII-only** fold. On the case-sensitive path the value is the declared string; on the CI path it is the *matched slice*. |
| `regex` | The first-set analysis is **flag-agnostic**: `/i` combined with `u`/`v` degrades the first set to "any", **silently killing dispatch** on that arm. |
| `keywords` | The reported `expected` is the literal string `'keyword'`, not your word list. |
| `word` / `makeWord` | Overload hazard: `word(str, opts)` vs `word(str, boundary, opts)`. **Passing an options object as the second argument silently uses the DEFAULT boundary** `_0-9A-Za-z`. `makeWord` returns a *factory*, not a combinator. |
| `sequence` | Nested sequences **flatten** into one children list *(measured)*. Under value-usage elision the value can be `undefined` instead of a tuple, so a reducer destructuring `[a, b]` breaks. |
| `choice` | When no arm matches under a disjoint gate, it **re-runs every arm** to build `expected` — so arm side effects, including `expect()` pushes, happen twice. `disjoint` is computed at *construction* time, so a `ref` defined later leaves it stale. |
| `dispatch` | The cut (above). `otherwise()` must be last and there can be only one. Duplicate keys throw at construction. |
| `when` / `otherwise` / `startsWith` / `endsWith` / `matches` | These are **descriptor objects, not combinators** — they cannot be used outside a `dispatch`. `matches()` rejects `g`/`y` flags. Matcher arms are tried after exact keys, in declaration order. |
| `routed` | Position-sensitive: if the branch is not at the routed item's start it silently takes the fallback or fails *(measured: fails outside a dispatch)*. Its first set is always "any", which **poisons an enclosing dispatch**. |
| `many` / `oneOrMore` | A **zero-width item silently stops the loop** rather than looping forever — so a nullable body just yields zero items and you get a plausible empty list. `oneOrMore` parses its **first** item with no leading-trivia skip, asymmetric with items 2..n. |
| `optional` | Its first-set skip is **not** gated on tolerant mode, unlike every sibling guard. |
| `sepBy` / `oneOrMoreSep` | Separators **are children** *(measured)*. Default `trailing: 'forbid'` leaves a trailing separator **unconsumed** rather than failing — a classic silent-leftover source. Failure is anchored at the furthest position, not the list start. |
| `not` / `peek` | Both **swallow a committed inner failure**. `peek`'s first set becomes "any" when its body is nullable, forfeiting the gate it exists to provide. `not(not(X))` is an anti-pattern — use `peek`. |
| `attempt` | Does **not** clear `committed` *(measured)*. Reported nullable by the analyzer regardless of its body. |
| `node` | Under a CST host **your `build` reducer is bypassed entirely**. `build` receives `undefined` for `fields`/`rawChildren`/`triviaLog` when arity gating decided you don't read them — a rest-param or untyped reducer fails open. A missing `type` outside `rules()` throws at *parse* time, not construction. |
| `transform` | Shares `_meta` **by reference** with its inner combinator — mutating one mutates both. Contributes the body's arity, **not** 1 *(measured)*. |
| `skip(main, skipped)` | **It does not skip anything.** The skipped parser's leaves **are captured as children** *(measured: arity 2)*; it appends an optional trailer to the span and discards only its *value*. |
| `trivia` | Keeps the **inner's `_tag`** while `_def.tag` is `'trivia'`, so any `_tag`-based check misidentifies it. |
| `classifiedTrivia` | Throws at construction unless every arm is non-nullable with a finite first set. Required by `run({ rootTrivia })`. |
| `label` | Replaces `expected` but **keeps the inner's failure span** — your message, the inner's position. |
| `field` | The field push is optional-chained: if `node()` decided it doesn't read fields, **the field is silently dropped**. Still occupies a positional children slot *(measured)*. |
| `token` | Clears ambient trivia for its body. |
| `leaf` | Unlike `token`, it does **not** clear trivia — the body still skips trivia *inside* your "leaf". |
| `gate` | Its first set is "any", so as a leading term it **kills dispatch**. Its tag is `guard`, not `gate`. |
| `withCtx` | **Spreads a fresh ctx object.** Array sinks survive by reference, but anything the inner *assigns* onto ctx is written to the copy and lost. |
| `expect` | Erases `committed`; discards its diagnostic entirely if no error sink is installed (i.e. without `parse(..., { recover: true })`). |
| `ref` | `_meta.firstSet` is "any" until `.define()`, and **combinators built over a ref bake that stale value in at construction**. `.define()` twice throws; use before define throws *(measured)*. |
| `rules` | Stamps grammar-level metadata onto **every** rule's `_meta` — shared mutable metadata across composition. `trackLines: true` re-wraps every rule, changing its `_def.tag` to `'grammar'`. |
| `parser` | `trivia: null` **clears**, `trivia: undefined` **inherits**. They are not the same. |
| `noTrivia` | Must wrap the **whole** contiguous run: an enclosing `sequence` still skips trivia *before* the term. |
| `parse` | `errors` / `furthestFail` exist **only** under `{ recover: true }`. Without it, `expect()` records nothing *(measured)*. |
| `compose` | Composing trivia = the **last** item declaring `rules({ trivia })` wins, applied to inherited rules too. Refuses a `composeLeaf` result. |
| `run` | `ok` ignores leftover input (below). `{ profile: true }` throws outright. |

## `run()` reports success on input it never consumed

```
run(many(Item), 'zzz')                      -> ok=true  span={0,0}
run(many(Item), '!!! not a stylesheet !!!') -> ok=true  span={0,0}
run(many(Item), 'aazz')                     -> ok=true  span={0,2}
```

A root of `many(Item)` returns `ok=true` on pure garbage, because `many`
succeeds on zero matches and `run()` does not require the root to reach EOF.

> **Assert full consumption in every rig.** `ok=true` is not a parse result you
> can trust on its own.

`RunResult` carries the proper signal: **`unconsumedFrom`** — `null` when the
parse reached the end, otherwise the offset where the leftover starts. It is
trivia-aware in a way that a raw `span.end` comparison is not. Measured:

```
run(many(Item), 'aaa')  -> ok=true span={0,3} unconsumedFrom=null   <-- clean
run(many(Item), 'aazz') -> ok=true span={0,2} unconsumedFrom=2
run(many(Item), 'zzz')  -> ok=true span={0,0} unconsumedFrom=0
```

Prefer `assert(result.unconsumedFrom === null)`. Use
`span.end === source.length` where you only have a `parse()` result, which has
no `unconsumedFrom`.

**On the in-flight change:** a parseman lane was said to be changing this
default. **It has NOT landed, re-measured at the 0.46 floor.** `ok` is still
literally the root's `ok`, independent of consumption, and `RunOptions` still has
**no** full-consumption flag:

```js
run(literal('a'), 'a IGNORED TAIL')
// -> ok: true, unconsumedFrom: 1     (13 bytes left, still ok)
```

**Treat the behaviour above as authoritative and keep the assertion.** This is
the repo-side reason for `10c9fc7d8` ("don't claim a complete stylesheet when
nothing was parsed") — the parsers must check `unconsumedFrom` themselves because
parseman will not. When the floor moves again, re-run the snippet above and
record the outcome rather than assuming either state.

## `balanced()` DOES detect crossed closures

Its close is wrapped in `expect()`, which never fails — so it **recovers and
pushes to the error channel** instead of returning a failure. **A probe measuring
*consumption* cannot distinguish acceptance from recovery**, and neither can one
built on `parser({...}).parse(input)`: the error channel is populated only by
the exported `parse(combinator, input, { recover: true })`.

Measured with the error channel correctly wired, on
`balanced('(', ')', { skip: [balanced('[',']'), balanced('{','}')] })`:

| Input | ok | consumed | errors | reading |
| --- | --- | --- | --- | --- |
| `(abc)` | true | 5 | 0 | accepted |
| `(a[b]c)` | true | 7 | 0 | accepted |
| `([c}])` | true | 6 | **0** | **legitimately ACCEPTED** |
| `(a[b)c]` | true | 7 | **1** (`expected ")"`) | **crossed — detected, recovered** |
| `(unclosed` | true | 9 | **1** | detected, recovered |
| `(a[b]` | true | 5 | **1** | detected, recovered |

`([c}])` is **not** a crossed closure: with no `{`/`}` pair open, the `}` is an
ordinary character inside `[...]`. **`var(--x, ([c}]))` is legitimately
ACCEPTED** — measured `ok=true, errors=0`. **Building a grammar to reject it
breaks CSS.** `(a[b)c]` is the genuinely crossed case, and `balanced` catches it.

**Detection is conditional on the `skip` list.** A bare `balanced('(', ')')`
with no `skip` has a stop set of only `(` and `)`, so `[c}]` is consumed as
ordinary content and a crossed bracket is **not even noticed** — no error, full
success. The other bracket type must be in `skip` for the interior to stop on
it. So "balanced detects crossing" is true **only for the pairs you listed**.

Note also that `balanced` never *fails* in either case: the outcome is always
`ok=true`, with the difference visible solely in `errors`. And its span ends
*before* the missing closer, so the reconstructed text silently omits it.

The lesson generalises past `balanced`: **any construct whose close is wrapped
in `expect` accepts everything and reports through the error channel.** If you
are asking "does this grammar reject X", consumption is the wrong instrument —
read `errors`.

## Authoring hard-fails

These throw at build or first use. Each has cost at least one round.

**`composeLeaf()` is macro-only.** At runtime it throws unconditionally:

```
composeLeaf(): requires Parseman macro lowering; runtime composition is forbidden
```

Measured on the previous 0.45.0 floor: it threw for **every** argument shape —
one leaf, two leaves, zero leaves, a hoisted plain string.

**⚠️ This changed at the 0.46 floor.** Re-measured with `probe-structural.mjs`
at `parseman@0.46.0`:

| Shape | 0.45 | 0.46 |
| --- | --- | --- |
| `composeLeaf([oneLeaf])` (<2 leaves) | throws | **builds** |
| `composeLeaf([leafA, leafB])` | throws | **builds** |
| `composeLeaf([])` | throws | **builds** |
| `composeLeaf` w/ hoisted plain string | throws | still fails, different message (`Cannot read properties of undefined (reading 'tag')`) |

This is the lazy-interpreted-fuse change described in the version-divergence note
below, now landed. **It is a behaviour change, not a fix:** the runtime no longer
refuses composition, so a `composeLeaf` that should have been macro-lowered can
now build quietly and fall back to the interpreter instead of hard-failing. The
≥2-leaves requirement remains a macro-time check you cannot observe at runtime.
It must still be reached through `import ... with { type: 'macro' }`. All 16 call
sites in the four grammars use one shape:
`composeLeaf([<leaf syntaxes...>, rules<XRules>({...}, factory)])`.

The macro path's message is worded differently — `composeLeaf() must macro-fuse;
runtime composition is forbidden` — and it appends a `causes:` list naming the
precondition you actually missed. **Read the `causes:` lines**; the bare runtime
message tells you nothing. The macro enforces eight preconditions: a static
array literal; ≥2 elements; a local `rules()` map last; every pre-final element
build-resolvable; the local map statically compilable; carried recognition IR
materializable; every imported piece **proving** recognition-only
(`hasDirectBuilders === false && isRecognitionOnly === true`); and no exception
during fusion.

> **Version divergence — now VERIFIED against the released 0.46 floor.** 0.46
> (`compiler/linker.ts`) no longer throws at runtime; it builds a *lazy
> interpreted fuse* that mutates shared ref slots in place and throws only on a
> second conflicting fusion. Confirmed by re-running `probe-structural.mjs` after
> `ff685793a` raised the floor — see the table above. The previously-unverified
> prediction was correct.

> **Build order consequence:** `packages/parser-shared` must be built **first**.
> Building it late surfaces this same `composeLeaf` message, which reads like a
> grammar defect and is neither — it is a stale-artifact symptom.

**`rules()` factories must be named module-level consts taking the `g`
parameter.** Measured: an inline arrow builds fine at runtime, so the runtime
does not enforce this — it is a **macro-lowering** requirement. Current practice
in all four grammars is a named const (`cssFactory`, `lessGrammarFactory`, …).

**`ref()` used before `.define()`** throws `ref<T>() used before .define() was
called`.

## `dispatch` static evaluation: it is the CALLEE, not the opener and not the scope

`when(ciCase('url('), routed(...))` fails static evaluation with *"factory isn't
statically evaluable"*, while `when('url(', g.Url, { caseInsensitive: true })`
builds. **It is what the callee is that decides** — not the opener shape, and not
where the alias is declared.

| Alias shape | Lowers? |
| --- | --- |
| `const kw = makeWord(boundary?, opts?)`, then `kw('url')` | yes, either scope |
| `const ci = makeWhen(opts?)`, then `ci(key, parser)` | yes, either scope |
| `const ident = regex(/[a-z]+/)` — a plain combinator const | yes, either scope |
| `const ci = (k, p) => when(k, p, opts)` — a user-defined function | **no**, either scope |
| `const w2 = word` — a bare re-binding of an imported constructor | **no**, either scope |

A call lowers when its callee is a parseman constructor **named directly**, or a
binding produced by `makeWord(...)` / `makeWhen(...)`. The macro does not call
user-defined functions and does not follow a constructor through a plain `const`
re-binding; both fall back to the interpreter with *"rules(...) factory isn't
statically evaluable"*.

Measured at runtime, re-confirmed at the 0.46 floor: `when('url(', X, { caseInsensitive: true })`
builds, and so do `when(exact)`, `startsWith`, `endsWith`, `matches(/re/)`, and
`makeWhen({ caseInsensitive: true })(...)`. **UNVERIFIED at runtime:** the
`ciCase(...)` failure is a *macro-lowering* diagnostic and is not reproducible
through the interpreter; `ciCase` does not exist in the parseman surface or
anywhere in this repo's source — it names a shape that was attempted and
withdrawn.

**Two superseded statements, for anyone following an old thread.** This sheet and
`GRAMMAR-REBUILD-SPEC.md` §0.2 have each carried a wrong version of this rule:
first that module-scope word-factory aliases do not lower, then that being
*inside* a `rules(...)` factory is what makes an alias lower. Measured against
parseman `0.46.0` (`lane/macro-lowering-defects`), **scope is irrelevant in both
directions** — module scope and inside the factory behave identically in every
row of the table above. §0.2 now states the callee rule; this section and that
one must not drift apart again.

What is actually in use today, all working: `makeWhen({ caseInsensitive: true })`
in all four grammars — `cssCase`, `caseOf`, `caseInsensitive`,
`caseInsensitiveWhen` — plus `makeWord(chars, { caseInsensitive: true })` in css
and less.

## Bare-`choice()` consts cannot always be promoted to named rules

When the inferred union is unspellable in an invariant `Combinator<T>` slot, the
promotion does not compile. **The real blockers are:**

- **`dispatch(...)` surfacing a tuple** `[routedValue, branchResult]`, and
- **anonymous object types in the union.**

**It is not union width.** Measured with `tsc --strict`
(`scratchpad/cheat-sheet/tupleprobe.ts`, whose assignments deliberately fail so
the compiler prints each inferred type):

```
dispatch(opener, when('url(', Url), otherwise(Kw))
  -> Combinator<[string, unknown[]]>            <-- a TUPLE, and the branch is unknown[]

choice(transform(a, () => ({kind, span})),
       transform(b, () => ({kind, extra})))
  -> Combinator<{ kind: string; span: number } | { kind: string; extra: boolean }>
                                                <-- ANONYMOUS union, no name to write

choice(a, b, c, d, e, f, g)   // seven arms
  -> Combinator<string>                         <-- collapses; promotes trivially
```

The seven-member union collapses to `Combinator<string>` and promotes without
complaint. **Do not spend a round splitting a wide choice** — look for the
dispatch tuple or the anonymous object type instead. For the tuple, the fix is
to give the branch a named node type; for the anonymous union, name both shapes
or project through `node(...)` so the slot has a spellable type.

## Known codegen divergence — do NOT author against it

`DESIGN-DECISIONS.md` **G20** (SETTLED, owner 2026-07-31) rules that
**equivalent grammars must emit equivalent artifacts**: two spellings accepting
the same language, with the same boundary policy and the same tree output, must
compile to substantially the same bytes. Where they do not, that is a **missing
normalisation in codegen, not a fact about the spellings.**

Measured violations, recorded canonically in `docs/state/GRAMMAR-SIZE-FACTS.md`
§2.1–2.2 (that file is the source of record for these numbers):

| Equivalent spellings | Bytes | Ratio |
| --- | --- | --- |
| `keywords([30 words])` vs 30 `word()` arms | 1,077 B vs 20,002 B | **18.6×** |
| a rule referenced via `g.X` vs by-const | 276,023 B vs 3,777,733 B | **13.69×** |
| `transform()` vs `node()`, per site | 46 B vs 3,425 B | **74×** |

> **These are codegen defects being fixed. They are NOT authoring advice.**
> G20's whole point is that the grammar author must not need to know which of
> two equivalent forms is an order of magnitude smaller. Write the spelling that
> states the language boundary; treat a spelling-differential as a gate on
> codegen, not a tip for you. **Known divergence — do not rely on it.**

## The generalised shape rule

> **A token that is structurally significant in some position must not sit in a
> terminal table that a greedy repetition can reach in that position.**

Five instances, for pattern recognition:

1. `,` reachable as a value component
2. `!` reachable as a value component
3. `<` / `=` / `>` reachable as value punctuation — this made
   `QueryComparisonFeature` and `QueryRangeFeature` **unreachable dead
   productions while every fixture passed**. *(Historical: both are reachable
   today — css `grammar.ts:2853/:2878` and less `:4589/:4611` are referenced
   from `QueryFeature`; jess defines only `QueryComparisonFeature` at `:3580`;
   scss defines neither.)*
4. positional reads past `optional()`
5. `many()` spreading

And the reducer-side rule that follows from the arity table:

> **Do not read a fixed position when any preceding child combinator has
> variable arity.** Put variable-arity combinators last, or destructure by
> identity/type rather than by index.

Variable-arity combinators, from the measured table: `sequence` (flattens),
`choice` (winning-arm dependent), `many`, `oneOrMore`, `optional`, `sepBy`,
`oneOrMoreSep`, `expect`, `balanced`, `transform` (inherits its body's).

Established fix pattern in this codebase: `AtRuleStatement` uses
`g.StatementPrelude` — a node that **always matches, possibly empty** — instead
of `optional(...)`, so the arity is fixed. Prefer that.

### Why no test catches any of this

A wrong positional read produces a **plausible, well-typed tree**. It parses, it
type-checks, and the suite passes. Four instruments see what a green suite does
not:

1. **A byte-level tree diff** against a known-good baseline.
2. **A full-consumption assertion** — `run().unconsumedFrom === null`, or
   `span.end === source.length` for a `parse()` result.
3. **The error channel** — `parse(..., { recover: true })` and read `errors`.
   Consumption alone cannot distinguish acceptance from recovery.
4. **Grammar coverage** — `runWithGrammarCoverage` and the
   `grammarCoverageDefinitions` family answer "was this production ever
   entered", which is the only cheap way to catch a rule that has gone dead
   while every fixture still passes. That is exactly how
   `QueryComparisonFeature` and `QueryRangeFeature` hid.

None of these are on by default. A grammar change that touches arity,
nullability, or a terminal table should turn at least the first three on before
claiming it is green.
## The reachability defects, for pattern recognition

These shipped alongside the arity defects in the same session and share a
general form:

`,` reachable as a value component · `!` reachable as a value component ·
`<`/`=`/`>` reachable as value punctuation (made `QueryComparisonFeature` and
`QueryRangeFeature` **unreachable dead productions**).

The general form: **a token that is structurally significant in some position
must not sit in a terminal table that a greedy repetition can reach in that
position.**

## Keeping this sheet true

This document is cut against a specific parseman version. **A parseman floor
bump must re-cut it in the same change** — including re-running the arity probe,
because a combinator switching between `transform(...)` and `token(...)`
internally changes its published spread contract without changing its type
signature. That is exactly how the `balanced` defect (P19) arose.
