/**
 * Functional CSS grammar — the macro-compiled counterpart to the class-based
 * CssParser. Combinators are imported `with { type: 'macro' }`, so the parseman
 * plugin compiles the whole grammar (CST capture + node construction) to flat JS
 * at build time; without the plugin the interpreter runs the identical tree.
 *
 * Each capital rule is a `node(type, parser, build)`: parseman captures the
 * rule's terminals and the trivia between them into `children` / `rawChildren`
 * (the library owns capture — no hand-wrapped terminals, no trivia
 * reconstruction), then calls `build` to produce the Jess AST node. `build`
 * delegates to the existing CssParser builders via a thin host, so node
 * construction and span/trivia fidelity are reused verbatim.
 */
import {
  node, regex, literal, sequence, choice, many, oneOrMore, optional,
  not, scanTo, balanced, parser, trivia, rules, expect
} from 'parseman' with { type: 'macro' };
import type { Span } from 'parseman';
import { Node, type TriviaMap, nil } from '@jesscss/core';
import { CssParser, buildLazyTriviaMap } from './builders.js';

// ---------------------------------------------------------------------------
// Builder host — reuse CssParser's builders without re-implementing them.
// (The only bridge to the class; it disappears once builders are free functions.)
// ---------------------------------------------------------------------------

