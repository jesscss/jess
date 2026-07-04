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
import { Node, Rules, type TriviaMap, nil, makeJessError, type JessError } from '@jesscss/core';
import { CssParser, buildLazyTriviaMap } from './builders.js';
// Shared rules (Num/Color, value-position Paren/calc(), and the @media/@container/
// @supports condition sub-grammar), spread into the map below. Imported from another
// module, so the macro inlines them via tier-2 (imported-fragment) source resolution.
import { numericRules, parenRules, queryRules, stringRules } from './shared-value-rules.js';

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
export function build(type: string, children: ReadonlyArray<unknown>, rawChildren: ReadonlyArray<unknown>, span: { start: number; end: number }): unknown {
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
// Same pattern as shared-value-rules.ts `singleStr`/`doubleStr` — local so the macro
// can statically evaluate regex(); `\\` + newline is valid CSS line continuation.
const singleStr = regex(/'(?:[^'\\]|\\[\s\S])*'/);
const doubleStr = regex(/"(?:[^"\\]|\\[\s\S])*"/);
const customProp = regex(/--[-_a-zA-Z0-9\u0080-\uffff]*/);
const atKeyword = regex(/@-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const numPart = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)/);
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
    (c: any, r: any, s: any) => build('Stylesheet', c, r, s));

  // ── Rulesets ───────────────────────────────────────────────────────────────
  const Ruleset = node('Ruleset',
    parser({ trivia: rw }, sequence(g.SelectorList, literal('{'), g.declarationList, expect(literal('}'), '}'))),
    (c: any, r: any, s: any) => build('Ruleset', c, r, s));

  // ── Selectors ──────────────────────────────────────────────────────────────
  const SelectorList = node('SelectorList',
    parser({ trivia: rw }, sequence(g.ComplexSelector, many(sequence(literal(','), g.ComplexSelector)))),
    (c: any, r: any, s: any) => build('SelectorList', c, r, s));
  const ComplexSelector = node('ComplexSelector',
    parser({ trivia: rw }, sequence(g.CompoundSelector, many(sequence(optional(combinator), g.CompoundSelector)))),
    (c: any, r: any, s: any) => build('ComplexSelector', c, r, s));
  const CompoundSelector = node('CompoundSelector',
    parser({ trivia: rw }, oneOrMore(g.simpleSelector)),
    (c: any, r: any, s: any) => build('CompoundSelector', c, r, s));
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
    (c: any, r: any, s: any) => build('AttributeSelector', c, r, s));
  const PseudoSelector = node('PseudoSelector',
    parser({ trivia: rw }, sequence(pseudoColon, ident, optional(sequence(literal('('), g.pseudoArg, literal(')'))))),
    (c: any, r: any, s: any) => build('PseudoSelector', c, r, s));
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
    g.QueryAtRuleBlock, g.AtRuleBlock, g.AtRuleStatement, g.UnknownAtRuleBlock, g.Declaration, g.CustomDeclaration, g.Ruleset, literal(';')
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
    (c: any, r: any, s: any) => build('Declaration', c, r, s));
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
    (c: any, r: any, s: any) => build('CustomDeclaration', c, r, s));

  // ── Values ───────────────────────────────────────────────────────────────
  const valueList = parser({ trivia: rw }, sequence(g.valueSequence, many(sequence(literal(','), g.valueSequence))));
  const valueSequence = parser({ trivia: rw }, oneOrMore(g.value));
  const value = choice(g.Dimension, g.Num, g.Color, g.Url, g.CalcCall, g.Call, g.Paren, g.Quoted, g.anyValue);
  // ── Math expressions ───────────────────────────────────────────────────────
  // CSS does arithmetic ONLY inside `calc()` (and the parens nested in it), so these
  // rules are reached only via `CalcCall` and the calc-nested `calcParen`, never the
  // top-level `valueSequence` NOR the general bare `Paren` (which stays permissive —
  // a bare `(pixelradius=2)` in a legacy IE `filter` is not math). Precedence lives
  // in the grammar (`* / %` over `+ -`, left-assoc); `collapse` passes a single
  // operand through, and the build folds the flat children into Operation nodes (see
  // _buildOperation). `/` divides here (calc is a math context).
  const prodOp = regex(/[*\/%]/);
  // `+`/`-` operator: standalone (space/non-number after) OR glued with no space
  // before (`1+2`). `1 +2` (space before, glued) is a separate signed operand.
  const sumOp = regex(/[-+](?![0-9.])|(?<=\S)[-+](?=[0-9.])/);
  // A math operand is a value whose nested parens fold (calcParen), unlike the
  // general permissive `Paren`. Everything else matches the ordinary value set.
  const calcParen = node('Paren', parser({ trivia: rw }, sequence(literal('('), g.mathSum, expect(literal(')'), ')'))), (c: any, r: any, s: any) => build('Paren', c, r, s));
  const calcValue = choice(g.Dimension, g.Num, g.Color, g.Url, g.CalcCall, g.Call, calcParen, g.Quoted, g.anyValue);
  const mathProduct = node('Operation',
    parser({ trivia: rw }, sequence(calcValue, many(sequence(prodOp, calcValue)))),
    (c: any, r: any, s: any) => build('Operation', c, r, s), { collapse: true });
  const mathSum = node('Operation',
    parser({ trivia: rw }, sequence(g.mathProduct, many(sequence(sumOp, g.mathProduct)))),
    (c: any, r: any, s: any) => build('Operation', c, r, s), { collapse: true });

  // unit collapsed to one regex (Dimension still reads number + unit as two leaves).
  const Dimension = node('Dimension', sequence(numPart, regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|%/)), (c: any, r: any, s: any) => build('Dimension', c, r, s));
  // `Num` and `Color` now come from the shared `numericRules` fragment, spread into
  // the return object below (identical to the Less grammar's definitions).
  const Url = node('Url',
    parser({ trivia: rw }, sequence(urlOpen, optional(choice(singleStr, doubleStr, urlInner)), literal(')'))),
    (c: any, r: any, s: any) => build('Url', c, r, s));
  // Generic function-call args stay a PERMISSIVE value list — `rgb(255 0 0)`,
  // `min(1px, 2px)` are space / comma lists, not math expressions.
  const parenBody = parser({ trivia: rw }, sequence(optional(g.valueList), literal(')')));
  // Call OR bare ident, parsing the ident exactly once: take the call-args tail
  // only when '(' follows. _buildCall returns a Call node when args are present,
  // otherwise the bare ident string (bubbling identically to the old anyValue
  // ident arm). This removes the per-bare-ident "parse ident, backtrack on '('".
  const Call = node('Call', parser({ trivia: rw }, sequence(ident, optional(sequence(literal('('), g.parenBody)))), (c: any, r: any, s: any) => build('Call', c, r, s));
  // `calc(…)` body is ONE math expression (folded in the grammar) — the only place
  // plain CSS folds operators. Matched before the generic `Call` so `calc(` routes
  // here; other math functions (min/max/clamp) stay generic Calls with list args.
  const calcBody = parser({ trivia: rw }, sequence(g.mathSum, expect(literal(')'), ')')));
  // `CalcCall` (calc(…)) and the general value-position `Paren` come from the shared
  // `parenRules` fragment (spread below) — they defer to g.calcBody / g.parenBody here.
  // `Quoted` likewise comes from the `stringRules` fragment.
  // Non-ident value tokens only; ident-led values are handled by Call above.
  const anyValue = anyValueTok;

  // ── At-rule query preludes (@media / @container / @supports) ────────────────
  // The condition sub-grammar (QueryFeature / QueryInParens / QueryCondition /
  // queryPrelude) comes from the shared `queryRules` fragment (spread below) — it is
  // identical across css & less. Only the block wrapper differs, so it stays here and
  // reads `g.queryPrelude` from the fragment.
  // @see https://www.w3.org/TR/mediaqueries-5/#mq-syntax
  const queryAtKeyword = regex(/@(?:media|container|supports)(?![-\w])/i);
  const QueryAtRuleBlock = node('QueryAtRuleBlock',
    parser({ trivia: rw }, sequence(queryAtKeyword, g.queryPrelude, literal('{'), g.atRuleBody, expect(literal('}'), '}'))),
    (c: any, r: any, s: any) => build('QueryAtRuleBlock', c, r, s));

  // ── At-rules ───────────────────────────────────────────────────────────────
  /**
   * An at-rule is `@name <prelude>` ended by either a `{}` block or a `;`. The
   * prelude is scanned up to the `{`/`;`, skipping balanced ()/[] and strings.
   * @see https://www.w3.org/TR/css-syntax-3/#consume-at-rule
   */
  // Stop the scan at the START of any trailing trivia run before the `{`/`;`,
  // not at the delimiter itself — otherwise a trailing comment (`… hover /* x */
  // {`) is swallowed into the prelude leaf instead of staying trivia. The
  // enclosing parser({ trivia: rw }) then consumes that run for real and logs
  // it, so `prelude.valueOf()` is the bare prelude and the comment is recoverable
  // via the trivia map (matches the reference's token-based prelude).
  const atTailTrivia = many(choice(ws, comment));
  const atPrelude = optional(scanTo(sequence(atTailTrivia, choice(literal('{'), literal(';'))), {
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
    (c: any, r: any, s: any) => build('AtRuleBlock', c, r, s));
  const opaqueAtBody = scanTo(literal('}'), { skip: [balanced('{', '}'), singleStr, doubleStr, comment] });
  const UnknownAtRuleBlock = node('UnknownAtRuleBlock',
    parser({ trivia: rw }, sequence(atKeyword, atPrelude, literal('{'), opaqueAtBody, literal('}'))),
    (c: any, r: any, s: any) => build('UnknownAtRuleBlock', c, r, s));
  const AtRuleStatement = node('AtRuleStatement',
    parser({ trivia: rw }, sequence(atKeyword, atPrelude, literal(';'))),
    (c: any, r: any, s: any) => build('AtRuleStatement', c, r, s));
  // Body of a known at-rule block. No catch-all: unparseable content stops `many`,
  // and the block's expect('}') reports a syntax error at that point.
  const atRuleBody = parser({ trivia: rw }, many(choice(
    g.QueryAtRuleBlock, g.AtRuleBlock, g.AtRuleStatement, g.UnknownAtRuleBlock, g.Ruleset, g.Declaration, g.CustomDeclaration, literal(';')
  )));

  return {
    ...stringRules(g, { build }),
    ...numericRules(g, { build }),
    ...parenRules(g, { build }),
    ...queryRules(g, { build }),
    rw,
    Stylesheet, Ruleset, SelectorList, ComplexSelector, CompoundSelector, simpleSelector,
    AttributeSelector, PseudoSelector, pseudoArg,
    Declaration, CustomDeclaration, declarationList,
    valueList, valueSequence, value, parenBody, mathProduct, mathSum, calcBody,
    Dimension, Url, Call, anyValue,
    AtRuleBlock, AtRuleStatement, atRuleBody,
    QueryAtRuleBlock, UnknownAtRuleBlock
  };
});

