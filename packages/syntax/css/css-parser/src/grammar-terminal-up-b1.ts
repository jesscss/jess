/**
 * Terminal-up CSS grammar — tournament Candidate A, Shape 4 (Batch 1: conditional preludes).
 *
 * Built from the terminal alphabet upward rather than from the incumbent
 * grammar's structure. The thesis under test is that CSS Syntax Level 3 has one
 * structural spine and one component-value production, and that everything the
 * incumbent spells as a separate typed production is that same spine reached
 * from a different position.
 *
 * The spine is seven productions:
 *
 *   stylesheet := item*
 *   item       := atRule | ruleset
 *   atRule     := atKeyword prelude (block | ';')
 *   ruleset    := selectorList block
 *   block      := '{' (declaration | item)* '}'
 *   declaration:= name ':' valueList important?
 *   value      := component (component)*  ( ',' ... )*
 *
 * Everything else is a leaf dispatch on the already-consumed opener. `Prelude`,
 * `Value`, and function arguments are the SAME `ValueList`, which is the whole
 * economy of the shape: the incumbent carries parallel typed value ladders for
 * value position, query position, calc position, and var()-fallback position.
 *
 * NOT WIRED INTO THE PACKAGE BUILD. `src/grammar.ts` is owned by another lane;
 * this file is compiled and measured through `probe/tsdown.config.ts` only.
 *
 * Coverage is stated honestly in COVERAGE.md beside it: this is the CSS Syntax
 * core plus the value and selector spines. Typed conditional preludes, calc,
 * var() fallbacks, @page margin rules, keyframes, and font-feature-values are
 * NOT covered, and the artifact number must be read with that stated.
 */
import { choice, composeLeaf, dispatch, endsWith, keywords, literal, many, noTrivia, node, oneOrMore, oneOrMoreSep, optional, otherwise, regex, routed, rules, sequence, token, when } from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';
import { cssSyntax } from '@jesscss/parser-shared/recognition';
import { cssPseudoSyntax } from '@jesscss/parser-shared/pseudo-consts';
import {
  any,
  atRuleBlock,
  atRuleStatement,
  block,
  color,
  decl,
  dimension,
  funcCall,
  keyword,
  list,
  quoted,
  rule,
  selist,
  simpleSelector,
  spaced,
  stylesheet,
  url
} from '@jesscss/core/ast';
import type { Statement, ValueNode, ValueSlot } from '@jesscss/core/ast';

/**
 * Reads a token leaf's text.
 *
 * A composed leaf reaches a reducer as `{ value, span }`, NOT as a string, so
 * `String(child)` yields `'[object Object]'`. Every reducer in the first three
 * shapes of this grammar had that defect and the smoke test could not see it,
 * because it compared two equally-broken shapes against each OTHER rather than
 * against ground truth. Throwing beats returning `''`: a lost token is a
 * grammar defect and must not degrade into a plausible empty string.
 */
function text(child: unknown): string {
  if (typeof child === 'string') {
    return child;
  }
  if (typeof child === 'object' && child !== null && 'value' in child && typeof child.value === 'string') {
    return child.value;
  }
  throw new Error('terminal-up css grammar lost a required token');
}

/**
 * Reads the authored text of a reducer child that may be either a token leaf
 * or an already-built `SimpleSelector` node.
 *
 * Selector productions mix the two: `BasicSelector` yields a node while a
 * combinator yields a leaf. `text()` deliberately throws on a node rather than
 * guessing, which is what surfaced the selector reducers as broken.
 *
 * KNOWN INCOMPLETE — see TERMINAL-UP-COVERAGE.md. This flattens a complex
 * selector to one `SimpleSelector` carrying the joined text. It no longer
 * DISCARDS compounds, which was Candidate B's F5, but the incumbent emits
 * structured `SelectorTerm`/`SelectorBranch` nodes and this does not yet.
 */