class BuilderHost extends CssParser {
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

/**
 * node() build hook: dispatch to the CssParser builder for `type`. Returns the
 * Jess node, or the raw value for a builder that collapses to a bare string
 * (e.g. a single-item selector) — node() records the latter as a spanned leaf
 * for the parent, matching the class CST behaviour.
 */
export function mk(type: string, children: ReadonlyArray<unknown>, rawChildren: ReadonlyArray<unknown>, span: { start: number; end: number }): unknown {
  return host.build(type, { start: span.start, end: span.end }, children, rawChildren);
}

// ---------------------------------------------------------------------------
// Trivia + terminals — bare combinators; node() captures them automatically.
// ---------------------------------------------------------------------------

const ws = regex(/[ \t\n\r\f]+/);
const comment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const rw = trivia(oneOrMore(choice(ws, comment)));

/**
 * CSS identifier. Starts with an ident-start code point (letter, non-ASCII, `_`),
 * optionally preceded by `-`; subsequent chars add digits and `-`.
 * Includes CSS escapes (\\hex / \\char).
 * @see https://www.w3.org/TR/css-syntax-3/#ident-start-code-point
 * @see https://www.w3.org/TR/css-syntax-3/#ident-code-point
 */
const ident = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))*/);
const basicSel = regex(/(?:[.#]?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))*|\d+(?:\.\d+)?%|\*)/);
const combinator = choice(literal('||'), literal('>'), literal('+'), literal('~'), literal('|'));
const pseudoColon = regex(/::?/);
const attrOp = regex(/[*~|^$]?=/);
const attrMod = regex(/[is]/i);
const nth = regex(/even|odd|[-+]?\d*n(?:[ \t\n\r\f]*[+-][ \t\n\r\f]*\d+)?|[-+]?\d+/i);
const singleStr = regex(/'(?:[^'\\]|\\.)*'/);
const doubleStr = regex(/"(?:[^"\\]|\\.)*"/);
const customProp = regex(/--[-_a-zA-Z0-9\u0080-\uffff]*/);
const atKeyword = regex(/@-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const numPart = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)/);
const colorHex = regex(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/);
const urlOpen = regex(/url\(/i);
const urlInner = regex(/[^)"'\s]+/);
const anyValueTok = regex(/[+\-*/=<>|~^]+|[^\s;{}\[\]()'",!]+/);

// ---------------------------------------------------------------------------
// Grammar — mirrors the class CssParser rules (node() → AST node, plain
// combinator → its terminals bubble into the nearest enclosing node()).
// ---------------------------------------------------------------------------

export const {
  Stylesheet, Ruleset, SelectorList, ComplexSelector, CompoundSelector,
  AttributeSelector, PseudoSelector, Declaration, CustomDeclaration,
  Dimension, Num, Color, Url, Call, Paren, Quoted, AtRuleBlock, AtRuleStatement
} = rules((g: any) => {
  // ── Root ──────────────────────────────────────────────────────────────────
  // No catch-all arm: a run of input that matches no rule simply stops `many`,
  // leaving unconsumed input the driver reports as one syntax error. Required
  // closers below are wrapped in expect() so a missing one is reported (and
  // recovered) by parseman rather than aborting the whole parse.
  const Stylesheet = node('Stylesheet',
    parser({ trivia: rw }, many(choice(g.QueryAtRuleBlock, g.AtRuleBlock, g.AtRuleStatement, g.UnknownAtRuleBlock, g.Ruleset))),
    (c: any, r: any, s: any) => mk('Stylesheet', c, r, s));

  // ── Rulesets ───────────────────────────────────────────────────────────────
  const Ruleset = node('Ruleset',
    parser({ trivia: rw }, sequence(g.SelectorList, literal('{'), g.declarationList, expect(literal('}'), '}'))),
    (c: any, r: any, s: any) => mk('Ruleset', c, r, s));

  // ── Selectors ──────────────────────────────────────────────────────────────
  const SelectorList = node('SelectorList',
    parser({ trivia: rw }, sequence(g.ComplexSelector, many(sequence(literal(','), g.ComplexSelector)))),
    (c: any, r: any, s: any) => mk('SelectorList', c, r, s));
  const ComplexSelector = node('ComplexSelector',
    parser({ trivia: rw }, sequence(g.CompoundSelector, many(sequence(optional(combinator), g.CompoundSelector)))),
    (c: any, r: any, s: any) => mk('ComplexSelector', c, r, s));
  const CompoundSelector = node('CompoundSelector',
    parser({ trivia: rw }, oneOrMore(g.simpleSelector)),
    (c: any, r: any, s: any) => mk('CompoundSelector', c, r, s));
  /**
   * `&` is the CSS nesting selector (the parent reference).
   * @see https://www.w3.org/TR/css-nesting-1/#nest-selector
   */
  const simpleSelector = choice(g.AttributeSelector, g.PseudoSelector, literal('&'), basicSel);

  const AttributeSelector = node('AttributeSelector',
    parser({ trivia: rw }, sequence(
      literal('['), ident,
      optional(sequence(attrOp, choice(singleStr, doubleStr, ident), optional(attrMod))),
      literal(']')
    )),
    (c: any, r: any, s: any) => mk('AttributeSelector', c, r, s));
  const PseudoSelector = node('PseudoSelector',
    parser({ trivia: rw }, sequence(pseudoColon, ident, optional(sequence(literal('('), g.pseudoArg, literal(')'))))),
    (c: any, r: any, s: any) => mk('PseudoSelector', c, r, s));
  // `:nth-child(An+B of S)` — the `of <selector-list>` form. Without consuming the
  // `of S`, `nth` would match just `An+B` and the choice would commit, leaving the
  // outer `)` to fail. The last arm scans to `)` for arbitrary args, skipping
  // balanced ()/[], strings, and comments so an inner `)` doesn't close it early.
  // @see https://www.w3.org/TR/selectors-4/#the-nth-child-pseudo
  const pseudoArg = choice(
    sequence(nth, optional(sequence(regex(/of(?![-\w])/i), g.SelectorList))),
    g.SelectorList,
    scanTo(literal(')'), { skip: [balanced('(', ')'), balanced('[', ']'), singleStr, doubleStr, comment] })
  );

  // ── Declarations ─────────────────────────────────────────────────────────
  /**
   * A rule body. With CSS Nesting it interleaves declarations with nested
   * rulesets and nested at-rules, not just declarations.
   * @see https://www.w3.org/TR/css-nesting-1/#syntax
   */
  const declarationList = parser({ trivia: rw }, many(choice(
    g.QueryAtRuleBlock, g.AtRuleBlock, g.AtRuleStatement, g.UnknownAtRuleBlock, g.Declaration, g.CustomDeclaration, g.Ruleset, literal(";")
  )));

  /**
   * `!important`. Keyword is ASCII case-insensitive; trivia between `!` and the
   * keyword is allowed (enclosing parser({ trivia }) skips it).
   * @see https://www.w3.org/TR/css-cascade-4/#importance
   */
  const important = sequence(literal('!'), regex(/important/i));

  /**
   * Property name. Standard names are idents; we also accept a leading `*` for the
   * legacy IE7 star-hack (`*color: …`). `*` is NOT an ident-start code point and
   * "would not start an identifier", so it is genuinely non-conformant — valid only
   * as a hack. (`_prop`, the IE6 underscore hack, is just an ordinary ident: `_` IS
   * an ident-start code point, so no special handling.) When legacyMode lands, an
   * `off` setting should report-and-recover on `*`, not silently accept.
   * @see https://www.w3.org/TR/css-syntax-3/#would-start-an-identifier
   * @see https://www.w3.org/TR/css-syntax-3/#ident-start-code-point
   */
  const propName = regex(/\*?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))*/);
  const Declaration = node('Declaration',
    parser({ trivia: rw }, sequence(propName, literal(':'), g.valueList, optional(important), optional(literal(';')))),
    (c: any, r: any, s: any) => mk('Declaration', c, r, s));
  /**
   * Custom property (`--foo: …`). Its value is a near-arbitrary declaration-value
   * token stream with balanced (), [], {} — scanned to the terminating `;`/`}`,
   * skipping balanced groups intact (parseman balanced() counts nested-pair depth).
   * @see https://www.w3.org/TR/css-variables-1/#defining-variables
   */
  const CustomDeclaration = node('CustomDeclaration',
    parser({ trivia: rw }, sequence(
      customProp, literal(':'),
      scanTo(choice(literal(';'), literal('}')), { skip: [balanced('(', ')'), balanced('[', ']'), balanced('{', '}')] }),
      optional(literal(';'))
    )),
    (c: any, r: any, s: any) => mk('CustomDeclaration', c, r, s));

  // ── Values ───────────────────────────────────────────────────────────────
  const valueList = parser({ trivia: rw }, sequence(g.valueSequence, many(sequence(literal(','), g.valueSequence))));
  const valueSequence = parser({ trivia: rw }, oneOrMore(g.value));
  const value = choice(g.Dimension, g.Num, g.Color, g.Url, g.Call, g.Paren, g.Quoted, g.anyValue);

  // unit collapsed to one regex (Dimension still reads number + unit as two leaves).
  const Dimension = node('Dimension', sequence(numPart, regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|%/)), (c: any, r: any, s: any) => mk('Dimension', c, r, s));
  // bare number; not()-lookahead folded into the regex -> one match, one leaf.
  const Num = node('Num', regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)(?![a-zA-Z\u0080-\uffff%])/), (c: any, r: any, s: any) => mk('Num', c, r, s));
  const Color = node('Color', colorHex, (c: any, r: any, s: any) => mk('Color', c, r, s));
  const Url = node('Url',
    parser({ trivia: rw }, sequence(urlOpen, optional(choice(singleStr, doubleStr, urlInner)), literal(')'))),
    (c: any, r: any, s: any) => mk('Url', c, r, s));
  const parenBody = parser({ trivia: rw }, sequence(optional(g.valueList), literal(')')));
  // Call OR bare ident, parsing the ident exactly once: take the call-args tail
  // only when '(' follows. _buildCall returns a Call node when args are present,
  // otherwise the bare ident string (bubbling identically to the old anyValue
  // ident arm). This removes the per-bare-ident "parse ident, backtrack on '('".
  const Call = node('Call', parser({ trivia: rw }, sequence(ident, optional(sequence(literal('('), g.parenBody)))), (c: any, r: any, s: any) => mk('Call', c, r, s));
  const Paren = node('Paren', parser({ trivia: rw }, sequence(literal('('), g.parenBody)), (c: any, r: any, s: any) => mk('Paren', c, r, s));
  const Quoted = node('Quoted', choice(singleStr, doubleStr), (c: any, r: any, s: any) => mk('Quoted', c, r, s));
  // Non-ident value tokens only; ident-led values are handled by Call above.
  const anyValue = anyValueTok;

  // ── At-rule query preludes (@media / @container / @supports) ────────────────
  // Logic reference: productions/atRules.ts (the Chevrotain parser). Node shapes
  // are improved: a comparison feature is QueryCondition(['name','op', value]) —
  // plain strings for name+operator, a real node for the value; not/and/or stay
  // Keyword nodes; `(X)` is Paren(X); `name: value` is a Declaration.
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
  // Optional leading container name — an ident that is NOT a query keyword
  // (not/and/or/only), so `@container not (…)` keeps `not` in the condition.
  const containerName = regex(/(?!(?:not|and|or|only)(?![-\w]))-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/i);
  const queryPrelude = parser({ trivia: rw }, sequence(optional(containerName), g.QueryCondition, many(sequence(literal(','), g.QueryCondition))));
  const queryAtKeyword = regex(/@(?:media|container|supports)(?![-\w])/i);
  const QueryAtRuleBlock = node('QueryAtRuleBlock',
    parser({ trivia: rw }, sequence(queryAtKeyword, queryPrelude, literal('{'), g.atRuleBody, expect(literal('}'), '}'))),
    (c: any, r: any, s: any) => mk('QueryAtRuleBlock', c, r, s));

  // ── At-rules ───────────────────────────────────────────────────────────────
  /**
   * An at-rule is `@name <prelude>` ended by either a `{}` block or a `;`. The
   * prelude is scanned up to the `{`/`;`, skipping balanced ()/[] and strings.
   * @see https://www.w3.org/TR/css-syntax-3/#consume-at-rule
   */
  const atPrelude = optional(scanTo(choice(literal('{'), literal(';')), {
    skip: [balanced('(', ')'), balanced('[', ']'), singleStr, doubleStr]
  }));
  // Known block at-rules (besides the @media/@container/@supports queries) get a
  // STRUCTURED body — garbage inside is a real error. Unknown at-rules have an
  // OPAQUE block (the UA owns its meaning), so their body is scanned over and
  // never errors. @see https://www.w3.org/TR/css-syntax-3/#consume-at-rule
  // media/container/supports are included so a non-paren-query prelude
  // (`@media screen { … }`) still gets a structured (erroring) body rather than
  // falling through to the opaque unknown-at-rule rule.
  const knownBlockAtKeyword = regex(/@(?:media|container|supports|layer|scope|page|font-face|font-feature-values|counter-style|property|(?:-[a-z]+-)?keyframes|document|color-profile|font-palette-values|position-try|starting-style)(?![-\w])/i);
  const AtRuleBlock = node('AtRuleBlock',
    parser({ trivia: rw }, sequence(knownBlockAtKeyword, atPrelude, literal('{'), g.atRuleBody, expect(literal('}'), '}'))),
    (c: any, r: any, s: any) => mk('AtRuleBlock', c, r, s));
  const opaqueAtBody = scanTo(literal('}'), { skip: [balanced('{', '}'), singleStr, doubleStr, comment] });
  const UnknownAtRuleBlock = node('UnknownAtRuleBlock',
    parser({ trivia: rw }, sequence(atKeyword, atPrelude, literal('{'), opaqueAtBody, literal('}'))),
    (c: any, r: any, s: any) => mk('UnknownAtRuleBlock', c, r, s));
  const AtRuleStatement = node('AtRuleStatement',
    parser({ trivia: rw }, sequence(atKeyword, atPrelude, literal(';'))),
    (c: any, r: any, s: any) => mk('AtRuleStatement', c, r, s));
  // Body of a known at-rule block. No catch-all: unparseable content stops `many`,
  // and the block's expect('}') reports a syntax error at that point.
  const atRuleBody = parser({ trivia: rw }, many(choice(
    g.QueryAtRuleBlock, g.AtRuleBlock, g.AtRuleStatement, g.UnknownAtRuleBlock, g.Ruleset, g.Declaration, g.CustomDeclaration, literal(";")
  )));

  return {
    Stylesheet, Ruleset, SelectorList, ComplexSelector, CompoundSelector, simpleSelector,
    AttributeSelector, PseudoSelector, pseudoArg,
    Declaration, CustomDeclaration, declarationList,
    valueList, valueSequence, value, parenBody,
    Dimension, Num, Color, Url, Call, Paren, Quoted, anyValue,
    AtRuleBlock, AtRuleStatement, atRuleBody,
    QueryAtRuleBlock, QueryCondition, QueryInParens, QueryFeature, UnknownAtRuleBlock
  };
});

