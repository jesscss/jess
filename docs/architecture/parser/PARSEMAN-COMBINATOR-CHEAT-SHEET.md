# Parseman combinator cheat sheet

Cut against **`parseman@0.45.0`**, the version this repo depends on
(`node_modules/.pnpm/parseman@0.45.0/node_modules/parseman`). Every spread/arity
contract below was established from that package's `dist/index.cjs` — by
enumerating the nine call sites that push into the CST child buffer, and by
running each combinator and counting the children the reducer actually received.
Neither inference from the type signature nor the upstream working copy at
`~/git/oss/parser-thing` (currently `0.46.0`, ahead of the installed floor) is a
valid source for these contracts.

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

In `parseman@0.45.0` exactly these combinators push, and each pushes **exactly
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

## Mechanical contract for all 95 runtime exports

`parseman@0.45.0` has **95 runtime exports**. All 95 appear below, each with an
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