/**
 * Keeps only built AST nodes, dropping token leaves.
 *
 * `oneOrMoreSep` hands the reducer its SEPARATORS as well as its items, so a
 * list reducer that passes `children` straight through emits
 * `[SpacedValue, leaf ',', SpacedValue]`. The separator is already carried by
 * the list's own `sep` field; leaving it in the value array duplicates it as a
 * phantom child and moves the tree. Found by verifying a reviewer's finding
 * rather than by the reviewer.
 */
function nodesOnly(children: readonly unknown[]): ValueNode[] {
  return children.filter((child): child is ValueNode =>
    typeof child === 'object' && child !== null && 'type' in child);
}

function selectorText(child: unknown): string {
  if (typeof child === 'object' && child !== null && 'text' in child && typeof child.text === 'string') {
    return child.text;
  }
  if (Array.isArray(child)) {
    return child.map(selectorText).join('');
  }
  if (child == null) {
    return '';
  }
  return text(child);
}

/** Ambient trivia: CSS whitespace and block comments are both non-syntax. */
const whitespace = regex(/(?:[ \t\n\r\f]+|\/\*(?:[^*]|\*(?!\/))*\*\/)+/);

/** A block comment on its own, for the scanner skip set. */
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);

/**
 * The one identifier-or-function opener, consumed once for every position that
 * admits a component value. `name(` is glued: CSS function names are adjacent
 * to their paren, so the glue belongs in the routed opener rather than in a
 * later adjacency guard.
 */
