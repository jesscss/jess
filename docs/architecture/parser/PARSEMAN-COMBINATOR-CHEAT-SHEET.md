# Parseman combinator cheat sheet

Jess grammar cleanup targets `parseman@0.43.0`.

Source checked: `/Users/matthew/git/oss/parser-thing` at `b24c542`.
Installed package checked: `/Users/matthew/git/oss/jess/node_modules/.pnpm/parseman@0.43.0/node_modules/parseman`.

This is the working grammar-authoring guide for the four host-mode grammar
files. Use the language production name first, keep rules small, and prefer the
Parseman combinator that states the ownership boundary directly.

## The CSS/Less Choice

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

For every CSS/Less `choice(...)` touched during the rewrite, classify it before
editing:

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

const Identifier = node(
  'Identifier',
  routed(),
  children => keywordFrom(children)
);

const Value = dispatch(
  identOrFunction,
  caseOf('url(', UrlFunction),
  caseOf('calc(', CalcFunction),
  when(endsWith('('), GenericFunction),
  otherwise(Identifier)
);
```

The routed combinator must consume the syntax that decides the branch. CSS and
Less function names are glued to `(`, so `name(` belongs in the routed opener;
`name (` is an identifier followed by later parenthesized syntax if that context
allows it.

Before changing a CSS/Less `choice(...)` into `dispatch(...)`, write down the
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
- Do not route `Declaration` on the property name alone. Ordinary declarations
  and nested selector rules compete in the enclosing body item (`b:c { ... }`
  is a nested ruleset, not a declaration), so a property-name dispatch commits
  before the body context has proved the branch. A future cleanup needs a
  context-owned declaration/ruleset helper, not a cosmetic custom-property
  dispatch.
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

## Grammar Surface

| Export | Use it when |
| --- | --- |
| `literal` | A fixed spelling is syntax, punctuation, or glue. |
| `regex` | The language genuinely needs a character pattern that Parseman has no structured helper for. |
| `keywords` | A fixed set should compile as one longest-first terminal with optional boundary and case policy. |
| `word` | One keyword needs a trailing word-boundary guard. |
| `makeWord` | Many words share the same boundary/case policy. |
| `sequence` | Several pieces must appear in order. |
| `choice` | Alternatives are real alternatives, especially disjoint or closed sets. |
| `dispatch` | A parsed string value routes known/generic continuations without reparsing the opener. |
| `when` | One dispatch branch matches an exact key or matcher. |
| `makeWhen` | Many dispatch branches share the same case policy. |
| `startsWith` | A dispatch branch is selected by a routed value prefix. |
| `endsWith` | A dispatch branch is selected by a routed value suffix, usually glued `(`. |
| `matches` | A dispatch branch needs a regex predicate over the already-routed value. |
| `otherwise` | The same routed token family has a generic fallback. |
| `routed` | A selected branch should own the already-parsed dispatch value and span. |
| `attempt` | A speculative arm may consume before failing and must allow outer backtracking. |
| `many` | Zero or more repetitions are allowed and nullable is correct. |
| `oneOrMore` | At least one repetition is required. |
| `optional` | A local piece may be absent without owning a separator or terminator. |
| `sepBy` | A separated list may be empty or needs explicit min/trailing options. |
| `oneOrMoreSep` | A separated list cannot be empty. |
| `rules` | A grammar factory needs recursive named rules. |
| `ref` | A grammar references a rule by name outside the `rules()` proxy shape. |
| `not` | The parser must assert a small forbidden shape without consuming it. |
| `peek` | The parser must assert a small required shape without consuming it. |
| `node` | A branch owns a public CST boundary or AST projection. |
| `transform` | A value changes shape without needing a CST node boundary. |
| `skip` | A main parser should ignore a specific skipped parser around it. |
| `trivia` | A parser describes trivia for a grammar or nested parser mode. |
| `label` | Diagnostics need a clearer expected label. |
| `field` | A semantic reducer needs a named captured child. |
| `parse` | A combinator should be run directly in tests or small tools. |
| `parser` | A nested parser needs local trivia policy. |
| `noTrivia` | Pieces must be adjacent or must not skip ambient trivia. |
| `token` | A terminal span/value should be available as one leaf. |
| `leaf` | A value should be represented as a CST leaf. |
| `scanTo` | A bounded opaque run is permitted and has an explicit sentinel. |
| `balanced` | A scanner must skip balanced delimiter pairs inside a bounded run. |
| `expect` | A missing delimiter needs a stronger diagnostic at a known point. |
| `gate` | A custom predicate is the smallest correct guard. |
| `guard` | Deprecated alias for `gate`; do not add new uses. |
| `withCtx` | A parser branch must read or adjust parse context explicitly. |
| `compose` | A grammar composes reusable grammar pieces under the same host-mode contract. |
| `composeLeaf` | A grammar imports a terminal leaf rule, not a composable subtree. |
| `compile` | A grammar is lowered to generated parser code. |

## Tooling Surface

| Export | Use it when |
| --- | --- |
| `analyzeGating`, `analyzeGatingRules`, `analyzeGrammarGating`, `formatGatingWarnings`, `firstSetToString` | Reviewing first-set quality, shared opener choices, and macro-buildability blockers. |
| `analyzeDuplication`, `analyzeDuplicationRules`, `formatDuplicationFindings`, `duplicationFindingCount`, `siteToString`, `alternationGroups`, `keywordRegexShape`, `extractCharClasses`, `charClassMembers`, `keywordAlternationHazards` | Reviewing duplicate grammar structure, keyword-regex anti-patterns, and near-identical dialect copies. |
| `parseDoc`, `run` | Functional/document-style Parseman evaluation helpers outside the grammar files. |
| `completionsAt`, `isParseError` | Editor diagnostics and completion-facing parser utilities. |
| `cstBuildHost`, `buildTriviaIndex`, `triviaEntries`, `walk`, `createVisitor`, `triviaKindMask`, `OffsetIndex`, `buildOffsetIndex`, `collectLeafSlots`, `gapText`, `lineBreaksIn`, `blankLinesIn`, `lineStartWithin`, `indentWidth`, `indentMixed`, `commentsIn`, `gapIsSignificant`, `relativize`, `absolutize`, `absoluteSpanAt`, `shiftAbsolute`, `applyEdit`, `relativizeCST`, `absolutizeCST`, `absoluteSpanCST`, `buildLineIndex`, `offsetToLineCol`, `annotateSpan` | CST, source mapping, trivia, and editor/runtime support code; ordinary grammar rewrite slices should not need them. |

## Anti-Patterns

- Do not write keyword regexes such as `regex(/@page(?![-\w])/i)` when a
  grammar-local `makeWord(..., { caseInsensitive: true })` expresses the same
  boundary.
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
