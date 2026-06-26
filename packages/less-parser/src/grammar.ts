/**
 * Functional Less grammar — the macro-compiled counterpart to the class-based
 * LessGrammar. Mirrors the functional CSS grammar (`node()` rules + a BuilderHost
 * that reuses the class builders), extended with the Less-specific rules the
 * class adds on top of CSS. Combinators are imported `with { type: 'macro' }`,
 * so the whole grammar compiles to flat JS; the rules() map is the entry-point
 * registry the parser dispatches into (stylesheet, value, guard, …).
 */
import {
  node, regex, literal, sequence, choice, many, oneOrMore, optional,
  not, scanTo, balanced, parser, trivia, noTrivia, rules, expect
} from 'parseman' with { type: 'macro' };
import type { Span } from 'parseman';
import { Node, type Rules, type TriviaMap, nil } from '@jesscss/core';
import { LessGrammar } from './builders.js';
import { buildLazyTriviaMap } from '@jesscss/css-parser';

// ---------------------------------------------------------------------------
// Builder host — reuse LessGrammar's builders (Less + inherited CSS buildNode).
// ---------------------------------------------------------------------------

class BuilderHost extends LessGrammar {
  setSource(src: string) {
    this._source = src;
  }

  resetWarnings() {
    this._warnings = [];
    this._errors = [];
  }

  getWarnings() {
    return this._warnings.slice();
  }

  getErrors() {
    return this._errors.slice();
  }

  build(type: string, span: { start: number; end: number }, children: ReadonlyArray<unknown>, rawChildren: ReadonlyArray<unknown>): unknown {
    /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
    return (this as unknown as {
      buildNode(t: string, s: Span, c: ReadonlyArray<unknown>, st: unknown, r: ReadonlyArray<unknown>): unknown;
    }).buildNode(type, span as Span, children, undefined, rawChildren);
    /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
  }
}

const host = new BuilderHost();

export function mk(type: string, children: ReadonlyArray<unknown>, rawChildren: ReadonlyArray<unknown>, span: { start: number; end: number }): unknown {
  return host.build(type, { start: span.start, end: span.end }, children, rawChildren);
}

// ---------------------------------------------------------------------------
// Trivia + terminals (CSS base + Less @var / @{interp}).
// ---------------------------------------------------------------------------

const ws = regex(/[ \t\n\r\f]+/);
const comment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const lineComment = regex(/\/\/[^\n\r]*/);
const rw = trivia(oneOrMore(choice(ws, comment, lineComment)));