const identOrFunctionOpen = token(noTrivia(sequence(
  regex(/-?(?:[_a-zA-Z\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/),
  optional(literal('('))
)));

/**
 * Punctuation that is a component value in its own right rather than structure:
 * the value-position delimiters CSS Syntax keeps as preserved tokens.
 *
 * `,` and `!` are deliberately ABSENT, and both exclusions are load-bearing
 * because this table sits inside a greedy `oneOrMore`:
 *
 * - `,` is the LIST SEPARATOR (css-values-4 §2.2), not a component. Admitting
 *   it here let `oneOrMore(Component)` swallow the comma before
 *   `oneOrMoreSep(ValueSequence, ',')` could see it, so `color: red, blue`
 *   became one sequence with an embedded comma instead of a two-element list —
 *   every `font-family`, `transition`, and `rgb()` in the corpus mis-shaped.
 * - `!` opens the priority marker (css-cascade-5 §3.1). Admitting it here let
 *   the value run consume `!` and then `important` as an ordinary keyword, so
 *   `optional(Important)` never fired and the declaration's priority flag was
 *   ALWAYS false — mis-shaped and semantically dropped.
 *
 * Candidate B found both. Neither is a style preference; adding either back
 * silently breaks list structure or `!important`.
 */
const valuePunctuation = keywords(['/', '+', '-', '*', '=', '<', '>', '~', '|', '^', '$']);

/** Descendant/child/sibling combinators, one closed table. */
const combinator = keywords(['||', '>', '+', '~', '|']);

/** The terminal-up factory. One `g` self-reference parameter, as the macro requires. */
const terminalUpFactory = (g: Record<string, Combinator>) => {
  /** A double-quoted string, with its own text leaf so escapes stay one token. */
  const DoubleQuoted = node(
    'Quoted',
    sequence(literal('"'), g.DoubleQuotedText, literal('"')),
    children => quoted(`"${text(children[1])}"`, text(children[1]), '"', false)
  );

  /** A single-quoted string. Separate arm because the delimiter differs, only. */
  const SingleQuoted = node(
    'Quoted',
    sequence(literal('\''), g.SingleQuotedText, literal('\'')),
    children => quoted(`'${text(children[1])}'`, text(children[1]), '\'', false)
  );

  /** Either string form. The two arms have disjoint first sets, so `choice`. */
  const Quoted = choice(DoubleQuoted, SingleQuoted);

  /** A hex colour is one lexical terminal; the leaf owns the digit-count rule. */
  const Color = node('Color', g.HexColor, children => color(text(children[0])));

  /** `U+26`, `U+0-7F`, `U+4??` — one token, so its `+`/`-` are never operators. */
  const UnicodeRange = node('UnicodeRange', g.UnicodeRangeToken, children => any(text(children[0])));

  /**
   * A number with an optional glued unit. `noTrivia` is what makes `1 px` two
   * components and `1px` one; without it the unit leaf would skip the gap.
   */
  const Numeric = node(
    'Dimension',
    noTrivia(sequence(g.NumberToken, optional(g.DimensionUnit))),
    children => dimension(
      Number.parseFloat(text(children[0])),
      children[1] == null ? '' : text(children[1])
    )
  );

  /** `url(` with an unquoted body: the body has its own leaf, not a rescan. */
  const UrlUnquoted = node(
    'Url',
    sequence(routed(), optional(g.UrlInner), literal(')')),
    children => url(any(children[1] == null ? '' : text(children[1])))
  );

  /** `url("…")` — the quoted form reuses the ordinary `Quoted` production. */
  const UrlQuoted = node(
    'Url',
    sequence(routed(), g.Quoted, literal(')')),
    children => url(children[1] as ValueNode)
  );

  /** Either `url()` spelling. Disjoint after the opener, so `choice` is right. */
  const Url = choice(UrlQuoted, UrlUnquoted);

  /** A parenthesised component group: `(` value `)` kept as a value, not structure. */
  const Group = node(
    'Group',
    sequence(literal('('), optional(g.ValueList), literal(')')),
    children => block(children[1] as ValueSlot, 'paren')
  );

  /** A bare identifier in value position is a keyword fact, never an `Identifier`. */
  const RoutedKeyword = node('Keyword', routed(), children => keyword(text(children[0])));

  /** A generic `name(` call. Arguments are the same `ValueList` as everywhere. */
  const RoutedFunction = node(
    'Call',
    sequence(routed(), optional(g.ValueList), literal(')')),
    children => funcCall(text(children[0]).slice(0, -1), [children[1] as ValueSlot])
  );

  /** Value-position punctuation kept verbatim, e.g. the `/` in `font`. */
  const Punctuation = node('Punctuation', valuePunctuation, children => any(text(children[0])));

  /**
   * The single component-value dispatch. One opener is consumed, and its value
   * — `url(`, a glued `name(`, or a bare identifier — decides the branch. This
   * is the production the whole shape is built to have exactly one of.
   */
  const IdentOrFunction = dispatch(
    identOrFunctionOpen,
    when('url(', Url, { caseInsensitive: true }),
    when(endsWith('('), RoutedFunction),
    otherwise(RoutedKeyword)
  );

  /** Every component value, in every position. Leaf arms have disjoint starts. */
  /*
   * `UnicodeRange` MUST precede `IdentOrFunction`. `U` and `u` are legal
   * ident-start code points, so the two arms are NOT disjoint and order alone
   * decides: with `IdentOrFunction` first, `U+0025-00FF` matched the bare `U`,
   * found no `(`, and committed `Keyword('U')`, leaving `+0025`, `-00FF` to be
   * re-read as signed numbers. css-syntax-3 §4.3.9 makes `<urange>` its own
   * token precisely so its `+`/`-` are never operators. Candidate B found it.
   */
  const Component = choice(UnicodeRange, IdentOrFunction, g.Quoted, Color, Numeric, Group, Punctuation);

  /** A space-separated run of components. */
  const ValueSequence = node(
    'ValueSequence',
    oneOrMore(g.Component),
    children => spaced(children as ValueNode[])
  );

  /** A comma-separated list of space-separated runs. The list owns its comma. */
  const ValueList = node(
    'ValueList',
    oneOrMoreSep(g.ValueSequence, literal(',')),
    children => list(nodesOnly(children), ',')
  );

  /** A pseudo selector, argument-less or with an opaque argument run. */
  const PseudoSelector = node(
    'PseudoSelector',
    token(noTrivia(sequence(g.PseudoSelectorColon, g.Identifier))),
    children => simpleSelector(text(children[0]))
  );

  /** An attribute selector: `[name]`, `[name=value]`, `[name=value i]`. */
  const AttributeSelector = node(
    'AttributeSelector',
    sequence(
      literal('['),
      g.Identifier,
      optional(sequence(g.AttributeOperator, choice(g.Quoted, g.Identifier))),
      optional(g.AttributeModifier),
      literal(']')
    ),
    children => simpleSelector(text(children[1]))
  );

  /** Element, class, id, universal, or percentage keyframe selector — one leaf. */
  const BasicSelector = node('BasicSelector', g.SimpleSelectorToken, children => simpleSelector(text(children[0])));

  /** Adjacent simple selectors with no combinator between them. */
  const CompoundSelector = oneOrMore(choice(BasicSelector, PseudoSelector, AttributeSelector));

  /**
   * Compound selectors joined by combinators or by descendant whitespace.
   *
   * KNOWN INCOMPLETE (Candidate B's F5). The reducer previously read only
   * `children[0]`, so `.a > .b` collapsed to `.a` and every compound after the
   * first was DISCARDED. It now keeps all of them, but as one flattened
   * `SimpleSelector` rather than the structured `SelectorTerm`/`SelectorBranch`
   * the incumbent emits. That structure is the next selector batch; this is a
   * data-preserving intermediate, not the target shape.
   */
  const ComplexSelector = node(
    'ComplexSelector',
    sequence(g.CompoundSelector, many(sequence(optional(combinator), g.CompoundSelector))),
    children => simpleSelector(children.map(selectorText).join(' '))
  );

  /** The comma-separated selector list that heads a ruleset. */
  const SelectorList = node(
    'SelectorList',
    oneOrMoreSep(g.ComplexSelector, literal(',')),
    children => selist(...(nodesOnly(children) as never[]))
  );

  /** `!important`, whose whole spelling including the `!` is one leaf. */
  const Important = token(noTrivia(sequence(literal('!'), optional(whitespace), g.ImportantToken)));

  /** A custom property keeps its value as preserved text, per css-variables-1. */
  const CustomProperty = node(
    'CustomProperty',
    sequence(g.CustomPropertyName, literal(':'), optional(g.CustomOuterContent)),
    children => decl(text(children[0]), any(children[2] == null ? '' : text(children[2])))
  );

  /** An ordinary declaration. The `;` belongs to the block list, not to this. */
  const Declaration = node(
    'Declaration',
    sequence(g.Identifier, literal(':'), g.ValueList, optional(Important)),
    children => decl(text(children[0]), children[2] as ValueSlot, null, children[3] != null)
  );

  /** A `{ … }` body. Items are separated by `;`, which the list owns. */
  const Block = node(
    'Block',
    sequence(
      literal('{'),
      many(choice(sequence(choice(g.CustomProperty, g.Declaration), optional(literal(';'))), g.Item)),
      literal('}')
    ),
    children => children[1] as never
  );

  /** An at-rule with a block body: `@name <prelude> { … }`. */
  const AtRuleBlock = node(
    'AtRuleBlock',
    sequence(routed(), optional(g.ValueList), g.Block),
    children => atRuleBlock(text(children[0]).slice(1), children[1] as ValueSlot, children[2] as Statement[])
  );

  /** An at-rule with no block: `@name <prelude> ;`. */
  const AtRuleStatement = node(
    'AtRuleStatement',
    sequence(routed(), optional(g.ValueList), literal(';')),
    children => atRuleStatement(text(children[0]).slice(1), children[1] as ValueNode)
  );

  /*
   * ---------------------------------------------------------------------
   * BATCH 1 — conditional group at-rules.
   *
   * `@media` / `@container` / `@supports`, the largest single coverage gap:
   * 79 of 333 corpus entries, 23.7%, measured by `probe/coverage-order.mjs`.
   * ---------------------------------------------------------------------
   */

  /**
   * The head of a parenthesised query feature, consumed once with the
   * delimiter that decides which feature form follows.
   *
   * The cheat sheet forbids routing `QueryFeature` on a bare `(` — the branch
   * is decided by `)`, `:`, or a comparison operator, none of which a bare
   * paren has seen. So the routed opener owns all three: `(` plus the interior
   * head plus the deciding delimiter. That is the left-factoring the standard
   * asks for, expressed as a dispatch rather than as four arms that each
   * re-parse the same opener.
   */
  const queryFeatureOpen = token(sequence(
    literal('('),
    g.ValueSequence,
    choice(literal(')'), literal(':'), g.QueryComparisonOperator)
  ));

  /** `(hover)` — a feature name and nothing else. */
  const QueryBareFeature = node('QueryBareFeature', routed(), children => keyword(text(children[0])));

  /** `(min-width: 30em)` — the classic feature/value pair. */
  const QueryColonFeature = node(
    'QueryColonFeature',
    sequence(routed(), g.ValueList, literal(')')),
    children => block(list([keyword(text(children[0])), children[1] as ValueNode], ':'), 'paren')
  );

  /** `(width >= 600px)` — one comparison. */
  const QueryComparisonFeature = node(
    'QueryComparisonFeature',
    sequence(routed(), g.ValueSequence, literal(')')),
    children => block(spaced([keyword(text(children[0])), children[1] as ValueNode]), 'paren')
  );

  /**
   * `(400px <= width <= 700px)` — two comparisons around a feature name.
   * Comparison and range share their opener AND their first tail; only the
   * presence of a SECOND operator separates them, so this stays a local
   * `choice` after the routed opener rather than a dispatch case.
   */
  const QueryRangeFeature = node(
    'QueryRangeFeature',
    sequence(routed(), g.ValueSequence, g.QueryComparisonOperator, g.ValueSequence, literal(')')),
    children => block(spaced(children.slice(0, 4) as ValueNode[]), 'paren')
  );

  /** A `(…)` query feature in any of its four spellings. */
  const QueryFeature = dispatch(
    queryFeatureOpen,
    when(endsWith(')'), QueryBareFeature),
    when(endsWith(':'), QueryColonFeature),
    otherwise(choice(QueryRangeFeature, QueryComparisonFeature))
  );

  /**
   * `<general-enclosed>` — a parenthesised form the grammar does not recognise
   * but must still accept and preserve, per mediaqueries-5 §3.
   */
  const GeneralEnclosed = node(
    'GeneralEnclosed',
    sequence(literal('('), g.ValueList, literal(')')),
    children => block(children[1] as ValueSlot, 'paren')
  );

  /** A bare identifier in query position — a media type such as `screen`. */
  const QueryIdent = node('QueryIdent', g.Identifier, children => keyword(text(children[0])));

  /** One queryable term: a feature, an unknown parenthesised form, or a keyword. */
  const QueryTerm = choice(QueryFeature, g.GeneralEnclosed, g.QueryIdent);

  /** `not (…)`, or a run of terms joined by `and` / `or`. */
  const QueryClause = node(
    'QueryClause',
    choice(
      sequence(g.QueryNot, g.QueryTerm),
      sequence(g.QueryTerm, many(sequence(g.QueryAndOr, g.QueryTerm)))
    ),
    children => spaced(children as ValueNode[])
  );

  /**
   * A legacy media query: an optional `only`/`not`, a media type, then any
   * number of `and`-joined features. `only` exists solely to hide the query
   * from CSS2 parsers and carries no meaning, but it is still syntax.
   */
  const MediaQuery = node(
    'MediaQuery',
    choice(
      sequence(optional(choice(g.QueryOnly, g.QueryNot)), g.QueryIdent, many(sequence(g.QueryAndOr, g.QueryTerm))),
      g.QueryClause
    ),
    children => spaced(children as ValueNode[])
  );

  /** A comma-separated media-query list. The list owns its commas. */
  const QueryPrelude = node(
    'QueryPrelude',
    oneOrMoreSep(MediaQuery, literal(',')),
    children => list(nodesOnly(children), ',')
  );

  /**
   * `@supports` admits a supports-condition only, never a media-query list —
   * the two conditional families deliberately do NOT share a prelude grammar,
   * which is why `parser-shared` keeps `supportsAtKeyword` separate from
   * `mediaContainerAtKeyword`.
   */
  const SupportsInParens = node(
    'SupportsInParens',
    choice(
      sequence(literal('('), g.SupportsCondition, literal(')')),
      sequence(literal('('), g.Declaration, literal(')')),
      g.GeneralEnclosed
    ),
    children => block(children[1] as ValueSlot, 'paren')
  );

  /** `not (…)`, or `(…)` joined by `and` / `or`. */
  const SupportsCondition = node(
    'SupportsCondition',
    choice(
      sequence(g.QueryNot, g.SupportsInParens),
      sequence(g.SupportsInParens, many(sequence(g.QueryAndOr, g.SupportsInParens)))
    ),
    children => spaced(children as ValueNode[])
  );

  /** `@media` / `@container` with a query-list prelude and a block. */
  const ConditionalBlock = node(
    'ConditionalBlock',
    sequence(routed(), g.QueryPrelude, g.Block),
    children => atRuleBlock(text(children[0]).slice(1), children[1] as ValueSlot, children[2] as Statement[])
  );

  /** `@supports` with a supports-condition prelude and a block. */
  const SupportsBlock = node(
    'SupportsBlock',
    sequence(routed(), g.SupportsCondition, g.Block),
    children => atRuleBlock(text(children[0]).slice(1), children[1] as ValueSlot, children[2] as Statement[])
  );

  /**
   * One at-keyword router. The routed value is the full at-keyword, and for the
   * conditional family that value DOES decide the branch: `@supports` admits a
   * different prelude language from `@media`/`@container`. For every other
   * at-keyword the block-vs-statement decision is a LATER delimiter (`{`
   * against `;`), so that split stays a local `choice` — see
   * GRAMMAR-REVIEW-STANDARD item 8 on committing too early.
   */
  const AtRule = dispatch(
    g.AtRuleKeyword,
    when('@media', g.ConditionalBlock, { caseInsensitive: true }),
    when('@container', g.ConditionalBlock, { caseInsensitive: true }),
    when('@supports', SupportsBlock, { caseInsensitive: true }),
    otherwise(choice(AtRuleBlock, AtRuleStatement))
  );

  /** A qualified rule: a selector list and a body. */
  const Ruleset = node(
    'Ruleset',
    sequence(g.SelectorList, g.Block),
    children => rule(children[0] as never, children[1] as Statement[])
  );

  /** Either statement form. `@` against a selector start is a disjoint first set. */
  const Item = choice(AtRule, Ruleset);

  /** The document. */
  const Stylesheet = node('Stylesheet', many(g.Item), children => stylesheet(children as Statement[]));

  return {
    Stylesheet,
    Item,
    Block,
    ValueList,
    Declaration,
    CustomProperty,
    SelectorList,
    ComplexSelector,
    Component,
    Quoted,
    CompoundSelector,
    ValueSequence,
    GeneralEnclosed,
    QueryIdent,
    ConditionalBlock,
    QueryTerm,
    QueryClause,
    QueryPrelude,
    SupportsCondition,
    SupportsInParens
  };
};

/** The AST artifact. */
export const cssTerminalUpB1Grammar = composeLeaf([cssSyntax, cssPseudoSyntax, rules(
  { trivia: whitespace, scanSkip: [blockComment] },
  terminalUpFactory
)]);
