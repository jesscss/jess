/**
 * Functional CSS grammar — the macro-compiled counterpart to the class-based
 * CssParser. Combinators are imported `with { type: 'macro' }`, so the parseman
 * plugin compiles the whole grammar (CST capture + node construction) to flat JS
 * at build time; without the plugin the interpreter runs the identical tree.
 *
 * This file is JUST the grammar — terminals + the `cssGrammar` rule map. Every
 * capital rule is a structural `node(type, parser)`: parseman captures the rule's
 * terminals + trivia and builds the AST via the injected `ctx.build` host. The
 * host, the parse driver, and `parseCssFn` live in ./functional-parser.ts and
 * ./functional-driver.ts. Less/Scss extend this grammar via `compose([cssGrammar,
 * …])` — no source needed (the pieces travel on the value).
 */
import {
  node, regex, literal, sequence, choice, many, oneOrMore, optional,
  not, scanTo, balanced, parser, trivia, rules, expect
} from 'parseman' with { type: 'macro' };

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

export const cssGrammar = rules((g: any) => {
  // ── Root ──────────────────────────────────────────────────────────────────
  // No catch-all arm: a run of input that matches no rule simply stops `many`,
  // leaving unconsumed input the driver reports as one syntax error. Required
  // closers below are wrapped in expect() so a missing one is reported (and
  // recovered) by parseman rather than aborting the whole parse.
  const Stylesheet = node('Stylesheet',
    parser({ trivia: rw }, many(choice(g.QueryAtRuleBlock, g.AtRuleBlock, g.AtRuleStatement, g.UnknownAtRuleBlock, g.Ruleset))));

  // ── Rulesets ───────────────────────────────────────────────────────────────
  const Ruleset = node('Ruleset',
    parser({ trivia: rw }, sequence(g.SelectorList, literal('{'), g.declarationList, expect(literal('}'), '}'))));

  // ── Selectors ──────────────────────────────────────────────────────────────
  const SelectorList = node('SelectorList',
    parser({ trivia: rw }, sequence(g.ComplexSelector, many(sequence(literal(','), g.ComplexSelector)))));
  const ComplexSelector = node('ComplexSelector',
    parser({ trivia: rw }, sequence(g.CompoundSelector, many(sequence(optional(combinator), g.CompoundSelector)))));
  const CompoundSelector = node('CompoundSelector',
    parser({ trivia: rw }, oneOrMore(g.simpleSelector)));
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
    )));
  const PseudoSelector = node('PseudoSelector',
    parser({ trivia: rw }, sequence(pseudoColon, ident, optional(sequence(literal('('), g.pseudoArg, literal(')'))))));
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
    // A value immediately followed by `{` is not a declaration but a nested
    // ruleset whose selector looks declaration-like (`a:hover { … }`) — CSS
    // Nesting's declaration-vs-rule ambiguity. The `not('{')` guard rejects the
    // declaration parse so the enclosing choice falls through to `Ruleset`.
    parser({ trivia: rw }, sequence(propName, literal(':'), g.valueList, not(literal('{')), optional(important), optional(literal(';')))));
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
    )));

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
  const calcParen = node('Paren', parser({ trivia: rw }, sequence(literal('('), g.mathSum, expect(literal(')'), ')'))));
  const calcValue = choice(g.Dimension, g.Num, g.Color, g.Url, g.CalcCall, g.Call, calcParen, g.Quoted, g.anyValue);
  const mathProduct = node('Operation',
    parser({ trivia: rw }, sequence(calcValue, many(sequence(prodOp, calcValue)))), undefined, { collapse: true });
  const mathSum = node('Operation',
    parser({ trivia: rw }, sequence(g.mathProduct, many(sequence(sumOp, g.mathProduct)))), undefined, { collapse: true });

  // unit collapsed to one regex (Dimension still reads number + unit as two leaves).
  const Dimension = node('Dimension', sequence(numPart, regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|%/)));
  // `Num` and `Color` now come from the shared `numericRules` fragment, spread into
  // the return object below (identical to the Less grammar's definitions).
  const Url = node('Url',
    parser({ trivia: rw }, sequence(urlOpen, optional(choice(singleStr, doubleStr, urlInner)), literal(')'))));
  // Generic function-call args stay a PERMISSIVE value list — `rgb(255 0 0)`,
  // `min(1px, 2px)` are space / comma lists, not math expressions.
  const parenBody = parser({ trivia: rw }, sequence(optional(g.valueList), literal(')')));
  // Call OR bare ident, parsing the ident exactly once: take the call-args tail
  // only when '(' follows. _buildCall returns a Call node when args are present,
  // otherwise the bare ident string (bubbling identically to the old anyValue
  // ident arm). This removes the per-bare-ident "parse ident, backtrack on '('".
  const Call = node('Call', parser({ trivia: rw }, sequence(ident, optional(sequence(literal('('), g.parenBody)))));
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
    parser({ trivia: rw }, sequence(queryAtKeyword, g.queryPrelude, literal('{'), g.atRuleBody, expect(literal('}'), '}'))));

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
    parser({ trivia: rw }, sequence(knownBlockAtKeyword, atPrelude, literal('{'), g.atRuleBody, expect(literal('}'), '}'))));
  const opaqueAtBody = scanTo(literal('}'), { skip: [balanced('{', '}'), singleStr, doubleStr, comment] });
  const UnknownAtRuleBlock = node('UnknownAtRuleBlock',
    parser({ trivia: rw }, sequence(atKeyword, atPrelude, literal('{'), opaqueAtBody, literal('}'))));
  const AtRuleStatement = node('AtRuleStatement',
    parser({ trivia: rw }, sequence(atKeyword, atPrelude, literal(';'))));
  // Body of a known at-rule block. No catch-all: unparseable content stops `many`,
  // and the block's expect('}') reports a syntax error at that point.
  const atRuleBody = parser({ trivia: rw }, many(choice(
    g.QueryAtRuleBlock, g.AtRuleBlock, g.AtRuleStatement, g.UnknownAtRuleBlock, g.Ruleset, g.Declaration, g.CustomDeclaration, literal(';')
  )));

  // ── Value leaves & sub-grammars ────────────────────────────────────────────
  // `Quoted`, `Num`/`Color`, value-position `Paren`/`calc()`, and the
  // `@media`/`@container`/`@supports` condition grammar. Less and Scss inherit
  // these verbatim through `compose([cssGrammar, …])`.
  const Quoted = node('Quoted', choice(singleStr, doubleStr));
  // bare number; the not()-lookahead is folded into the regex → one match, one leaf.
  const numTok = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)(?![a-zA-Z\u0080-\uffff%])/);
  const colorHex = regex(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/);
  const Num = node('Num', numTok);
  const Color = node('Color', colorHex);
  const Paren = node('Paren', parser({ trivia: rw }, sequence(literal('('), g.parenBody)));
  const CalcCall = node('Call', parser({ trivia: rw }, sequence(regex(/calc(?=\()/i), literal('('), g.calcBody)));
  const mfComparison = regex(/<=|>=|[<>=]/);
  // Optional leading container name — an ident that is NOT a query keyword.
  const containerName = regex(/(?!(?:not|and|or|only)(?![-\w]))-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/i);
  const QueryFeature = node('QueryFeature',
    parser({ trivia: rw }, sequence(ident, optional(choice(
      sequence(literal(':'), g.valueList),
      sequence(mfComparison, g.value, optional(sequence(mfComparison, g.value)))
    )))));
  const QueryInParens = node('QueryInParens',
    parser({ trivia: rw }, sequence(literal('('), choice(g.QueryCondition, g.QueryFeature), literal(')'))));
  const QueryCondition = node('QueryCondition',
    parser({ trivia: rw }, choice(
      sequence(regex(/not(?![-\w])/i), g.QueryInParens),
      sequence(g.QueryInParens, many(sequence(regex(/(?:and|or)(?![-\w])/i), g.QueryInParens)))
    )));
  const queryPrelude = parser({ trivia: rw },
    sequence(optional(containerName), g.QueryCondition, many(sequence(literal(','), g.QueryCondition))));

  return {
    rw,
    Quoted, Num, Color, Paren, CalcCall,
    QueryFeature, QueryInParens, QueryCondition, queryPrelude,
    Stylesheet, Ruleset, SelectorList, ComplexSelector, CompoundSelector, simpleSelector,
    AttributeSelector, PseudoSelector, pseudoArg,
    Declaration, CustomDeclaration, declarationList,
    valueList, valueSequence, value, parenBody, mathProduct, mathSum, calcBody,
    Dimension, Url, Call, anyValue,
    AtRuleBlock, AtRuleStatement, atRuleBody,
    QueryAtRuleBlock, UnknownAtRuleBlock
  };
});

// Entry + notable rules pulled off the grammar map for the driver and tests.
// Less/Scss don't import these — they extend the whole grammar via `compose()`.
export const {
  Stylesheet, Ruleset, SelectorList, ComplexSelector, CompoundSelector,
  AttributeSelector, PseudoSelector, Declaration, CustomDeclaration,
  Dimension, Num, Color, Url, Call, Paren, Quoted, AtRuleBlock, AtRuleStatement
} = cssGrammar;
