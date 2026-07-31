/**
 * Terminal-up CSS grammar — tournament Candidate A, Shape 3 (all-by-name, H1 closed).
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
 */
const valuePunctuation = keywords(['/', ',', '+', '-', '*', '=', '<', '>', '~', '|', '^', '$', '!']);

/** Descendant/child/sibling combinators, one closed table. */
const combinator = keywords(['||', '>', '+', '~', '|']);

/** The terminal-up factory. One `g` self-reference parameter, as the macro requires. */
const terminalUpFactory = (g: Record<string, Combinator>) => {
  /** A double-quoted string, with its own text leaf so escapes stay one token. */
  const DoubleQuoted = node(
    'Quoted',
    sequence(literal('"'), g.DoubleQuotedText, literal('"')),
    children => quoted(`"${String(children[1])}"`, String(children[1]), '"', false)
  );

  /** A single-quoted string. Separate arm because the delimiter differs, only. */
  const SingleQuoted = node(
    'Quoted',
    sequence(literal('\''), g.SingleQuotedText, literal('\'')),
    children => quoted(`'${String(children[1])}'`, String(children[1]), '\'', false)
  );

  /** Either string form. The two arms have disjoint first sets, so `choice`. */
  const Quoted = choice(DoubleQuoted, SingleQuoted);

  /** A hex colour is one lexical terminal; the leaf owns the digit-count rule. */
  const Color = node('Color', g.HexColor, children => color(String(children[0])));

  /** `U+26`, `U+0-7F`, `U+4??` — one token, so its `+`/`-` are never operators. */
  const UnicodeRange = node('UnicodeRange', g.UnicodeRangeToken, children => any(String(children[0])));

  /**
   * A number with an optional glued unit. `noTrivia` is what makes `1 px` two
   * components and `1px` one; without it the unit leaf would skip the gap.
   */
  const Numeric = node(
    'Dimension',
    token(noTrivia(sequence(g.NumberToken, optional(g.DimensionUnit)))),
    children => dimension(Number.parseFloat(String(children[0])), String(children[0]))
  );

  /** `url(` with an unquoted body: the body has its own leaf, not a rescan. */
  const UrlUnquoted = node(
    'Url',
    sequence(routed(), optional(g.UrlInner), literal(')')),
    children => url(any(String(children[1] ?? '')))
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
  const RoutedKeyword = node('Keyword', routed(), children => keyword(String(children[0])));

  /** A generic `name(` call. Arguments are the same `ValueList` as everywhere. */
  const RoutedFunction = node(
    'Call',
    sequence(routed(), optional(g.ValueList), literal(')')),
    children => funcCall(String(children[0]).slice(0, -1), [children[1] as ValueSlot])
  );

  /** Value-position punctuation kept verbatim, e.g. the `/` in `font`. */
  const Punctuation = node('Punctuation', valuePunctuation, children => any(String(children[0])));

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
  const Component = choice(IdentOrFunction, g.Quoted, Color, UnicodeRange, Numeric, Group, Punctuation);

  /** A space-separated run of components. */
  const ValueSequence = node(
    'ValueSequence',
    oneOrMore(g.Component),
    children => spaced(children as ValueNode[])
  );

  /** A comma-separated list of space-separated runs. The list owns its comma. */
  const ValueList = node(
    'ValueList',
    oneOrMoreSep(ValueSequence, literal(',')),
    children => list(children as ValueNode[], ',')
  );

  /** A pseudo selector, argument-less or with an opaque argument run. */
  const PseudoSelector = node(
    'PseudoSelector',
    token(noTrivia(sequence(g.PseudoSelectorColon, g.Identifier))),
    children => simpleSelector(String(children[0]))
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
    children => simpleSelector(String(children[1]))
  );

  /** Element, class, id, universal, or percentage keyframe selector — one leaf. */
  const BasicSelector = node('BasicSelector', g.SimpleSelectorToken, children => simpleSelector(String(children[0])));

  /** Adjacent simple selectors with no combinator between them. */
  const CompoundSelector = oneOrMore(choice(BasicSelector, PseudoSelector, AttributeSelector));

  /** Compound selectors joined by combinators or by descendant whitespace. */
  const ComplexSelector = node(
    'ComplexSelector',
    sequence(g.CompoundSelector, many(sequence(optional(combinator), g.CompoundSelector))),
    children => simpleSelector(String(children[0]))
  );

  /** The comma-separated selector list that heads a ruleset. */
  const SelectorList = node(
    'SelectorList',
    oneOrMoreSep(g.ComplexSelector, literal(',')),
    children => selist(...(children as never[]))
  );

  /** `!important`, whose whole spelling including the `!` is one leaf. */
  const Important = token(noTrivia(sequence(literal('!'), optional(whitespace), g.ImportantToken)));

  /** A custom property keeps its value as preserved text, per css-variables-1. */
  const CustomProperty = node(
    'CustomProperty',
    sequence(g.CustomPropertyName, literal(':'), optional(g.CustomOuterContent)),
    children => decl(String(children[0]), any(String(children[2] ?? '')))
  );

  /** An ordinary declaration. The `;` belongs to the block list, not to this. */
  const Declaration = node(
    'Declaration',
    sequence(g.Identifier, literal(':'), g.ValueList, optional(Important)),
    children => decl(String(children[0]), children[2] as ValueSlot, null, children[3] != null)
  );

  /** A `{ … }` body. Items are separated by `;`, which the list owns. */
  const Block = node(
    'Block',
    sequence(
      literal('{'),
      many(choice(sequence(choice(CustomProperty, Declaration), optional(literal(';'))), g.Item)),
      literal('}')
    ),
    children => children[1] as never
  );

  /** An at-rule with a block body: `@name <prelude> { … }`. */
  const AtRuleBlock = node(
    'AtRuleBlock',
    sequence(routed(), optional(g.ValueList), g.Block),
    children => atRuleBlock(String(children[0]).slice(1), children[1] as ValueSlot, children[2] as Statement[])
  );

  /** An at-rule with no block: `@name <prelude> ;`. */
  const AtRuleStatement = node(
    'AtRuleStatement',
    sequence(routed(), optional(g.ValueList), literal(';')),
    children => atRuleStatement(String(children[0]).slice(1), children[1] as ValueNode)
  );

  /**
   * One at-keyword router. The routed value is the full at-keyword, but the
   * block-vs-statement decision is a LATER delimiter (`{` against `;`), so that
   * split stays a local `choice` rather than a dispatch case — see
   * GRAMMAR-REVIEW-STANDARD item 8's rule about committing too early.
   */
  const AtRule = dispatch(
    g.AtRuleKeyword,
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
    CompoundSelector
  };
};

/** The AST artifact. */
export const cssTerminalUpFullGrammar = composeLeaf([cssSyntax, cssPseudoSyntax, rules(
  { trivia: whitespace, scanSkip: [blockComment] },
  terminalUpFactory
)]);