// ---------------------------------------------------------------------------
// Public parse — same shape as CssParser.parse (tree + errors + warnings + trivia).
// ---------------------------------------------------------------------------

export type CssParseResult = {
  tree: Node;
  errors: Array<{ message: string; offset?: number }>;
  warnings: Array<{ message: string }>;
  trivia: TriviaMap;
};

/**
 * First offset at/after `from` holding real (non-trivia) input, or null if only
 * whitespace/comments remain. Used to detect input the grammar could not consume
 * — a syntax error the parser stopped short on. Mirrors the css `rw` trivia.
 */
function firstUnparsedOffset(input: string, from: number): number | null {
  let i = from;
  while (i < input.length) {
    const c = input[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') { i++; continue; }
    if (c === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2);
      if (end === -1) return i;        // unterminated comment is itself an error
      i = end + 2; continue;
    }
    return i;
  }
  return null;
}

export function parseCssFn(input: string): CssParseResult {
  host.setSource(input);
  host.resetWarnings();

  const triviaLog: number[] = [];

  // Macro build → Stylesheet is a compiled fn; interpreter → a Combinator.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const sheet = Stylesheet as unknown as
    | ((i: string, p: number, c: any) => any)
    | { parse(i: string, p: number, c: any): any };
  // _errors collects parseman's recover()/expect() ParseErrors (e.g. a missing
  // closing brace) rather than the old hand-rolled BadStatement net.
  const parseErrors: Array<{ span: { start: number }; expected: string[] }> = [];
  const ctx = { trackLines: false, _triviaLog: triviaLog, _errors: parseErrors };
  const r = typeof sheet === 'function'
    ? sheet(input, 0, ctx)
    : sheet.parse(input, 0, ctx);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const tree: Node = r.ok && r.value instanceof Node ? r.value : (nil() as unknown as Node);

  // Three diagnostic sources, all position-tagged: a required token expect()
  // missed, a hard top-level failure, and input the grammar stopped short of.
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
  // Default: report ONE error and stop — the earliest by position.
  collected.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
  const errors = collected.length > 0 ? [collected[0]!] : [];

  return {
    tree,
    errors,
    warnings: host.getWarnings(),
    trivia: buildLazyTriviaMap(triviaLog, input)
  };
}