// ---------------------------------------------------------------------------
// Public parse — same shape as CssParser.parse (tree + errors + warnings + trivia).
// ---------------------------------------------------------------------------

export type CssParseResult = {
  tree: Rules;
  errors: JessError[];
  warnings: Array<{ message: string; deprecation?: string }>;
  trivia: TriviaMap;
};

/**
 * Convert a raw furthest-fail diagnostic (`{ message, offset }`) into the typed
 * `JessError` every parser must emit — carrying line/column (1-based, derived
 * from `source` + `offset`), the source, and a `parse/syntax-error` code. Shared
 * by the css and less functional parsers so their `errors` output is identical in
 * shape. `offset` is preserved on the instance for callers that still want it.
 */
export function toParseError(message: string, offset: number | undefined, source: string, filePath?: string): JessError {
  let line = 1;
  let column = 1;
  if (typeof offset === 'number') {
    const clamped = offset < 0 ? 0 : (offset > source.length ? source.length : offset);
    // Offset → line/column. Runs at most ONCE per parse (only on error, never on a
    // clean parse), so no precomputed line index is worth building. A single forward
    // pass over `String.indexOf('\n')` — V8 vectorizes it (SIMD), far cheaper than a
    // JS-level charCodeAt loop — yields BOTH the line count and the last newline
    // before the offset (→ column), reading each newline once and stopping at offset.
    let lastNl = -1;
    for (let i = source.indexOf('\n'); i !== -1 && i < clamped; i = source.indexOf('\n', i + 1)) {
      line++;
      lastNl = i;
    }
    column = clamped - lastNl; // lastNl === -1 (line 1) → column = clamped + 1
  }
  const err = makeJessError({ code: 'parse/syntax-error', phase: 'parse', source, filePath, line, column, summary: message });
  (err as JessError & { offset?: number }).offset = offset;
  return err;
}