const ident = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const basicSel = regex(/(?:[.#]?-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|\d+(?:\.\d+)?%|\*)/);
const combinator = choice(literal('||'), literal('>'), literal('+'), literal('~'), literal('|'));
const pseudoColon = regex(/::?/);
const attrOp = regex(/[*~|^$]?=/);
const attrMod = regex(/[is]/i);
const nth = regex(/even|odd|[-+]?\d*n(?:[ \t\n\r\f]*[+-][ \t\n\r\f]*\d+)?|[-+]?\d+/i);
const singleStr = regex(/'(?:[^'\\]|\\[\s\S])*'/);
const doubleStr = regex(/"(?:[^"\\]|\\[\s\S])*"/);
const customProp = regex(/--[-_a-zA-Z0-9\u0080-\uffff]*/);
const atKeyword = regex(/@-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const numPart = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)/);
const colorHex = regex(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/);
const urlOpen = regex(/url\(/i);
// Unquoted url() body: any run of non-delimiter chars, with CSS escapes (\" \( …)
// so escaped quotes/parens inside the URL don't terminate it.
const urlInner = regex(/(?:\\.|[^)"'\s])+/);
const anyValueTok = regex(/[+\-*/=<>|~^]+|[^\s;{}\[\]()'",!]+/);

// Less-specific terminals.
// First char may be a digit \u2014 Less allows numeric variable names (`@3`, `@{3}`).
const lessVar = regex(/@-?[_a-zA-Z0-9\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const lessInterp = regex(/@\{-?[_a-zA-Z0-9\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*\}/);

// ---------------------------------------------------------------------------
// Grammar — CSS base rules + Less overrides/additions (mirrors LessGrammar).
// ---------------------------------------------------------------------------

const cssRules = rules((g: any) => {
  // ── Root (Less: + VarDeclaration, MixinCall, detached Call) ─────────────────
  // No catch-all: unmatched input stops `many`; the driver reports the unconsumed
  // offset as one syntax error (parseLessFn). Bare `;` is an empty statement.
  const Stylesheet = node('Stylesheet',
    parser({ trivia: rw }, many(choice(
      g.VarDeclaration, g.AtRuleBlock, g.AtRuleStatement, g.ExtendStatement, g.Ruleset, g.MixinOrQualifiedRule,
      sequence(g.Call, optional(literal(';'))), literal(';')
    ))),
    (c: any, r: any, s: any) => mk('Stylesheet', c, r, s));

  // Plain helper consts referenced before their section must be defined up-front
  // (Phase-1 evaluation is sequential; only g.* refs resolve lazily).
  const important = sequence(literal('!'), literal('important'));

  // ── Less variable declaration / reference ───────────────────────────────────
  const detachedBlock = sequence(literal('{'), g.declarationList, literal('}'));
  const VarDeclaration = node('VarDeclaration',
    parser({ trivia: rw }, sequence(lessVar, literal(':'), choice(detachedBlock, sequence(g.valueList, optional(important), optional(literal(';')))))),
    (c: any, r: any, s: any) => mk('VarDeclaration', c, r, s));
  // Regex-based content scan: one level of nested parens + strings, all as one leaf.
  // Avoids the balanced('(',')')-inside-scanTo CSTLeaf pollution bug (balanced uses
  // literal() internally, which pushes leaves into the enclosing node()'s collector).
  // Defined here (before Reference) because refCall reuses it for accessor-chain calls.
  const mixinArgsContent = regex(/(?:[^()'"]|'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\[\s\S])*"|\((?:[^()'"]|'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\[\s\S])*")*\))*/);
  // Accessor key tokens, in lookupOrCall's OR2 order: NestedReference ($@x / @@x),
  // AtKeyword (@x), PropertyReference ($x), InterpolatedIdent (…@{x}…), Ident.
  // The builder applies the index/variable typing + Quoted-wrap (see _buildReference).
  const nestedRef = regex(/(?:[@$]+(?:-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*)?){2,}/);
  const propRef = regex(/\$-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*/);
  const interpKey = regex(/(?:-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*|-)?@\{-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*\}(?:@\{-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*\}|[-_a-zA-Z0-9-￿])*/);
  const refKey = choice(nestedRef, lessVar, propRef, interpKey, ident);
  // One accessor: glued '[' / '(', trivia re-enabled inside the brackets/parens.
  const refIndex = sequence(literal('['), parser({ trivia: rw }, sequence(optional(refKey), literal(']'))));
  const refCall = parser({ trivia: rw }, sequence(literal('('), optional(mixinArgsContent), literal(')')));
  // varReference + lookupOrCall: a @variable glued to a chain of [accessor]/(call).
  // noTrivia() forbids trivia (here: whitespace/comments) between the var and
  // '[' / '(', keeping the chain contiguous (production's noSep()).
  const Reference = node('Reference',
    noTrivia(sequence(lessVar, many(choice(refIndex, refCall)))),
    (c: any, r: any, s: any) => mk('Reference', c, r, s));

  // ── Mixins ───────────────────────────────────────────────────────────────
  const MixinArgs = node('MixinArgs',
    parser({ trivia: rw }, sequence(literal('('), optional(mixinArgsContent), literal(')'))),
    (c: any, r: any, s: any) => mk('MixinArgs', c, r, s));
  const mixinNamePath = parser({ trivia: rw }, sequence(basicSel, many(sequence(optional(combinator), basicSel))));
  // MixinCall names must start with . or # — plain idents are properties, not mixins.
  const mixinCallBasicSel = regex(/[.#]-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*/);
  const mixinCallPath = parser({ trivia: rw }, sequence(g.mixinCallBasicSel, many(sequence(optional(combinator), basicSel))));
  const MixinCall = node('MixinCall',
    parser({ trivia: rw }, sequence(g.mixinCallPath, optional(g.MixinArgs), optional(important), optional(literal(';')))),
    (c: any, r: any, s: any) => mk('MixinCall', c, r, s));
  const AnonymousMixinDefinition = node('AnonymousMixinDefinition',
    parser({ trivia: rw }, sequence(literal('.'), g.MixinArgs, literal('{'), g.declarationList, literal('}'))),
    (c: any, r: any, s: any) => mk('AnonymousMixinDefinition', c, r, s));
  // A bare name with nothing after it is NOT a statement — require args (a mixin
  // call), or a `{}` body / `;` (a qualified rule or mixin call). Otherwise a lone
  // ident like `x` or `nonsense` would be silently accepted.
  const MixinOrQualifiedRule = node('MixinOrQualifiedRule',
    parser({ trivia: rw }, sequence(
      g.mixinNamePath,
      choice(
        sequence(g.MixinArgs, optional(g.Guard), optional(choice(sequence(literal('{'), g.declarationList, literal('}')), literal(';')))),
        sequence(optional(g.Guard), choice(sequence(literal('{'), g.declarationList, literal('}')), literal(';')))
      )
    )),
    (c: any, r: any, s: any) => mk('MixinOrQualifiedRule', c, r, s));

  // ── Guards / comparisons ───────────────────────────────────────────────────
  const Comparison = node('Comparison',
    parser({ trivia: rw }, sequence(g.Reference, regex(/>=|<=|=~|[<>=]/), choice(g.Reference, g.Dimension, g.Num, g.Color, g.NamedColor, g.Quoted, g.anyValue))),
    (c: any, r: any, s: any) => mk('Comparison', c, r, s));
  const GuardCondition = node('GuardCondition',
    parser({ trivia: rw }, sequence(literal('('), g.Comparison, literal(')'))),
    (c: any, r: any, s: any) => mk('GuardCondition', c, r, s));
  const Guard = node('Guard',
    parser({ trivia: rw }, sequence(regex(/when/), optional(regex(/not/)), literal('('),
      many(choice(g.GuardCondition, g.Comparison, regex(/default\(\)/), regex(/and|or/))), literal(')'))),
    (c: any, r: any, s: any) => mk('Guard', c, r, s));

  // ── Less ampersand / interpolated / extend ──────────────────────────────────
  // `&` optionally glued to an alphanumeric suffix (`&1`, `&-bar`) — Less appends
  // it to the parent selector. The `&(…)` form keeps its paren scan.
  const LessAmpersand = node('LessAmpersand',
    parser({ trivia: rw }, sequence(regex(/&[_a-zA-Z0-9-]*/), optional(sequence(literal('('), scanTo(literal(')'), { skip: [balanced('(', ')'), singleStr, doubleStr] }), literal(')'))))),
    (c: any, r: any, s: any) => mk('LessAmpersand', c, r, s));
  const InterpolatedSelector = node('InterpolatedSelector',
    parser({ trivia: rw }, sequence(optional(regex(/[.#]/)), many(regex(/[-_a-zA-Z0-9]+/)), lessInterp, many(choice(lessInterp, regex(/[-_a-zA-Z0-9]+/))))),
    (c: any, r: any, s: any) => mk('InterpolatedSelector', c, r, s));
  const ExtendStatement = node('ExtendStatement',
    parser({ trivia: rw }, sequence(optional(g.LessAmpersand), regex(/::?/), literal('extend'), g.pseudoSelectorParens, optional(literal(';')))),
    (c: any, r: any, s: any) => mk('ExtendStatement', c, r, s));

  // ── Selectors (Less: + ampersand/interp, relative combinator) ───────────────
  // `sel when (…)` is a guarded ruleset: `when` followed by `(` is the guard
  // keyword, NOT another selector — stop the selector run before it (in both the
  // compound run and the complex run, since `& when` has no mixin-path fallback).
  const whenAhead = regex(/when(?![-\w])[ \t\n\r\f]*\(/i);
  const simpleSelector = choice(g.AttributeSelector, g.PseudoSelector, g.LessAmpersand, g.InterpolatedSelector, basicSel);
  const CompoundSelector = node('CompoundSelector',
    parser({ trivia: rw }, sequence(g.simpleSelector, many(sequence(not(whenAhead), g.simpleSelector)))),
    (c: any, r: any, s: any) => mk('CompoundSelector', c, r, s));
  const LessComplexSelector = node('LessComplexSelector',
    parser({ trivia: rw }, sequence(optional(combinator), g.CompoundSelector, many(sequence(optional(combinator), not(whenAhead), g.CompoundSelector)))),
    (c: any, r: any, s: any) => mk('LessComplexSelector', c, r, s));
  const LessSelectorList = node('LessSelectorList',
    parser({ trivia: rw }, sequence(g.LessComplexSelector, many(sequence(literal(','), g.LessComplexSelector)))),
    (c: any, r: any, s: any) => mk('LessSelectorList', c, r, s));
  const AttributeSelector = node('AttributeSelector',
    parser({ trivia: rw }, sequence(literal('['), ident, optional(sequence(attrOp, choice(singleStr, doubleStr, ident), optional(attrMod))), literal(']'))),
    (c: any, r: any, s: any) => mk('AttributeSelector', c, r, s));
  // pseudoArg: content inside pseudo parens (used in ExtendStatement too).
  // PseudoSelector uses a two-branch outer choice so PEG backtracking works when
  // LessSelectorList succeeds internally but ')' doesn't follow (e.g. "!all" suffix).
  const pseudoArg = choice(nth, g.LessSelectorList, scanTo(literal(')'), { skip: [balanced('(', ')')] }));
  const pseudoSelectorParens = choice(
    sequence(literal('('), choice(nth, g.LessSelectorList), literal(')')),
    sequence(literal('('), scanTo(literal(')'), { skip: [balanced('(', ')')] }), literal(')'))
  );
  const PseudoSelector = node('PseudoSelector',
    parser({ trivia: rw }, sequence(pseudoColon, ident, optional(g.pseudoSelectorParens))),
    (c: any, r: any, s: any) => mk('PseudoSelector', c, r, s));

  // ── Ruleset / declarations (Less-aware) ─────────────────────────────────────
  const Ruleset = node('Ruleset',
    parser({ trivia: rw }, sequence(g.LessSelectorList, optional(g.Guard), literal('{'), g.declarationList, expect(literal('}'), '}'))),
    (c: any, r: any, s: any) => mk('Ruleset', c, r, s));
  // A nested mixin DEFINITION inside a rule body: `.name(args) [guard] { … }`.
  // Strict — requires the `()` arg list AND a `{}` body, so it never matches a
  // plain declaration or a `.name { }` ruleset. (declarationList only had MixinCall,
  // which has no body, so nested definitions e.g. `.vars(){…}` were unmodelled.)
  const NestedMixinDefinition = node('MixinOrQualifiedRule',
    parser({ trivia: rw }, sequence(g.mixinCallPath, g.MixinArgs, optional(g.Guard), literal('{'), g.declarationList, literal('}'))),
    (c: any, r: any, s: any) => mk('MixinOrQualifiedRule', c, r, s));
  const declarationList = parser({ trivia: rw }, many(choice(
    g.VarDeclaration, g.AtRuleBlock, g.AtRuleStatement, g.ExtendStatement, g.Ruleset, NestedMixinDefinition, g.MixinCall, g.Declaration, g.CustomDeclaration, literal(';')
  )));
  const Declaration = node('Declaration',
    parser({ trivia: rw }, sequence(ident, optional(choice(literal('+_'), literal('+'))), literal(':'), optional(g.valueList), optional(important), optional(literal(';')))),
    (c: any, r: any, s: any) => mk('Declaration', c, r, s));
  const customValue = parser({ trivia: rw }, sequence(g.valueList, not(regex(/[^\s;}]/))));
  const CustomDeclaration = node('CustomDeclaration',
    parser({ trivia: rw }, sequence(customProp, literal(':'),
      choice(g.customValue, scanTo(choice(literal(';'), literal('}')), { skip: [balanced('(', ')'), balanced('[', ']'), balanced('{', '}')], orEOF: true })),
      optional(literal(';')))),
    (c: any, r: any, s: any) => mk('CustomDeclaration', c, r, s));
  const anyDeclaration = choice(g.VarDeclaration, g.CustomDeclaration, g.Declaration);

  // ── Values (Less: + Reference, NamedColor, EscapedValue) ────────────────────
  const valueList = parser({ trivia: rw }, sequence(g.valueSequence, many(sequence(literal(','), g.valueSequence))));
  const valueSequence = parser({ trivia: rw }, oneOrMore(g.value));
  const value = choice(g.Reference, g.Dimension, g.Num, g.Color, g.NamedColor, g.Url, g.Call, g.EscapedValue, g.Paren, g.SquareParen, g.Quoted, g.anyValue);
  const EscapedValue = node('EscapedValue',
    parser({ trivia: rw }, sequence(literal('~'), choice(g.Paren, g.Quoted))),
    (c: any, r: any, s: any) => mk('EscapedValue', c, r, s));
  const NamedColor = node('NamedColor', regex(/(?:lightgoldenrodyellow|mediumspringgreen|mediumaquamarine|mediumslateblue|mediumturquoise|mediumvioletred|blanchedalmond|cornflowerblue|darkolivegreen|lightslategray|lightslategrey|lightsteelblue|mediumseagreen|darkgoldenrod|darkslateblue|darkslategray|darkslategrey|darkturquoise|lavenderblush|lightseagreen|palegoldenrod|paleturquoise|palevioletred|rebeccapurple|antiquewhite|currentcolor|darkseagreen|lemonchiffon|lightskyblue|mediumorchid|mediumpurple|midnightblue|darkmagenta|deepskyblue|floralwhite|forestgreen|greenyellow|lightsalmon|lightyellow|navajowhite|saddlebrown|springgreen|transparent|yellowgreen|aquamarine|blueviolet|chartreuse|darkorange|darkorchid|darksalmon|darkviolet|dodgerblue|ghostwhite|lightcoral|lightgreen|mediumblue|papayawhip|powderblue|sandybrown|whitesmoke|aliceblue|burlywood|cadetblue|chocolate|darkgreen|darkkhaki|firebrick|gainsboro|goldenrod|indianred|lawngreen|lightblue|lightcyan|lightgray|lightgrey|lightpink|limegreen|mintcream|mistyrose|olivedrab|orangered|palegreen|peachpuff|rosybrown|royalblue|slateblue|slategray|slategrey|steelblue|turquoise|cornsilk|darkblue|darkcyan|darkgray|darkgrey|deeppink|honeydew|lavender|moccasin|seagreen|seashell|crimson|darkred|dimgray|dimgrey|fuchsia|hotpink|magenta|oldlace|skyblue|thistle|bisque|indigo|maroon|orange|orchid|purple|salmon|sienna|silver|tomato|violet|yellow|azure|beige|black|brown|coral|green|ivory|khaki|linen|olive|wheat|white|aqua|blue|cyan|gold|gray|grey|lime|navy|peru|pink|plum|snow|teal|red|tan)(?![-_a-zA-Z0-9])/i), (c: any, r: any, s: any) => mk('NamedColor', c, r, s));
  // unit collapsed to one regex (Dimension still reads number + unit as two leaves).
  const Dimension = node('Dimension', sequence(numPart, regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|%/)), (c: any, r: any, s: any) => mk('Dimension', c, r, s));
  // bare number; the not()-lookahead folded into the regex -> one match, one leaf.
  const Num = node('Num', regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)(?![a-zA-Z\u0080-\uffff%])/), (c: any, r: any, s: any) => mk('Num', c, r, s));
  const Color = node('Color', colorHex, (c: any, r: any, s: any) => mk('Color', c, r, s));
  const Url = node('Url', parser({ trivia: rw }, sequence(urlOpen, optional(choice(singleStr, doubleStr, urlInner)), literal(')'))), (c: any, r: any, s: any) => mk('Url', c, r, s));
  const parenBody = parser({ trivia: rw }, sequence(optional(sequence(g.valueList, many(sequence(literal(';'), optional(g.valueList))))), literal(')')));
  const Call = node('Call', parser({ trivia: rw }, sequence(ident, literal('('), g.parenBody)), (c: any, r: any, s: any) => mk('Call', c, r, s));
  const Paren = node('Paren', parser({ trivia: rw }, sequence(literal('('), g.parenBody)), (c: any, r: any, s: any) => mk('Paren', c, r, s));
  const squareParenBody = parser({ trivia: rw }, sequence(optional(g.valueList), literal(']')));
  const SquareParen = node('SquareParen', parser({ trivia: rw }, sequence(literal('['), g.squareParenBody)), (c: any, r: any, s: any) => mk('SquareParen', c, r, s));
  const Quoted = node('Quoted', choice(singleStr, doubleStr), (c: any, r: any, s: any) => mk('Quoted', c, r, s));
  const anyValue = choice(ident, anyValueTok);

  // ── At-rules ───────────────────────────────────────────────────────────────
  const atPrelude = optional(scanTo(choice(literal('{'), literal(';')), { skip: [balanced('(', ')'), balanced('[', ']'), singleStr, doubleStr] }));
  const AtRuleBlock = node('AtRuleBlock',
    parser({ trivia: rw }, sequence(atKeyword, atPrelude, literal('{'), g.atRuleBody, expect(literal('}'), '}'))),
    (c: any, r: any, s: any) => mk('AtRuleBlock', c, r, s));
  const AtRuleStatement = node('AtRuleStatement',
    parser({ trivia: rw }, sequence(atKeyword, atPrelude, literal(';'))),
    (c: any, r: any, s: any) => mk('AtRuleStatement', c, r, s));
  const atRuleBody = parser({ trivia: rw }, many(choice(
    g.AtRuleBlock, g.AtRuleStatement, g.VarDeclaration, g.Ruleset, g.Declaration, g.CustomDeclaration, literal(';')
  )));

  return {
    Stylesheet, VarDeclaration, Reference, MixinArgs, mixinNamePath, mixinCallBasicSel, mixinCallPath, MixinCall,
    AnonymousMixinDefinition, MixinOrQualifiedRule, Comparison, GuardCondition, Guard,
    LessAmpersand, InterpolatedSelector, ExtendStatement, simpleSelector,
    CompoundSelector, LessComplexSelector, LessSelectorList, AttributeSelector, PseudoSelector, pseudoArg, pseudoSelectorParens,
    Ruleset, declarationList, Declaration, customValue, CustomDeclaration, anyDeclaration,
    valueList, valueSequence, value, EscapedValue, NamedColor, Dimension, Num, Color, Url,
    parenBody, squareParenBody, Call, Paren, SquareParen, Quoted, anyValue, AtRuleBlock, AtRuleStatement, atRuleBody
  };
});

// ---------------------------------------------------------------------------
// Parser — rule-name dispatch (with the class's entry-point aliases).
// ---------------------------------------------------------------------------

const ALIASES: Record<string, string> = {
  stylesheet: 'Stylesheet', main: 'Stylesheet', declaration: 'anyDeclaration',
  declarationList: 'declarationList', selector: 'LessSelectorList',
  complexSelector: 'LessComplexSelector', selectorList: 'LessSelectorList',
  atRule: 'AtRuleBlock', value: 'valueList', valueList: 'valueList',
  comparison: 'Comparison', guard: 'Guard', guardOr: 'Guard', guardAnd: 'Guard',
  qualifiedRule: 'MixinOrQualifiedRule', mixinOrQualifiedRule: 'MixinOrQualifiedRule',
  mixinArgs: 'MixinArgs', anonymousMixinDefinition: 'AnonymousMixinDefinition'
};

export type LessFnParseResult = {
  tree: Node;
  errors: Array<{ message: string; offset?: number }>;
  warnings: Array<{ message: string }>;
  trivia: TriviaMap;
  lexerResult: { errors: Array<unknown> };
};

/**
 * First offset at/after `from` holding real (non-trivia) input, or null if only
 * whitespace / block / line comments remain — the point the grammar stopped short
 * on. Mirrors the less `rw` trivia (ws + block + line comments).
 */
function firstUnparsedOffset(input: string, from: number): number | null {
  let i = from;
  while (i < input.length) {
    const c = input[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') { i++; continue; }
    if (c === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2);
      if (end === -1) return i;
      i = end + 2; continue;
    }
    if (c === '/' && input[i + 1] === '/') {
      const nl = input.indexOf('\n', i + 2);
      if (nl === -1) return null;
      i = nl + 1; continue;
    }
    return i;
  }
  return null;
}

export function parseLessFn(input: string, rule = 'stylesheet'): LessFnParseResult {
  host.setSource(input);
  host.resetWarnings();
  const ruleName = ALIASES[rule] ?? rule;
  const fn = (cssRules as Record<string, unknown>)[ruleName];
  const triviaLog: number[] = [];
  const parseErrors: Array<{ span: { start: number }; expected: string[] }> = [];
  const ctx = { trackLines: false, _triviaLog: triviaLog, _errors: parseErrors };
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
  const r = typeof fn === 'function'
    ? (fn as (i: string, p: number, c: any) => any)(input, 0, ctx)
    : (fn as { parse(i: string, p: number, c: any): any }).parse(input, 0, ctx);

  const tree: Node = r.ok && r.value instanceof Node ? r.value : (nil() as unknown as Node);
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */

  // Same model as parseCssFn: expect()/recover() ParseErrors, a hard top-level
  // failure, and any unconsumed input — report the earliest (one error, stop).
  const collected: Array<{ message: string; offset?: number }> = [];
  for (const e of parseErrors) {
    const exp = e.expected.filter(x => x !== 'sentinel');
    collected.push({ message: exp.length ? `expected ${exp.join(', ')}` : 'Unexpected input', offset: e.span.start });
  }
  if (!r.ok) {
    collected.push({ message: (r.expected ?? []).join(', ') || 'Parse error', offset: r.span?.start });
  }
  const leftoverAt = r.ok ? firstUnparsedOffset(input, r.span?.end ?? 0) : null;
  if (leftoverAt !== null) {
    collected.push({ message: 'Unexpected input', offset: leftoverAt });
  }
  collected.push(...host.getErrors());
  collected.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
  const errors = collected.length > 0 ? [collected[0]!] : [];

  return { tree, errors, warnings: host.getWarnings(), trivia: buildLazyTriviaMap(triviaLog, input), lexerResult: { errors: [] } };
}

/** Functional Less parser — call .parse(text) to get a Jess AST. */
export class LessParser {
  // Config accepted for API compatibility; mathMode and similar are TODO.
  constructor(_config?: Record<string, unknown>) {}

  parse(text: string, rule = 'stylesheet'): LessFnParseResult {
    if (text.includes('`')) {
      throw new Error('Inline JavaScript using backticks is not supported. Use @use / @-use to import a script module instead. Script-module documentation is coming soon.');
    }
    return parseLessFn(text, rule);
  }
}
