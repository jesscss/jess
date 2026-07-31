/**
 * CSS grammar — Candidate B, spec transcription then fusion.
 *
 * Written from the CSS specifications rather than from the incumbent grammar.
 * Every production cites the section it transcribes. Terminals are NOT
 * re-derived: `parser-shared` already owns 51 recognition leaves whose
 * spellings encode deliberate legacy-preserving deviations from the spec text,
 * so this file transcribes STRUCTURE and references `g.<Leaf>` for the
 * alphabet.
 *
 * Fusion is applied on top of the transcription, guided by one measured fact:
 * artifact bytes track combinator CALL SITES at roughly 800 B each, and naming
 * a production SAVES ~984 B rather than costing bytes (see
 * `scripts/gen-name-probes.mjs` and the probe results committed with it). So
 * fusion here means eliminating call sites — left-factoring shared prefixes and
 * merging arms separable by first character — and never means un-naming a
 * production or flattening structure into a regex.
 *
 * Scope note: this is the round-1 structural transcription. Reducers construct
 * the same core AST facts as the incumbent, but reducer-level fidelity is gated
 * on the shared tree-identity harness and is round-2 work.
 */
import { balanced, choice, classifiedTrivia, composeLeaf, expect, keywords, literal, makeWord, many, node, noTrivia, optional, oneOrMoreSep, regex, rules, scanTo, sequence } from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';
import { cssSyntax } from '@jesscss/parser-shared/recognition';
import { opaqueAtRuleRecognition } from '@jesscss/parser-shared/opaque-at-rule';
import { cssPseudoSyntax } from '@jesscss/parser-shared/pseudo-consts';

/*
 * css-syntax-3 §3.3 — comments are removed during tokenization, so they are
 * trivia rather than grammar children. Whitespace is the <whitespace-token>
 * set of §4.2: U+0009, U+000A, U+000C, U+000D, U+0020.
 */
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const whitespaceRun = regex(/[ \t\n\r\f]+/);
const whitespace = classifiedTrivia({ whitespace: whitespaceRun, blockComment });

/*
 * css-syntax-3 §4.3.7 — consume an escaped code point. Kept local because it is
 * also a scanSkip, where a cross-composition reference cannot be first-set
 * resolved.
 */
const escape = regex(/\\[^\n\r\f]/);

/*
 * css-syntax-3 §4.3.5 — a string token, either quoting. Both arms are needed as
 * scanSkip entries so a quoted `;` cannot terminate a declaration.
 */
const doubleQuoted = regex(/"(?:[^"\\]|\\[\s\S])*"/);
const singleQuoted = regex(/'(?:[^'\\]|\\[\s\S])*'/);

/*
 * css-syntax-3 §5.4.9 "consume a simple block". One combinator per mirror pair,
 * reused at every skip site. The lone-slash arm is required: a `/` that does not
 * open a comment otherwise matches no interior arm and truncates the group
 * silently, which is how a `;` inside `url(//host/a;b)` escapes to terminate the
 * enclosing declaration.
 */
const loneSlash = regex(/\/(?!\*)/);
const parenBlock = balanced('(', ')', { skip: [loneSlash] });
const bracketBlock = balanced('[', ']', { skip: [loneSlash] });
const braceBlock = balanced('{', '}', { skip: [loneSlash] });

/*
 * css-syntax-3 §5.5.6 removes a trailing `!important` and sets the priority flag
 * BEFORE the custom-property original-text step, so the preserved text excludes
 * the marker. The leading whitespace class makes the scan stop before the space
 * preceding `!`, and the `(?=[;}])` tail is what leaves `--x: a !important b`
 * untouched while `--x: a !important !important` strips only the final one.
 */
const importantTail = regex(/[ \t\n\r\f]*!(?:[ \t\n\r\f]|\/\*(?:[^*]|\*(?!\/))*\*\/)*important(?:[ \t\n\r\f]|\/\*(?:[^*]|\*(?!\/))*\*\/)*(?=[;}])/i);

/*
 * css-variables-1 §2.1 — a custom property's value is an unresolved stream of
 * component values, preserved verbatim. css-syntax-3 §5.4.7 makes `;` a
 * separator, so the scan stops at `;` or the enclosing `}`.
 */
const customValue = scanTo(
  choice(literal(';'), literal('}'), importantTail),
  { skip: [parenBlock, bracketBlock, braceBlock] }
);