/**
 * First offset at/after `from` holding real (non-trivia) input, or null if only
 * trivia remains. Used to detect input the grammar could not consume — a syntax
 * error the parser stopped short on. Always skips whitespace + block comments;
 * `lineComments` additionally skips `//` line comments (Less/SCSS/Jess trivia;
 * CSS has none, so a trailing `//…` is real leftover there).
 */
function firstUnparsedOffset(input: string, from: number, lineComments = false): number | null {
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
        return i; // unterminated comment is itself an error
      }
      i = end + 2;
      continue;
    }
    if (lineComments && c === '/' && input[i + 1] === '/') {
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

/**
 * Minimal builder-host contract the functional parse driver needs. Every
 * functional grammar (css/less/scss/jess) defines a `BuilderHost` that reuses
 * its class builders and satisfies this shape.
 */
export interface FunctionalParseHost {
  setSource(src: string): void;
  resetWarnings(): void;
  getWarnings(): Array<{ message: string; deprecation?: string }>;
  getErrors(): Array<{ message: string; offset?: number }>;
}

export interface RunFunctionalParseOptions {
  /**
   * Treat `//` as a line comment when scanning for unconsumed input. Less/SCSS/
   * Jess add `//` to their trivia; CSS does not (a trailing `//…` is leftover).
   */
  lineComments?: boolean;
}

/**
 * Shared functional-parse driver. Runs a resolved entry rule against `input`,
 * shapes the result into a `Rules` tree, and collapses parseman's furthest-fail
 * diagnostics + any unconsumed input + host-recorded errors into a single
 * earliest-position `JessError` (report one, stop). Reused by every functional
 * grammar so their `{ tree, errors, warnings, trivia }` output is identical in
 * shape and semantics — the only per-language knob is `lineComments`.
 *
 * `entry` is the macro-compiled function or interpreted Combinator for the rule.
 */
export function runFunctionalParse(
  input: string,
  entry: unknown,
  host: FunctionalParseHost,
  options: RunFunctionalParseOptions = {}
): CssParseResult {
  host.setSource(input);
  host.resetWarnings();

  const triviaLog: number[] = [];
  // _errors collects parseman's recover()/expect() ParseErrors (e.g. a missing
  // closing brace) rather than the old hand-rolled BadStatement net.
  const parseErrors: Array<{ span: { start: number }; expected: string[] }> = [];
  const ctx = { trackLines: false, _triviaLog: triviaLog, _errors: parseErrors };
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
  const r = typeof entry === 'function'
    ? (entry as (i: string, p: number, c: any) => any)(input, 0, ctx)
    : (entry as { parse(i: string, p: number, c: any): any }).parse(input, 0, ctx);

  // A single-node rule yields that node; a `many(...)` entry rule (e.g. a
  // declarationList fragment) yields an array — wrap it in a Rules so callers
  // get a `.rules` body rather than a bare Nil.
  const tree = (
    r.ok && r.value instanceof Node
      ? r.value
      : r.ok && Array.isArray(r.value)
        ? new Rules(r.value as Node[], undefined, undefined)
        : nil()
  ) as unknown as Rules;
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */

  // Diagnostic sources, all position-tagged: a required token expect() missed,
  // a hard top-level failure, input the grammar stopped short of, and any error
  // the host builders recorded.
  const collected: Array<{ message: string; offset?: number }> = [];
  for (const e of parseErrors) {
    const exp = e.expected.filter(x => x !== 'sentinel');
    collected.push({ message: exp.length ? `expected ${exp.join(', ')}` : 'Unexpected input', offset: e.span.start });
  }
  if (!r.ok) {
    collected.push({ message: (r.expected ?? []).join(', ') || 'Parse error', offset: r.span?.start });
  }
  const leftoverAt = r.ok ? firstUnparsedOffset(input, r.span?.end ?? 0, options.lineComments === true) : null;
  if (leftoverAt !== null) {
    collected.push({ message: 'Unexpected input', offset: leftoverAt });
  }
  collected.push(...host.getErrors());
  // Default: report ONE error and stop — the earliest by position.
  collected.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
  const errors: JessError[] = collected.length > 0
    ? [toParseError(collected[0]!.message, collected[0]!.offset, input)]
    : [];

  return {
    tree,
    errors,
    warnings: host.getWarnings(),
    trivia: buildLazyTriviaMap(triviaLog, input)
  };
}

export function parseCssFn(input: string): CssParseResult {
  // CSS has no `//` line comments — a trailing `//…` is real leftover input.
  return runFunctionalParse(input, Stylesheet, host);
}
