/**
 * Shared grammar rules — reused by BOTH the CSS and Less functional grammars.
 *
 * These rule fragments are structurally identical across the two dialects, so they
 * live here once and are spread into each grammar's `rules()` map:
 *
 *   ...numericRules(g, { build })
 *   ...stringRules(g, { build })
 *   ...queryRules(g, { build })
 *   ...parenRules(g, { build })
 *
 * The parseman macro inlines each into the consumer's compiled rule map (tier-2
 * imported-fragment composition): css imports them relatively, less via
 * `@jesscss/css-parser/shared-value-rules` (resolved to THIS source through the
 * package's `source` export condition). Without the macro they run identically
 * interpreted.
 *
 * Each fragment is deliberately **self-contained** — its rule parsers reference only
 * parseman combinators, the `g` proxy, its own local terminals, and the injected
 * `build` host. Two kinds of dependency are threaded in rather than closed over:
 *
 *  - `build` — the AST-node builder, grammar-specific (css vs less dispatch to
 *    different builders), injected via the second `deps` argument.
 *  - `g.rw` / `g.value` / `g.valueList` / `g.parenBody` / `g.calcBody` / `g.Query*`
 *    — rules that DIFFER between the dialects (e.g. `rw` skips `//` line comments in
 *    Less but not CSS; `parenBody` is a whole different sub-grammar). Routing them
 *    through the `g` proxy lets each grammar supply its own, so one shared rule adapts
 *    to both. Terminals that are byte-identical across dialects (idents, comparison
 *    operators, the `calc(` head) stay as local `const`s here.
 *
 * See docs/guide/extending.md for the composition model.
 */
import { node, regex, literal, sequence, choice, optional, many, parser } from 'parseman';

type Deps = { build: (type: string, c: any, r: any, s: any) => any };

/**
 * Quoted-string terminals. `\\` + newline is valid CSS line continuation (the newline
 * is consumed); `[\s\S]` after `\\` matches that case. `\.` would not (`.` skips NL).
 * Exported for runtime consumers; each grammar keeps a local `regex(...)` copy with this
 * same pattern so the macro can statically evaluate scanTo/balanced skip holes.
 */
export const singleStr = regex(/'(?:[^'\\]|\\[\s\S])*'/);
export const doubleStr = regex(/"(?:[^"\\]|\\[\s\S])*"/);

/** `Quoted` — a single- or double-quoted string value. Identical in css & less. */
export const stringRules = (g: any, { build }: Deps) => ({
  Quoted: node('Quoted', choice(singleStr, doubleStr), (c: any, r: any, s: any) => build('Quoted', c, r, s))
});

/** `Num` and `Color` — bare numeric + hex-color leaves. Identical in css & less. */
export const numericRules = (g: any, { build }: Deps) => {
  // bare number; the not()-lookahead is folded into the regex → one match, one leaf.
  const numTok = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)(?![a-zA-Z\u0080-\uffff%])/);
  const colorHex = regex(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/);
  return {
    Num: node('Num', numTok, (c: any, r: any, s: any) => build('Num', c, r, s)),
    Color: node('Color', colorHex, (c: any, r: any, s: any) => build('Color', c, r, s))
  };
};

/**
 * Value-position `Paren` and the `calc(…)` call. Both defer to `g.parenBody` /
 * `g.calcBody` (each grammar's own sub-grammar) and `g.rw` (each grammar's trivia),
 * so the one-line wrappers are shared while the bodies stay dialect-specific.
 */
export const parenRules = (g: any, { build }: Deps) => ({
  Paren: node('Paren',
    parser({ trivia: g.rw }, sequence(literal('('), g.parenBody)),
    (c: any, r: any, s: any) => build('Paren', c, r, s)),
  CalcCall: node('Call',
    parser({ trivia: g.rw }, sequence(regex(/calc(?=\()/i), literal('('), g.calcBody)),
    (c: any, r: any, s: any) => build('Call', c, r, s))
});

/**
 * The `@media` / `@container` / `@supports` condition sub-grammar (feature, parens,
 * and/or/not chains, and the comma-separated prelude). Identical across css & less.
 * References each grammar's `g.value` / `g.valueList` / `g.rw`; the enclosing
 * `QueryAtRuleBlock` (which differs — Less commits its opening brace) stays in each
 * grammar and reads `g.queryPrelude` from here.
 */
export const queryRules = (g: any, { build }: Deps) => {
  const ident = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))*/);
  const mfComparison = regex(/<=|>=|[<>=]/);
  // Optional leading container name — an ident that is NOT a query keyword.
  const containerName = regex(/(?!(?:not|and|or|only)(?![-\w]))-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/i);
  return {
    QueryFeature: node('QueryFeature',
      parser({ trivia: g.rw }, sequence(ident, optional(choice(
        sequence(literal(':'), g.valueList),
        sequence(mfComparison, g.value, optional(sequence(mfComparison, g.value)))
      )))),
      (c: any, r: any, s: any) => build('QueryFeature', c, r, s)),
    QueryInParens: node('QueryInParens',
      parser({ trivia: g.rw }, sequence(literal('('), choice(g.QueryCondition, g.QueryFeature), literal(')'))),
      (c: any, r: any, s: any) => build('QueryInParens', c, r, s)),
    QueryCondition: node('QueryCondition',
      parser({ trivia: g.rw }, choice(
        sequence(regex(/not(?![-\w])/i), g.QueryInParens),
        sequence(g.QueryInParens, many(sequence(regex(/(?:and|or)(?![-\w])/i), g.QueryInParens)))
      )),
      (c: any, r: any, s: any) => build('QueryCondition', c, r, s)),
    queryPrelude: parser({ trivia: g.rw },
      sequence(optional(containerName), g.QueryCondition, many(sequence(literal(','), g.QueryCondition))))
  };
};