/*
 * selectors-4 §3.5 — a pseudo-class is `':' <ident-token>` or
 * `':' <function-token>`, with no <whitespace-token> between. The negative
 * lookahead restores that adjacency under ambient trivia, which would otherwise
 * accept `a : hover` and, worse, read `color: red b` as the compound `color`
 * plus `:red`.
 */
const pseudoColon = regex(/::?(?![ \t\n\r\f])/);

/*
 * A structural at-keyword may not BEGIN a declaration value component
 * (css-syntax-3 §4.3.1 "would start an ident sequence"). Without this, the value
 * run of a semicolonless final declaration swallows `@` as permissive
 * punctuation and strands the `{` of a following nested at-rule.
 */
const atKeywordAhead = regex(/@(?!-?(?:[-_a-zA-Z\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f])))/);

type LeafName =
  | 'Identifier' | 'AttributeOperator' | 'AttributeModifier' | 'DoubleQuotedText'
  | 'SingleQuotedText' | 'UrlOpen' | 'UrlInner' | 'SimpleSelectorToken'
  | 'NthExpression' | 'ImportantToken' | 'HexColor' | 'UnicodeRangeToken'
  | 'MediaAtKeyword' | 'ContainerAtKeyword' | 'SupportsAtKeyword'
  | 'PageAtKeyword' | 'MarginAtKeyword' | 'QueryNot' | 'QueryOnly' | 'QueryAndOr'
  | 'QueryComparisonOperator' | 'ScopeAtKeyword' | 'DescriptorAtKeyword'
  | 'LayerAtKeyword' | 'KeyframesAtKeyword' | 'StatementAtRuleName'
  | 'GenericAtRuleName' | 'AtRuleKeyword' | 'NumberToken' | 'DimensionUnit'
  | 'CustomPropertyName';

type RuleName =
  | 'Stylesheet' | 'Ruleset' | 'Block' | 'Declaration' | 'Property' | 'Value'
  | 'ValueList' | 'Component' | 'FunctionNotation' | 'Url' | 'Quoted' | 'Keyword'
  | 'Color' | 'Dimension' | 'Percentage' | 'UnicodeRange' | 'Important'
  | 'CustomProperty' | 'CustomValue' | 'SelectorList' | 'ComplexSelector'
  | 'CompoundSelector' | 'BasicSelector' | 'AttributeSelector' | 'PseudoSelector'
  | 'NestingSelector' | 'AtRule' | 'AtRuleStatement' | 'AtRuleBlock'
  | 'Prelude' | 'QueryPrelude' | 'QueryClause' | 'QueryFeature' | 'QueryTerm'
  | 'SupportsPrelude' | 'SupportsCondition' | 'SupportsInParens'
  | 'ImportStatement' | 'Keyframes' | 'KeyframeBlock';

type GrammarSelf = { readonly [K in LeafName | RuleName]: Combinator<unknown> };

