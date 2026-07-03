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
  not, scanTo, balanced, parser, trivia, noTrivia, rules, expect, sepBy
} from 'parseman' with { type: 'macro' };
import type { Span } from 'parseman';
import { Node, Rules, type TriviaMap, type MathMode, nil, type JessError } from '@jesscss/core';
import { LessGrammar } from './builders.js';
import { buildLazyTriviaMap, toParseError } from '@jesscss/css-parser';

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
// Whitespace-only trivia for url() bodies: inside `url(…)`, `//` and `/*` are URL
// characters, not comments (`url(//host/x)` is protocol-relative), so the normal
// `rw` (which skips line/block comments) must not apply there.
const urlWs = trivia(ws);

const ident = regex(/-?(?:[_a-zA-Z-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))(?:[-_a-zA-Z0-9-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))*/);
// Selectors / mixin names / idents include CSS escapes (\hex, \char) — same
// definition as css-parser grammar.ts (a mixin call is just a selector).
const basicSel = regex(/(?:[.#]?-?(?:[_a-zA-Z-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))(?:[-_a-zA-Z0-9-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))*|\d+(?:\.\d+)?%|\*)/);
const propName = regex(/\*?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))*/);
const combinator = choice(literal('||'), literal('>'), literal('+'), literal('~'), literal('|'));
const pseudoColon = regex(/::?/);
const attrOp = regex(/[*~|^$]?=/);
const attrMod = regex(/[is]/i);
const nth = regex(/even|odd|[-+]?\d*n(?:[ \t\n\r\f]*[+-][ \t\n\r\f]*\d+)?|[-+]?\d+/i);
const singleStr = regex(/'(?:[^'\\]|\\[\s\S])*'/);
const doubleStr = regex(/"(?:[^"\\]|\\[\s\S])*"/);
const customProp = regex(/--[-_a-zA-Z0-9\u0080-\uffff]*/);
// Interpolated custom-property name (`--@{key}`, `--foo-@{key}-bar`). Port of the
// reference's InterpolatedCustomProperty token: `--` + optional ident run, then
// one-or-more `@{...}` interpolations interleaved with further ident runs. Tried
// before the plain `customProp` regex, which stops at `@` (not an ident char) and
// would otherwise match only `--`, failing the declaration outright.
const customPropInterp = regex(/--(?:-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|-)?@\{-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*\}(?:@\{-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*\}|[-_a-zA-Z0-9\u0080-\uffff])*/);
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
// `@` + one or more name chars (dash included), so a dash-only name like `@-` is
// valid (Less accepts it). Digits are allowed anywhere (`@3` \u2014 flagged, not rejected).
const lessVar = regex(/@[-_a-zA-Z0-9\u0080-\uffff]+/);
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
      g.VarDeclaration, g.VarCall, g.QueryAtRuleBlock, g.AtRuleBlock, g.ImportAtRuleStatement, g.AtRuleStatement, g.ExtendStatement, g.Ruleset, g.MixinOrQualifiedRule, g.EachFor,
      sequence(g.Call, optional(literal(';'))), literal(';')
    ))),
    (c: any, r: any, s: any) => mk('Stylesheet', c, r, s));

  // Plain helper consts referenced before their section must be defined up-front
  // (Phase-1 evaluation is sequential; only g.* refs resolve lazily).
  const important = sequence(literal('!'), literal('important'));

  // ── Less variable declaration / reference ───────────────────────────────────
  const detachedBlock = sequence(literal('{'), g.declarationList, literal('}'));
  // The var-name colon is adjacent (`@x:`), NOT separated by trivia — otherwise
  // `@page :first { … }` (an at-rule with a pseudo-page prelude) is mis-read as a
  // variable declaration `@page: first`. noTrivia keeps `@x` and `:` contiguous.
  const VarDeclaration = node('VarDeclaration',
    parser({ trivia: rw }, sequence(noTrivia(sequence(lessVar, literal(':'))), choice(detachedBlock, sequence(g.valueList, optional(important), optional(literal(';')))))),
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
  const interpKey = regex(/(?:-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*|-)?[@$]\{-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*\}(?:[@$]\{-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*\}|[-_a-zA-Z0-9-￿])*/);
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

  // ── Detached-ruleset variable call ─────────────────────────────────────────
  // `@name(...)` (no `:`) is a variable CALL of a detached ruleset, not a var
  // decl or an at-rule. Faithful port of `varDeclarationOrCall`'s LParen branch
  // (selectors.ts) + the `isVariableLike` disambiguation (root.ts): a KNOWN
  // at-rule name (@media, @supports, …) followed by NON-empty parens stays an
  // at-rule — `@media() ` (empty parens) is a deprecated var call, and any other
  // `@var(...)` is a var call regardless of parens content. The builder emits the
  // production's `Expression(Call{ name: Reference[role=name], args })` shape.
  // A var name that is NOT a known at-rule name (negative lookahead asserts the
  // known name is not the COMPLETE ident before the call parens).
  const nonKnownAtVar = regex(/@-?(?!(?:(?:-moz-)?document|(?:-[a-z]+-)?keyframes|(?:-ms-)?viewport|import|media|supports|layer|container|scope|page|font-face|starting-style|property|counter-style|color-profile|font-palette-values|namespace)(?![-_a-zA-Z0-9]))[_a-zA-Z0-9-￿][-_a-zA-Z0-9-￿]*/);
  const knownAtVar = regex(/@(?:(?:-moz-)?document|(?:-[a-z]+-)?keyframes|(?:-ms-)?viewport|import|media|supports|layer|container|scope|page|font-face|starting-style|property|counter-style|color-profile|font-palette-values|namespace)(?![-_a-zA-Z0-9])/);
  const VarCall = node('VarCall',
    parser({ trivia: rw }, choice(
      sequence(nonKnownAtVar, g.MixinArgs, optional(important), optional(literal(';'))),
      // Known at-rule name with EMPTY parens only.
      sequence(knownAtVar, literal('('), literal(')'), optional(important), optional(literal(';')))
    )),
    (c: any, r: any, s: any) => mk('VarCall', c, r, s));

  // ── Mixins ───────────────────────────────────────────────────────────────
  // Structured mixin args: the COMBINATORS split on the separators (sepBy), each
  // arg VALUE an opaque chunk scanned to the next top-level `,` `;` or `)` (values
  // are freeform — scanTo is the right tool *here*, and balanced skips keep commas
  // inside nested ()/[]/{}/strings out of the split). The builder reads the
  // pre-split chunks/separators (no string _splitTopLevel) and rejects mixing `,`
  // and `;` to separate args. See _buildMixinArgs.
  const argChunk = scanTo(choice(literal(','), literal(';'), literal(')')),
    { skip: [balanced('(', ')'), balanced('[', ']'), balanced('{', '}'), singleStr, doubleStr] });
  const MixinArgs = node('MixinArgs',
    parser({ trivia: rw }, sequence(literal('('), optional(sepBy(sepBy(argChunk, literal(',')), literal(';'))), literal(')'))),
    (c: any, r: any, s: any) => mk('MixinArgs', c, r, s));
  const mixinNamePath = parser({ trivia: rw }, sequence(basicSel, many(sequence(optional(combinator), basicSel))));
  // MixinCall names must start with . or # — plain idents are properties, not mixins.
  const mixinCallBasicSel = regex(/[.#]-?(?:[_a-zA-Z-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))(?:[-_a-zA-Z0-9-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))*/);
  const mixinCallPath = parser({ trivia: rw }, sequence(g.mixinCallBasicSel, many(sequence(optional(combinator), basicSel))));
  const MixinCall = node('MixinCall',
    parser({ trivia: rw }, sequence(g.mixinCallPath, optional(g.MixinArgs), optional(important), optional(literal(';')))),
    (c: any, r: any, s: any) => mk('MixinCall', c, r, s));
  // Anonymous mixin callback: `.(…){…}` OR `#(…){…}` — the Chevrotain
  // AnonMixinStart token is `/[.#]\(/`, so both prefixes are valid.
  const AnonymousMixinDefinition = node('AnonymousMixinDefinition',
    parser({ trivia: rw }, sequence(regex(/[.#]/), g.MixinArgs, literal('{'), g.declarationList, literal('}'))),
    (c: any, r: any, s: any) => mk('AnonymousMixinDefinition', c, r, s));
  // A bare name with nothing after it is NOT a statement — require args (a mixin
  // call), or a `{}` body / `;` (a qualified rule or mixin call). Otherwise a lone
  // ident like `x` or `nonsense` would be silently accepted.
  // Two combinator-distinguished forms — the PARSER decides validity, not a
  // post-hoc name check:
  //   block form: `name [args] [guard] { … }` — a mixin definition or qualified
  //               rule (name path may be a bare selector); a `{}` body is required.
  //   call  form: `path [args] [guard] [;]` — a mixin CALL; the path MUST start
  //               with `.`/`#` (mixinCallPath). A bare ident like `nonsense;` is
  //               not a `.`/`#` path and has no block, so it matches NEITHER and is
  //               reported as unconsumed input.
  const MixinOrQualifiedRule = node('MixinOrQualifiedRule',
    parser({ trivia: rw }, choice(
      sequence(g.mixinNamePath, optional(g.MixinArgs), optional(g.Guard), literal('{'), g.declarationList, literal('}')),
      sequence(g.mixinCallPath, optional(g.MixinArgs), optional(g.Guard), optional(important), optional(literal(';')))
    )),
    (c: any, r: any, s: any) => mk('MixinOrQualifiedRule', c, r, s));

  // ── Guards / comparisons ───────────────────────────────────────────────────
  // Faithful port of the Chevrotain guard productions (src/productions/guards.ts):
  //   guard → 'when' guardOr
  //   guardOr  → guardAnd ( ('or' | ',') guardAnd )*        (left-assoc, 'or')
  //   guardAnd → guardTerm ( 'and' guardTerm )*             (left-assoc, 'and')
  //   guardTerm → [not] ( guardInParens | comparison/value )
  //   guardInParens → guardDefault | '(' guardOr ')'        (wrapped in Paren)
  //   guardDefault  → 'default()'  →  DefaultGuard
  // Precedence: 'or' loops over 'and'; parens nest a fresh guardOr. `not` negates a
  // single term, producing a Condition(negate:true). Comparisons are a left operand
  // followed by an optional `<op> right`.
  const compareOp = regex(/>=|<=|=>|=<|=~|[<>=]/);
  // A single comparison operand (mirrors expressionSum's value role here).
  const guardOperand = choice(g.Reference, g.Dimension, g.Num, g.Color, g.NamedColor, g.Quoted, g.Call, g.Paren, g.anyValue);
  const Comparison = node('Comparison',
    parser({ trivia: rw }, sequence(g.Reference, compareOp, choice(g.Reference, g.Dimension, g.Num, g.Color, g.NamedColor, g.Quoted, g.anyValue))),
    (c: any, r: any, s: any) => mk('Comparison', c, r, s));
  const GuardDefault = node('GuardDefault',
    parser({ trivia: rw }, regex(/default(?:[ \t\n\r\f]*\([ \t\n\r\f]*\))?(?![-\w])/)),
    (c: any, r: any, s: any) => mk('GuardDefault', c, r, s));
  // '(' guardOr ')' → Paren; or a bare default(). Wrapped in a Paren node.
  const GuardInParens = node('GuardInParens',
    parser({ trivia: rw }, choice(
      g.GuardDefault,
      sequence(literal('('), g.GuardOr, literal(')'))
    )),
    (c: any, r: any, s: any) => mk('GuardInParens', c, r, s));
  // A single guard term: optional `not`, then either a parenthesized guard or a
  // bare comparison (`left <op> right`) / value.
  const GuardTerm = node('GuardTerm',
    parser({ trivia: rw }, sequence(
      optional(regex(/not(?![-\w])/)),
      choice(
        g.GuardInParens,
        sequence(guardOperand, optional(sequence(compareOp, guardOperand)))
      )
    )),
    (c: any, r: any, s: any) => mk('GuardTerm', c, r, s));
  // 'and' chain of terms (left-associative).
  const GuardAnd = node('GuardAnd',
    parser({ trivia: rw }, sequence(g.GuardTerm, many(sequence(regex(/and(?![-\w])/), g.GuardTerm)))),
    (c: any, r: any, s: any) => mk('GuardAnd', c, r, s));
  // 'or' / ',' chain of and-expressions (left-associative).
  const GuardOr = node('GuardOr',
    parser({ trivia: rw }, sequence(g.GuardAnd, many(sequence(choice(regex(/or(?![-\w])/), literal(',')), g.GuardAnd)))),
    (c: any, r: any, s: any) => mk('GuardOr', c, r, s));
  const Guard = node('Guard',
    parser({ trivia: rw }, sequence(regex(/when(?![-\w])/), g.GuardOr)),
    (c: any, r: any, s: any) => mk('Guard', c, r, s));

  // ── Less ampersand / interpolated / extend ──────────────────────────────────
  // `&` glued to a suffix (`&1`, `&-bar`) OR a prefix (`.foo-&`, `#bar-&`) — Less
  // appends/prepends it to the parent selector. Mirrors the reference Ampersand
  // token pattern `(?:[.#]({{ident}}-)?&|&){{nmchar}}*` (lessTokens.ts), so a
  // prefix template parses as ONE Ampersand node (image `.foo-&`), not a
  // CompoundSelector of `['.foo-', &]`. The `&(…)` form keeps its paren scan; the
  // paren only follows a bare `&` in practice (prefix forms have no `(`).
  const ampToken = regex(/(?:[.#](?:-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*-)?&|&)[-_a-zA-Z0-9-￿]*/);
  const LessAmpersand = node('LessAmpersand',
    parser({ trivia: rw }, sequence(ampToken, optional(sequence(literal('('), scanTo(literal(')'), { skip: [balanced('(', ')'), singleStr, doubleStr] }), literal(')'))))),
    (c: any, r: any, s: any) => mk('LessAmpersand', c, r, s));
  const InterpolatedSelector = node('InterpolatedSelector',
    parser({ trivia: rw }, sequence(optional(regex(/[.#]/)), many(regex(/[-_a-zA-Z0-9]+/)), lessInterp, many(choice(lessInterp, regex(/[-_a-zA-Z0-9]+/))))),
    (c: any, r: any, s: any) => mk('InterpolatedSelector', c, r, s));

  // ── Selectors (Less: + ampersand/interp, relative combinator) ───────────────
  // `sel when …` is a guarded ruleset: the `when` KEYWORD is the guard boundary,
  // never a selector token — stop the selector run before it (the reference gets
  // this from its lexer's `When` token; scannerless, we assert the keyword). The
  // guard body (`(…)`, `not (…)`, `default()`, `and`/`or` chains) is then parsed
  // by the atomic Guard rule — so the boundary must be just `when`, NOT `when (`
  // (which missed `when not (…)`, `when default()`, …).
  const whenAhead = regex(/when(?![-\w])/i);
  // `:extend(` lookahead — keeps the generic PseudoSelector from claiming extend
  // (extend goes through ExtendPseudo) and lets the compound run stop before it.
  const extendAhead = regex(/::?extend[ \t\n\r\f]*\(/);
  // The two selector-run boundaries (`when` guard keyword, `:extend(`) combined
  // into ONE lookahead regex: `not(selectorBoundary)` ran two regex
  // execs at every simple/compound iteration — ~8% of parse on a selector-dense
  // file. `not(selectorBoundary)` is equivalent (not A ∧ not B = not(A∨B)) at one
  // exec. Used only in the `many(...)` run stops; the standalone extendAhead gate
  // before PseudoSelector is unchanged.
  const selectorBoundary = regex(/when(?![-\w])|::?extend[ \t\n\r\f]*\(/i);
  const simpleSelector = choice(g.AttributeSelector, sequence(not(extendAhead), g.PseudoSelector), g.LessAmpersand, g.InterpolatedSelector, basicSel);
  // collapse: a single simple selector (76% of compounds — `.btn`, `a`, `:hover`)
  // IS that token; skip the build+frame and pass the child straight through. The
  // builder's single-child path already returned the bare component, so this is
  // byte-identical — a 2+-simple / whitespace-descendant run still builds.
  const CompoundSelector = node('CompoundSelector',
    parser({ trivia: rw }, sequence(g.simpleSelector, many(sequence(not(selectorBoundary), g.simpleSelector)))),
    (c: any, r: any, s: any) => mk('CompoundSelector', c, r, s), { collapse: true });
  // A complex selector, optionally terminated by a single `:extend(...)` pseudo.
  // Mirrors Chevrotain's `complexSelector`, which consumes extend (OPTION3) AFTER
  // the whole compound/combinator run — so extend is the LAST thing in the
  // selector, and `.a:extend(.b).c` leaves `.c` unconsumed → parse error
  // (extend-must-be-last). The compound run also stops at `:extend(` (extendAhead).
  // collapse: single compound (no combinator, no extend) IS the compound.
  const LessComplexSelector = node('LessComplexSelector',
    parser({ trivia: rw }, sequence(optional(combinator), g.CompoundSelector, many(sequence(optional(combinator), not(selectorBoundary), g.CompoundSelector)), optional(g.ExtendPseudo))),
    (c: any, r: any, s: any) => mk('LessComplexSelector', c, r, s), { collapse: true });
  // collapse: single complex selector (no comma) IS that selector.
  const LessSelectorList = node('LessSelectorList',
    parser({ trivia: rw }, sequence(g.LessComplexSelector, many(sequence(literal(','), g.LessComplexSelector)))),
    (c: any, r: any, s: any) => mk('LessSelectorList', c, r, s), { collapse: true });
  // Attribute name may carry a CSS namespace prefix (`ns|attr`, `*|attr`,
  // `|attr`). Less also allows interpolation in the name and value: `[@{n}=@{v}]`,
  // `[data=@{attr-data}]`. interpKey matches a run containing `@{…}`.
  // `|` is a namespace separator (`ns|attr`, `*|attr`, `|attr`) ONLY when not
  // followed by `=` — `[prop|="x"]` is the `|=` dash-match operator, not a namespace.
  const attrNsPrefix = optional(sequence(optional(choice(literal('*'), ident)), regex(/\|(?!=)/)));
  const AttributeSelector = node('AttributeSelector',
    parser({ trivia: rw }, sequence(literal('['), attrNsPrefix, choice(interpKey, ident), optional(sequence(attrOp, choice(singleStr, doubleStr, interpKey, ident), optional(attrMod))), literal(']'))),
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
    parser({ trivia: rw }, sequence(pseudoColon, choice(interpKey, ident), optional(g.pseudoSelectorParens))),
    (c: any, r: any, s: any) => mk('PseudoSelector', c, r, s));

  // ── Extend grammar (faithful port of selectors.ts `extend`/`ampersandExtend`)
  // Chevrotain models extend as: `:extend(` selectorList[inExtend] `)` where each
  // complexSelector inside consumes an optional trailing `all` flag (OPTION2 on
  // T.All / T.AllFlag). The statement form `&:extend(...)` ends with `;`. Here
  // each piece is real grammar (comma list + per-target flag) rather than
  // re-parsing the source text.
  //
  // A per-target `all` / `!all` flag (Chevrotain's T.All / T.AllFlag); both
  // collapse to ExtendFlag.All in the builder.
  const extendFlag = regex(/!?all(?![-\w])/);
  // Lookahead used to stop the target's compound/complex run before the flag, so
  // `all` is consumed as the flag — not swallowed as a trailing ident selector.
  const extendFlagAhead = regex(/!?all(?![-\w])[ \t\n\r\f]*[,)]/);
  // Extend-local compound/complex selectors: identical to the normal ones but they
  // halt before a trailing flag (so `.x all` parses as target `.x` + flag `all`).
  const extendCompound = node('CompoundSelector',
    parser({ trivia: rw }, sequence(g.simpleSelector, many(sequence(not(selectorBoundary), not(extendFlagAhead), g.simpleSelector)))),
    (c: any, r: any, s: any) => mk('CompoundSelector', c, r, s));
  const extendComplex = node('LessComplexSelector',
    parser({ trivia: rw }, sequence(optional(combinator), g.extendCompound, many(sequence(optional(combinator), not(whenAhead), not(extendFlagAhead), g.extendCompound)))),
    (c: any, r: any, s: any) => mk('LessComplexSelector', c, r, s));
  // A single extend target: a complex selector + its optional flag.
  const ExtendTarget = node('ExtendTarget',
    parser({ trivia: rw }, sequence(g.extendComplex, optional(extendFlag))),
    (c: any, r: any, s: any) => mk('ExtendTarget', c, r, s));
  // The comma-separated target list inside `extend( … )` (selectorList[inExtend]).
  const extendBody = sepBy(g.ExtendTarget, literal(','));
  // `:extend(` body `)` — the in-selector pseudo form (selectors.ts `extend`).
  const ExtendPseudo = node('ExtendPseudo',
    parser({ trivia: rw }, sequence(pseudoColon, literal('extend'), literal('('), extendBody, expect(literal(')'), ')'))),
    (c: any, r: any, s: any) => mk('ExtendPseudo', c, r, s));
  // `&:extend(...)` statement, terminated by `;` (selectors.ts `ampersandExtend`).
  // The leading `&` is REQUIRED: the reference's `ampersandExtend` does an
  // unconditional `$.CONSUME(T.Ampersand)`, so a bare `:extend(...)` is NOT a valid
  // standalone statement. Making `&` mandatory keeps `.a:extend(.b).c { … }` from
  // mis-splitting into `.a` (mixin call) + bare `:extend(.b)` + `.c { … }`; instead
  // the leftover `:extend(` after the `.a` mixin call is unconsumed input → one
  // parse error (faithful: extend must be the last thing in its selector).
  const ExtendStatement = node('ExtendStatement',
    parser({ trivia: rw }, sequence(g.LessAmpersand, g.ExtendPseudo, optional(literal(';')))),
    (c: any, r: any, s: any) => mk('ExtendStatement', c, r, s));

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
    g.VarDeclaration, g.VarCall, g.QueryAtRuleBlock, g.AtRuleBlock, g.ImportAtRuleStatement, g.AtRuleStatement, g.ExtendStatement, g.Ruleset, NestedMixinDefinition, g.EachFor, g.MixinCall, g.Declaration, g.CustomDeclaration,
    // A bare function-call statement in a body, e.g. `each(@list, { … });`. Needs
    // `ident(` so it never shadows a Declaration (which needs `:`).
    sequence(g.Call, optional(literal(';'))), literal(';')
  )));
  // Property name may itself be interpolated (`@{prop}: …`, `pre-@{x}-post: …`).
  // Chevrotain lexes the name as a single Ident/InterpolatedIdent token whose image
  // carries the `@{…}` runs; `declaration` then routes an image containing `@`/`$`
  // through getInterpolatedNode. We mirror that: try the interpolated-ident regex
  // first (it requires at least one `@{…}`), else a plain ident.
  const Declaration = node('Declaration',
    parser({ trivia: rw }, sequence(choice(interpKey, propName), optional(choice(literal('+_'), literal('+'))), literal(':'), optional(g.valueList), optional(important), optional(literal(';')))),
    (c: any, r: any, s: any) => mk('Declaration', c, r, s));
  const customValue = parser({ trivia: rw }, sequence(g.valueList, not(regex(/[^\s;}]/))));
  // Opportunistic structuring for a `{ … }` custom-property value: try it as a
  // real declaration body (so nested `@var`/calls evaluate normally, same as the
  // `[…]` case already does via customValue's valueList), tolerant of anything
  // that isn't CSS-shaped. No `expect()` on the closing `}` — a non-declaration
  // body (arbitrary tokens) simply fails this alt with no error recorded, and
  // `choice` falls through to the raw-text cpValue capture below.
  const customCurlyBlock = node('Block',
    parser({ trivia: rw }, sequence(literal('{'), g.declarationList, literal('}'))),
    (c: any, r: any, s: any) => mk('Block', c, r, s));
  // Predictive custom-property value region — NO scanTo, NO skip. Content runs
  // interleaved with recursively-balanced ()/[]/{} groups, each closed by expect().
  // So an unmatched, stray, or CROSS-TYPE bracket (`({[ })`) surfaces a syntax error
  // instead of being swallowed. noTrivia keeps the value verbatim; inside a group a
  // `;` is content (only the group's own close ends it), at top level `;`/`}` end it.
  const cpInnerContent = regex(/[^(){}[\]'"]+/);
  const cpOuterContent = regex(/[^(){}[\];'"]+/);
  const cpInner = many(choice(cpInnerContent, g.cpParen, g.cpSquare, g.cpCurly, singleStr, doubleStr));
  const cpParen = sequence(literal('('), g.cpInner, expect(literal(')'), ')'));
  const cpSquare = sequence(literal('['), g.cpInner, expect(literal(']'), ']'));
  const cpCurly = sequence(literal('{'), g.cpInner, expect(literal('}'), '}'));
  const cpValue = noTrivia(many(choice(cpOuterContent, g.cpParen, g.cpSquare, g.cpCurly, singleStr, doubleStr)));
  const CustomDeclaration = node('CustomDeclaration',
    parser({ trivia: rw }, sequence(choice(customPropInterp, customProp), literal(':'),
      choice(g.customCurlyBlock, g.customValue, g.cpValue),
      optional(literal(';')))),
    (c: any, r: any, s: any) => mk('CustomDeclaration', c, r, s));
  const anyDeclaration = choice(g.VarDeclaration, g.CustomDeclaration, g.Declaration);

  // ── Values (Less: + Reference, NamedColor, EscapedValue) ────────────────────
  // The value after a comma is optional so a trailing comma is tolerated
  // (`@items: a, b, c,;` — Less accepts it as a comma list with an empty tail).
  const valueList = parser({ trivia: rw }, sequence(g.valueSequence, many(sequence(literal(','), optional(g.valueSequence)))));
  const valueSequence = parser({ trivia: rw }, oneOrMore(g.value));
  // Interpolated value token (`@{colorVar}`, `pre-@{x}`). Chevrotain lexes this as
  // InterpolatedIdent and `processValueToken` runs it through getInterpolatedOrString
  // → Interpolated (role=ident). Ordered before Reference: `@{` cannot match lessVar,
  // and anyValueTok excludes `{`, so this is the only rule that accepts it.
  const InterpValue = node('InterpValue',
    parser({ trivia: rw }, interpKey),
    (c: any, r: any, s: any) => mk('InterpValue', c, r, s));
  const value = choice(g.InterpValue, g.Reference, g.Dimension, g.Num, g.Color, g.NamedColor, g.Url, g.CalcCall, g.Call, g.EscapedValue, g.Paren, g.SquareParen, g.Quoted, g.anyValue);
  const EscapedValue = node('EscapedValue',
    parser({ trivia: rw }, sequence(literal('~'), choice(g.Paren, g.Quoted))),
    (c: any, r: any, s: any) => mk('EscapedValue', c, r, s));
  const NamedColor = node('NamedColor', regex(/(?:lightgoldenrodyellow|mediumspringgreen|mediumaquamarine|mediumslateblue|mediumturquoise|mediumvioletred|blanchedalmond|cornflowerblue|darkolivegreen|lightslategray|lightslategrey|lightsteelblue|mediumseagreen|darkgoldenrod|darkslateblue|darkslategray|darkslategrey|darkturquoise|lavenderblush|lightseagreen|palegoldenrod|paleturquoise|palevioletred|rebeccapurple|antiquewhite|currentcolor|darkseagreen|lemonchiffon|lightskyblue|mediumorchid|mediumpurple|midnightblue|darkmagenta|deepskyblue|floralwhite|forestgreen|greenyellow|lightsalmon|lightyellow|navajowhite|saddlebrown|springgreen|transparent|yellowgreen|aquamarine|blueviolet|chartreuse|darkorange|darkorchid|darksalmon|darkviolet|dodgerblue|ghostwhite|lightcoral|lightgreen|mediumblue|papayawhip|powderblue|sandybrown|whitesmoke|aliceblue|burlywood|cadetblue|chocolate|darkgreen|darkkhaki|firebrick|gainsboro|goldenrod|indianred|lawngreen|lightblue|lightcyan|lightgray|lightgrey|lightpink|limegreen|mintcream|mistyrose|olivedrab|orangered|palegreen|peachpuff|rosybrown|royalblue|slateblue|slategray|slategrey|steelblue|turquoise|cornsilk|darkblue|darkcyan|darkgray|darkgrey|deeppink|honeydew|lavender|moccasin|seagreen|seashell|crimson|darkred|dimgray|dimgrey|fuchsia|hotpink|magenta|oldlace|skyblue|thistle|bisque|indigo|maroon|orange|orchid|purple|salmon|sienna|silver|tomato|violet|yellow|azure|beige|black|brown|coral|green|ivory|khaki|linen|olive|wheat|white|aqua|blue|cyan|gold|gray|grey|lime|navy|peru|pink|plum|snow|teal|red|tan)(?![-_a-zA-Z0-9])/i), (c: any, r: any, s: any) => mk('NamedColor', c, r, s));
  // unit collapsed to one regex (Dimension still reads number + unit as two leaves).
  // number + unit must be contiguous \u2014 the surrounding valueSequence runs with
  // trivia enabled, so without noTrivia() a space (`1 %`, `10 px`) would still be
  // glued into a Dimension. Chevrotain lexes those as Num + a separate token.
  const Dimension = node('Dimension', noTrivia(sequence(numPart, regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|%/))), (c: any, r: any, s: any) => mk('Dimension', c, r, s));
  // bare number; the not()-lookahead folded into the regex -> one match, one leaf.
  const Num = node('Num', regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)(?![a-zA-Z\u0080-\uffff%])/), (c: any, r: any, s: any) => mk('Num', c, r, s));
  const Color = node('Color', colorHex, (c: any, r: any, s: any) => mk('Color', c, r, s));
  const Url = node('Url', parser({ trivia: urlWs }, sequence(urlOpen, optional(choice(singleStr, doubleStr, urlInner)), literal(')'))), (c: any, r: any, s: any) => mk('Url', c, r, s));
  const parenBody = parser({ trivia: rw }, sequence(optional(sequence(g.valueList, many(sequence(literal(';'), optional(g.valueList))))), literal(')')));
  // A bare detached ruleset `{ … }` in value / function-argument position → a Mixin.
  const DetachedRuleset = node('DetachedRuleset', parser({ trivia: rw }, sequence(literal('{'), g.declarationList, literal('}'))), (c: any, r: any, s: any) => mk('DetachedRuleset', c, r, s));
  // Function-call arguments are their OWN production (parity with the Chevrotain
  // functionCallArgs/callArgument rules), NOT `parenBody`: unlike a parenthesized
  // value, a function argument may be an anonymous mixin `.(…){…}` or a bare
  // detached ruleset `{…}` — e.g. `each(@list, { … })`, `func({a:1}, {b:2})`. The
  // comma phase takes value SEQUENCES (comma is the arg separator); after a `;` the
  // args become value LISTS (comma allowed within an arg).
  const callArgSeq = choice(g.AnonymousMixinDefinition, DetachedRuleset, g.valueSequence);
  const callArgList = choice(g.AnonymousMixinDefinition, DetachedRuleset, g.valueList);
  const functionCallArgs = parser({ trivia: rw }, sequence(optional(sequence(sepBy(callArgSeq, literal(',')), many(sequence(literal(';'), optional(callArgList))))), literal(')')));
  // `calc(…)` follows the CSS math grammar, whose only operators are `+ - * /` — a
  // bare `%` operand (e.g. `calc(1 %)`) is a syntax error (Chevrotain: mathProduct
  // has no `%` alt, so the trailing `%` fails the closing `)`). We model calc as a
  // Call whose body excludes a standalone `%` token, so `1 %` leaves the `%`
  // unconsumed and the `)` fails → one parse error. A percentage glued to a number
  // (`100%`) is a Dimension and unaffected.
  const calcAnyTok = regex(/[+\-*/=<>|~^]+|[^\s;{}\[\]()'",!%]+/);
  const calcAnyValue = choice(ident, calcAnyTok);
  const calcValue = choice(g.InterpValue, g.Reference, g.Dimension, g.Num, g.Color, g.NamedColor, g.Url, g.Call, g.EscapedValue, g.Paren, g.SquareParen, g.Quoted, calcAnyValue);
  const calcSequence = parser({ trivia: rw }, oneOrMore(calcValue));
  const calcList = parser({ trivia: rw }, sequence(calcSequence, many(sequence(literal(','), calcSequence))));
  const calcBody = parser({ trivia: rw }, sequence(optional(sequence(calcList, many(sequence(literal(';'), optional(calcList))))), expect(literal(')'), ')')));
  const CalcCall = node('Call', parser({ trivia: rw }, sequence(regex(/calc(?=\()/i), literal('('), g.calcBody)), (c: any, r: any, s: any) => mk('Call', c, r, s));
  const Call = node('Call', parser({ trivia: rw }, sequence(ident, literal('('), functionCallArgs)), (c: any, r: any, s: any) => mk('Call', c, r, s));
  const Paren = node('Paren', parser({ trivia: rw }, sequence(literal('('), g.parenBody)), (c: any, r: any, s: any) => mk('Paren', c, r, s));
  const squareParenBody = parser({ trivia: rw }, sequence(optional(g.valueList), literal(']')));
  const SquareParen = node('SquareParen', parser({ trivia: rw }, sequence(literal('['), g.squareParenBody)), (c: any, r: any, s: any) => mk('SquareParen', c, r, s));
  const Quoted = node('Quoted', choice(singleStr, doubleStr), (c: any, r: any, s: any) => mk('Quoted', c, r, s));
  const anyValue = choice(ident, anyValueTok);

  // `each(<iterable>, { … })` (or `.(@p) { … }`) is a $for control form, not a
  // function call — parse it straight into a `For` node. The callback is a literal
  // detached ruleset / anonymous mixin; a bare `each(list)` with no block callback
  // falls through to a normal Call.
  // `each(<iterable>, { … })` builds a `For` directly (not a throwaway Call). Its
  // ARGUMENTS reuse the shared `functionCallArgs` — same args any function accepts,
  // so the iterable + detached-ruleset / `.(…){…}` callback parse uniformly. The
  // builder pulls the callback (a Mixin) out of the parsed args.
  const EachFor = node('For',
    parser({ trivia: rw }, sequence(
      regex(/each(?![-\w])/i), literal('('), functionCallArgs, optional(literal(';'))
    )),
    (c: any, r: any, s: any) => mk('For', c, r, s));

  // ── At-rules ───────────────────────────────────────────────────────────────
  const atPrelude = optional(scanTo(choice(literal('{'), literal(';')), { skip: [balanced('(', ')'), balanced('[', ']'), singleStr, doubleStr] }));

  // ── Structured, committed query block (@media / @container / @supports) ──────
  // The flat `atPrelude` above walks past ANY bracket content to the first
  // top-level `{`/`;`, so a stray/unbalanced bracket (`@media (extra: bracket))`)
  // is silently swallowed — 0 errors. This structured prelude mirrors the CSS
  // query grammar (grammar.ts QueryCondition/QueryInParens/QueryFeature): each
  // `(…)` is a real balanced group, so a top-level stray `)` is NOT consumed by
  // the prelude, and the committed `expect('{')` then fails ON that `)` → 1 error.
  // Because the query keyword IS consumed, this rule does not fall through to the
  // swallowing generic AtRuleBlock. Well-formed Less-specific preludes that this
  // structured shape can't parse (bare `@var`, `#ns.x[@k]`, `~"…"`, `@media
  // screen`) fail the prelude BEFORE the commit point, so the sequence backtracks
  // cleanly and the generic AtRuleBlock (→ `_buildAtRulePrelude`) handles them.
  // @see https://www.w3.org/TR/mediaqueries-5/#mq-syntax
  const mfComparison = regex(/<=|>=|[<>=]/);
  const QueryFeature = node('QueryFeature',
    parser({ trivia: rw }, sequence(ident, optional(choice(
      sequence(literal(':'), g.valueList),
      sequence(mfComparison, g.value, optional(sequence(mfComparison, g.value)))
    )))),
    (c: any, r: any, s: any) => mk('QueryFeature', c, r, s));
  const QueryInParens = node('QueryInParens',
    parser({ trivia: rw }, sequence(literal('('), choice(g.QueryCondition, g.QueryFeature), literal(')'))),
    (c: any, r: any, s: any) => mk('QueryInParens', c, r, s));
  const QueryCondition = node('QueryCondition',
    parser({ trivia: rw }, choice(
      sequence(regex(/not(?![-\w])/i), g.QueryInParens),
      sequence(g.QueryInParens, many(sequence(regex(/(?:and|or)(?![-\w])/i), g.QueryInParens)))
    )),
    (c: any, r: any, s: any) => mk('QueryCondition', c, r, s));
  // Optional leading container name — an ident that is NOT a query keyword.
  const containerName = regex(/(?!(?:not|and|or|only)(?![-\w]))-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*/i);
  const queryPrelude = parser({ trivia: rw }, sequence(optional(containerName), g.QueryCondition, many(sequence(literal(','), g.QueryCondition))));
  const queryAtKeyword = regex(/@(?:media|container|supports)(?![-\w])/i);
  const QueryAtRuleBlock = node('QueryAtRuleBlock',
    parser({ trivia: rw }, sequence(queryAtKeyword, queryPrelude, expect(literal('{'), '{'), g.atRuleBody, expect(literal('}'), '}'))),
    (c: any, r: any, s: any) => mk('QueryAtRuleBlock', c, r, s));

  const AtRuleBlock = node('AtRuleBlock',
    parser({ trivia: rw }, sequence(atKeyword, atPrelude, literal('{'), g.atRuleBody, expect(literal('}'), '}'))),
    (c: any, r: any, s: any) => mk('AtRuleBlock', c, r, s));

  // ── Structured, committed import statement (@import / @-import / @-export) ────
  // The flat `atPrelude` also swallows a bare ident before the path, so
  // `@import malformed "x.less";` is accepted with 0 errors. This rule requires,
  // right after the keyword and an optional `(options)` paren, a quoted string or
  // `url(...)` as the path — committed via `expect`. For `@import malformed "…"`,
  // the token after the keyword is the bare ident `malformed` (neither `(` nor
  // Quoted/Url), so the committed `expect(choice(Quoted, Url))` fails → 1 error.
  // Ordered before the generic AtRuleStatement; the existing
  // `_buildImportAtRuleFromPrelude` builder reconstructs the AST from source.
  const importKeyword = regex(/@(?:-import|-export|import)(?![-\w])/i);
  const importOptionsParen = sequence(literal('('), scanTo(literal(')'), { skip: [balanced('(', ')'), singleStr, doubleStr] }), literal(')'));
  const importMedia = scanTo(literal(';'), { skip: [balanced('(', ')'), balanced('[', ']'), singleStr, doubleStr] });
  const ImportAtRuleStatement = node('AtRuleStatement',
    parser({ trivia: rw }, sequence(
      importKeyword, optional(importOptionsParen),
      expect(choice(g.Url, g.Quoted), 'import path'),
      optional(importMedia), expect(literal(';'), ';')
    )),
    (c: any, r: any, s: any) => mk('AtRuleStatement', c, r, s));

  const AtRuleStatement = node('AtRuleStatement',
    parser({ trivia: rw }, sequence(atKeyword, atPrelude, literal(';'))),
    (c: any, r: any, s: any) => mk('AtRuleStatement', c, r, s));
  // An at-rule body (@media / @supports / @starting-style / …) holds the SAME
  // statements as a ruleset body — nested rules, mixin calls, each(), extends,
  // var calls — not just declarations. Mirror declarationList's choice set.
  const atRuleBody = parser({ trivia: rw }, many(choice(
    g.VarDeclaration, g.VarCall, g.QueryAtRuleBlock, g.AtRuleBlock, g.ImportAtRuleStatement, g.AtRuleStatement, g.ExtendStatement, g.Ruleset, NestedMixinDefinition, g.EachFor, g.MixinCall, g.Declaration, g.CustomDeclaration,
    sequence(g.Call, optional(literal(';'))), literal(';')
  )));

  return {
    Stylesheet, VarDeclaration, VarCall, Reference, MixinArgs, mixinNamePath, mixinCallBasicSel, mixinCallPath, MixinCall,
    AnonymousMixinDefinition, MixinOrQualifiedRule, Comparison, GuardDefault, GuardInParens, GuardTerm, GuardAnd, GuardOr, Guard,
    LessAmpersand, InterpolatedSelector, ExtendStatement, ExtendPseudo, ExtendTarget, extendCompound, extendComplex, simpleSelector,
    CompoundSelector, LessComplexSelector, LessSelectorList, AttributeSelector, PseudoSelector, pseudoArg, pseudoSelectorParens,
    Ruleset, declarationList, Declaration, customValue, customCurlyBlock, cpInner, cpParen, cpSquare, cpCurly, cpValue, CustomDeclaration, anyDeclaration,
    valueList, valueSequence, value, InterpValue, EscapedValue, NamedColor, Dimension, Num, Color, Url,
    parenBody, DetachedRuleset, functionCallArgs, squareParenBody, calcBody, CalcCall, Call, Paren, SquareParen, Quoted, anyValue, EachFor,
    QueryFeature, QueryInParens, QueryCondition, QueryAtRuleBlock, ImportAtRuleStatement,
    AtRuleBlock, AtRuleStatement, atRuleBody
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
  comparison: 'Comparison', guard: 'Guard', guardOr: 'GuardOr', guardAnd: 'GuardAnd',
  qualifiedRule: 'MixinOrQualifiedRule', mixinOrQualifiedRule: 'MixinOrQualifiedRule',
  mixinArgs: 'MixinArgs', anonymousMixinDefinition: 'AnonymousMixinDefinition'
};

export type LessFnParseResult = {
  tree: Rules;
  errors: JessError[];
  warnings: Array<{ message: string; deprecation?: string }>;
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
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') {
      i++;
      continue;
    }
    if (c === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2);
      if (end === -1) {
        return i;
      }
      i = end + 2;
      continue;
    }
    if (c === '/' && input[i + 1] === '/') {
      const nl = input.indexOf('\n', i + 2);
      if (nl === -1) {
        return null;
      }
      i = nl + 1;
      continue;
    }
    return i;
  }
  return null;
}

export function parseLessFn(input: string, rule = 'stylesheet', mathMode: MathMode = 'parens-division'): LessFnParseResult {
  host.setSource(input);
  host.mathMode = mathMode;
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

  // A single-node rule yields that node; a `many(...)` entry rule (e.g. an
  // `declarationList` fragment) yields an array — wrap it in a Rules so callers
  // get a `.rules` body rather than a bare Nil.
  const tree = (
    r.ok && r.value instanceof Node
      ? r.value
      : r.ok && Array.isArray(r.value)
        ? new Rules(r.value as Node[], undefined, undefined)
        : nil()
  ) as unknown as Rules;
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
  const errors: JessError[] = collected.length > 0
    ? [toParseError(collected[0]!.message, collected[0]!.offset, input)]
    : [];

  return { tree, errors, warnings: host.getWarnings(), trivia: buildLazyTriviaMap(triviaLog, input), lexerResult: { errors: [] } };
}

/** Functional Less parser — call .parse(text) to get a Jess AST. */
export class LessParser {
  private readonly _mathMode: MathMode;

  constructor(config?: { mathMode?: MathMode } & Record<string, unknown>) {
    this._mathMode = config?.mathMode ?? 'parens-division';
  }

  // Arrow field so `const parse = parser.parse` (used in tests) keeps `this`.
  parse = (text: string, rule = 'stylesheet'): LessFnParseResult => {
    // Inline JavaScript (backticks) was removed in v5 — report it as a normal
    // parse error at the backtick, NOT by throwing (a parser must not throw).
    const backtick = text.indexOf('`');
    if (backtick !== -1) {
      return {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        tree: nil() as unknown as Rules,
        errors: [toParseError('Inline JavaScript using backticks is not supported. Use @use / @-use to import a script module instead.', backtick, text)],
        warnings: [],
        trivia: buildLazyTriviaMap([], text),
        lexerResult: { errors: [] }
      };
    }
    return parseLessFn(text, rule, this._mathMode);
  };
}