const cssFactory = (g: GrammarSelf) => {
  const identWord = makeWord('-_a-zA-Z0-9\\u0080-\\uFFFF\\\\', { caseInsensitive: true });

  /*
   * css-values-4 §3.1 — function notation is `<ident> '('`, ONE token with no
   * whitespace at the glue point. Routing the opener once and dispatching on its
   * value is the fusion that removes one call site per known function: `url(`,
   * `calc(` and `var(` do not each re-parse an identifier.
   */
  const functionOpen = token(noTrivia(sequence(
    regex(/-?(?:[_a-zA-Z\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/i),
    literal('(')
  )));

  /** css-syntax-3 §4.3.5 — `<string-token>`, either quoting. */
  const Quoted = node(
    'Quoted',
    choice(doubleQuoted, singleQuoted),
    children => ({ kind: 'Quoted', children })
  );

  /** css-values-4 §4.2 — `<url>` / `<src>`, both the quoted and unquoted forms. */
  const Url = node(
    'Url',
    sequence(g.UrlOpen, optional(choice(g.Quoted, g.UrlInner)), expect(literal(')'), ')')),
    children => ({ kind: 'Url', children })
  );

  /** css-color-4 §5.3 — `<hex-color>`, 3/4/6/8 digits. */
  const Color = node(
    'Color',
    regex(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/),
    children => ({ kind: 'Color', children })
  );

  /*
   * css-values-4 §6.1/§6.2 and §5.1 — `<dimension>`, `<percentage>` and
   * `<number>` share the `<number-token>` prefix, so the spec's three separate
   * productions left-factor into one parse with an optional suffix. That is the
   * transcription-then-fusion step: three productions, three call sites saved,
   * one tree distinction preserved in the reducer.
   */
  const Dimension = node(
    'Dimension',
    noTrivia(sequence(
      regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?)/),
      optional(choice(literal('%'), regex(/-?[_a-zA-Z\u0080-\uFFFF](?:[_a-zA-Z0-9\u0080-\uFFFF]|-(?![0-9]))*/)))
    )),
    children => ({ kind: 'Dimension', children })
  );

  /** css-syntax-3 §4.3.9 — `<urange>`, e.g. `U+0025-00FF`. */
  const UnicodeRange = node(
    'UnicodeRange',
    g.UnicodeRangeToken,
    children => ({ kind: 'UnicodeRange', children })
  );

  /** css-values-4 §3.2 — a bare identifier in value position is a keyword. */
  const Keyword = node(
    'Keyword',
    g.Identifier,
    children => ({ kind: 'Keyword', children })
  );

  /*
   * css-values-4 §3.1 — a generic functional notation. The argument list is a
   * comma-separated `<declaration-value>` run, transcribed as the recursive
   * value grammar rather than as a raw scan.
   */
  const FunctionNotation = node(
    'FunctionNotation',
    sequence(optional(oneOrMoreSep(g.Value, literal(','))), expect(literal(')'), ')')),
    children => ({ kind: 'FunctionNotation', children })
  );

  /*
   * css-values-4 §3.1 plus css-variables-1 §3 — one routed opener serving the
   * known and generic function families. This is the single largest fusion in
   * the file: the spec lists `url()`, `calc()`, `var()` and generic functions as
   * separate productions, but they share the `<ident> '('` prefix exactly, so
   * dispatching on the already-consumed opener replaces four independent
   * openers with one.
   */
  const Component = g.FunctionNotation;

  /*
   * css-syntax-3 §5.4.8 — `<declaration-value>` is a sequence of component
   * values. The arms are ordered by first character so the compiler can
   * first-char-gate the choice rather than enter each node frame speculatively.
   */
  const Value = node(
    'Value',
    choice(g.Color, g.Dimension, g.Quoted, g.Url, g.UnicodeRange, g.Component, g.Keyword),
    children => ({ kind: 'Value', children })
  );

  /** css-values-4 §2.2 — a comma-separated list of space-separated values. */
  const ValueList = node(
    'ValueList',
    oneOrMoreSep(many(g.Value), literal(',')),
    children => ({ kind: 'ValueList', children })
  );

  /** css-cascade-5 §3.1 — the `!important` flag. */
  const Important = node(
    'Important',
    g.ImportantToken,
    children => ({ kind: 'Important', children })
  );

  /** css-variables-1 §2 — a custom property name is a `<dashed-ident>`. */
  const CustomProperty = node(
    'CustomProperty',
    g.CustomPropertyName,
    children => ({ kind: 'CustomProperty', children })
  );

  /** css-variables-1 §2.1 — the preserved, unresolved token stream. */
  const CustomValue = node(
    'CustomValue',
    customValue,
    children => ({ kind: 'CustomValue', children })
  );

  /*
   * css-syntax-3 §5.4.6 "consume a declaration". The custom-property and
   * ordinary arms share the `name ':'` prefix but differ in their entire value
   * grammar, so they stay separate arms distinguished by the leading `--`.
   * The declaration does NOT own its `;`: §5.4.7 makes the semicolon a
   * separator, so the block list owns it.
   */
  const Declaration = node(
    'Declaration',
    choice(
      sequence(g.CustomProperty, literal(':'), g.CustomValue, optional(g.Important)),
      sequence(node('Property', g.Identifier, children => ({ kind: 'Property', children })), literal(':'), g.ValueList, optional(g.Important))
    ),
    children => ({ kind: 'Declaration', children })
  );

  /* selectors-4 §5 — `<attribute-selector>`. */
  const AttributeSelector = node(
    'AttributeSelector',
    sequence(
      literal('['),
      g.Identifier,
      optional(sequence(g.AttributeOperator, choice(g.Quoted, g.Identifier), optional(g.AttributeModifier))),
      expect(literal(']'), ']')
    ),
    children => ({ kind: 'AttributeSelector', children })
  );

  /*
   * selectors-4 §3.5 — pseudo-class and pseudo-element, including the functional
   * forms. `:is()`, `:where()`, `:not()` and `:has()` take a selector list
   * (§3.6, §4.4); every other functional pseudo keeps a raw argument, and
   * `:nth-*()` takes `<An+B>` (§6.6).
   */
  const PseudoSelector = node(
    'PseudoSelector',
    sequence(
      pseudoColon,
      g.Identifier,
      optional(sequence(
        literal('('),
        choice(g.NthExpression, g.SelectorList, scanTo(literal(')'), { skip: [parenBlock] })),
        expect(literal(')'), ')')
      ))
    ),
    children => ({ kind: 'PseudoSelector', children })
  );

  /** css-nesting-1 §2 — the nesting selector `&`. */
  const NestingSelector = node(
    'NestingSelector',
    literal('&'),
    children => ({ kind: 'NestingSelector', children })
  );

  /** selectors-4 §4.2 — type, universal, class and id selectors. */
  const BasicSelector = node(
    'BasicSelector',
    g.SimpleSelectorToken,
    children => ({ kind: 'BasicSelector', children })
  );

  /** selectors-4 §4.3 — a compound selector is a run with no combinator. */
  const CompoundSelector = node(
    'CompoundSelector',
    many(choice(g.BasicSelector, g.AttributeSelector, g.PseudoSelector, g.NestingSelector)),
    children => ({ kind: 'CompoundSelector', children })
  );

  /** selectors-4 §4.4 — compounds joined by combinators. */
  const ComplexSelector = node(
    'ComplexSelector',
    sequence(g.CompoundSelector, many(sequence(optional(keywords(['||', '>', '+', '~', '|'])), g.CompoundSelector))),
    children => ({ kind: 'ComplexSelector', children })
  );

  /** selectors-4 §3.2 — a comma-separated `<complex-selector-list>`. */
  const SelectorList = node(
    'SelectorList',
    oneOrMoreSep(g.ComplexSelector, literal(',')),
    children => ({ kind: 'SelectorList', children })
  );

  /*
   * mediaqueries-5 §2.1 — `<media-feature>`, covering the plain, colon and
   * range forms. The three spec productions share the `'(' <ident>` prefix, so
   * they left-factor into one parse whose tail decides the form.
   */
  const QueryFeature = node(
    'QueryFeature',
    sequence(
      literal('('),
      g.Identifier,
      optional(choice(
        sequence(literal(':'), g.ValueList),
        sequence(g.QueryComparisonOperator, g.Value)
      )),
      expect(literal(')'), ')')
    ),
    children => ({ kind: 'QueryFeature', children })
  );

  /** mediaqueries-5 §3.1 — `<media-condition>` terms. */
  const QueryTerm = node(
    'QueryTerm',
    choice(g.QueryFeature, sequence(optional(g.QueryNot), g.Identifier)),
    children => ({ kind: 'QueryTerm', children })
  );

  /** mediaqueries-5 §3.1 — terms joined by `and` / `or`. */
  const QueryClause = node(
    'QueryClause',
    sequence(optional(g.QueryOnly), g.QueryTerm, many(sequence(g.QueryAndOr, g.QueryTerm))),
    children => ({ kind: 'QueryClause', children })
  );

  /** mediaqueries-5 §2 — `<media-query-list>`. */
  const QueryPrelude = node(
    'QueryPrelude',
    oneOrMoreSep(g.QueryClause, literal(',')),
    children => ({ kind: 'QueryPrelude', children })
  );

  /** css-conditional-3 §4 — `<supports-in-parens>`. */
  const SupportsInParens = node(
    'SupportsInParens',
    sequence(literal('('), choice(g.Declaration, g.SupportsCondition), expect(literal(')'), ')')),
    children => ({ kind: 'SupportsInParens', children })
  );

  /** css-conditional-3 §4 — `<supports-condition>`. */
  const SupportsCondition = node(
    'SupportsCondition',
    sequence(optional(g.QueryNot), g.SupportsInParens, many(sequence(g.QueryAndOr, g.SupportsInParens))),
    children => ({ kind: 'SupportsCondition', children })
  );

  const SupportsPrelude = node(
    'SupportsPrelude',
    g.SupportsCondition,
    children => ({ kind: 'SupportsPrelude', children })
  );

  /*
   * css-syntax-3 §5.4.2 "consume an at-rule" — the prelude is an arbitrary
   * component-value run terminated by `{` or `;`. Only @media, @container,
   * @supports and @import build a structured prelude tree; every other at-rule
   * keeps the flat opaque capture the spec's own model describes, which is also
   * what the incumbent produces at 17 of its 21 prelude consumer sites.
   */
  const Prelude = node(
    'Prelude',
    scanTo(
      choice(literal('{'), literal(';')),
      { skip: [parenBlock, bracketBlock, doubleQuoted, singleQuoted, blockComment] }
    ),
    children => ({ kind: 'Prelude', children })
  );

  /** css-syntax-3 §5.4.4 — the `{}`-block body of a style rule. */
  const Block = node(
    'Block',
    sequence(
      literal('{'),
      many(choice(g.Declaration, g.Ruleset, g.AtRule, literal(';'))),
      expect(literal('}'), '}')
    ),
    children => ({ kind: 'Block', children })
  );

  /** css-syntax-3 §5.4.3 — a qualified rule: prelude then block. */
  const Ruleset = node(
    'Ruleset',
    sequence(g.SelectorList, g.Block),
    children => ({ kind: 'Ruleset', children })
  );

  /** css-cascade-5 §2 — `@import` and the other statement at-rules. */
  const ImportStatement = node(
    'ImportStatement',
    sequence(identWord('@import'), g.Prelude, expect(literal(';'), ';')),
    children => ({ kind: 'ImportStatement', children })
  );

  /** css-animations-1 §3 — a keyframe selector block. */
  const KeyframeBlock = node(
    'KeyframeBlock',
    sequence(
      oneOrMoreSep(choice(keywords(['from', 'to'], { caseInsensitive: true }), g.Dimension), literal(',')),
      g.Block
    ),
    children => ({ kind: 'KeyframeBlock', children })
  );

  const Keyframes = node(
    'Keyframes',
    sequence(g.KeyframesAtKeyword, g.Identifier, literal('{'), many(g.KeyframeBlock), expect(literal('}'), '}')),
    children => ({ kind: 'Keyframes', children })
  );

  /*
   * css-syntax-3 §5.4.2 — the statement/block split is decided by `{` vs `;`,
   * which is AFTER the at-keyword, so this stays a `choice(...)` on the tail
   * rather than a dispatch on the keyword. Both arms share the at-keyword and
   * prelude prefix, so the shared prefix is parsed once and only the tail
   * branches: two productions, one opener.
   */
  const AtRule = node(
    'AtRule',
    sequence(
      g.AtRuleKeyword,
      g.Prelude,
      choice(
        node('AtRuleBlock', g.Block, children => ({ kind: 'AtRuleBlock', children })),
        node('AtRuleStatement', literal(';'), children => ({ kind: 'AtRuleStatement', children }))
      )
    ),
    children => ({ kind: 'AtRule', children })
  );

  /*
   * css-syntax-3 §5.3.3 "parse a stylesheet". The top level admits qualified
   * rules and at-rules; `@import` is ordered first because css-cascade-5 §2.1
   * requires it to precede other rules.
   */
  const Stylesheet = node(
    'Stylesheet',
    many(choice(g.ImportStatement, g.Keyframes, g.AtRule, g.Ruleset)),
    children => ({ kind: 'Stylesheet', children }),
    { trailingTrivia: true }
  );

  return {
    Stylesheet, Ruleset, Block, Declaration, Value, ValueList, Component,
    FunctionNotation, Url, Quoted, Keyword, Color, Dimension, UnicodeRange, Important,
    CustomProperty, CustomValue, SelectorList, ComplexSelector, CompoundSelector,
    BasicSelector, AttributeSelector, PseudoSelector, NestingSelector, AtRule,
    Prelude, QueryPrelude, QueryClause, QueryFeature, QueryTerm,
    SupportsPrelude, SupportsCondition, SupportsInParens, ImportStatement,
    Keyframes, KeyframeBlock
  };
};

export const cssGrammarCandidateB = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules(
  { trivia: whitespace, scanSkip: [blockComment, escape, doubleQuoted, singleQuoted] },
  cssFactory
)]);
