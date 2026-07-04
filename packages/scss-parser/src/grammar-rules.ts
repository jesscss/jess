/**
 * Exportable SCSS grammar fragment — the delta on top of the Less grammar.
 *
 * Spread AFTER `lessGrammarRules` in a consumer's `rules()` map; these keys
 * override Less's `@`-variable rules with SCSS `$`-variable rules and inject the
 * SCSS control-flow statements (@if/@else, …) ahead of Less's generic at-rules.
 * See docs/guide/extending.md (parseman) for the composition model.
 *
 * Macro-neutral: imports `'parseman'` without `with { type: 'macro' }`.
 * Self-contained: terminals are block-local inside the factory.
 */
import { node, regex, literal, sequence, choice, optional, parser, noTrivia, many, expect } from 'parseman';

export type ScssGrammarDeps = { build: (type: string, c: any, r: any, s: any) => any };

/**
 * SCSS-specific rule overrides. `g.rw`, `g.valueList`, the statement-item
 * choices (`g.stylesheetItem`, `g.blockItem`) and the rest of the Less grammar
 * come from the spread of `lessGrammarRules` in the consumer.
 */
export const scssGrammarRules = (g: any, { build }: ScssGrammarDeps) => {
  // SCSS `$variable` token — first char may be a letter or `-` after `$`.
  const scssVar = regex(/\$-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const rw = g.rw;

  const VarDeclaration = node('VarDeclaration',
    parser({ trivia: rw }, sequence(
      scssVar,
      literal(':'),
      g.valueList,
      optional(choice(literal('!default'), literal('!global'))),
      optional(literal(';'))
    )),
    (c: any, r: any, s: any) => build('VarDeclaration', c, r, s));

  // SCSS references are bare `$var` (no Less accessor-chain syntax).
  const Reference = node('Reference',
    noTrivia(scssVar),
    (c: any, r: any, s: any) => build('Reference', c, r, s));

  // ── Control flow: @if / @else if / @else ───────────────────────────────────
  // Faithful port of the Chevrotain scssCondition* / scssIfAtRule productions
  // (productions/conditions.ts, productions/atRules.ts). The condition sub-
  // grammar is structurally the Less guard grammar (or → and → term → parens /
  // comparison), so the SCSS builders mirror LessGrammar's guard builders.
  const scssCompareOp = regex(/==|!=|>=|<=|=|>|</);
  const kwOr = regex(/or(?![-\w])/i);
  const kwAnd = regex(/and(?![-\w])/i);
  const kwNot = regex(/not(?![-\w])/i);

  // A single comparison operand. Specific value rules first; `anyValue` last —
  // it stops at whitespace so it cannot swallow a spaced ` == ` / `and` / `{`.
  const condOperand = choice(g.Reference, g.Dimension, g.Num, g.Color, g.NamedColor, g.Quoted, g.Call, g.Paren, g.anyValue);
  const ScssComparison = node('ScssComparison',
    parser({ trivia: rw }, sequence(condOperand, optional(sequence(scssCompareOp, condOperand)))),
    (c: any, r: any, s: any) => build('ScssComparison', c, r, s));
  // `(` condOr `)` (Paren-wrapped) OR a bare comparison.
  const ScssCondInParens = node('ScssCondInParens',
    parser({ trivia: rw }, choice(
      sequence(literal('('), g.ScssCondOr, literal(')')),
      g.ScssComparison
    )),
    (c: any, r: any, s: any) => build('ScssCondInParens', c, r, s));
  // A term: optional `not`, then a paren-group or a comparison.
  const ScssCondTerm = node('ScssCondTerm',
    parser({ trivia: rw }, sequence(optional(kwNot), g.ScssCondInParens)),
    (c: any, r: any, s: any) => build('ScssCondTerm', c, r, s));
  // 'and' chain (left-associative).
  const ScssCondAnd = node('ScssCondAnd',
    parser({ trivia: rw }, sequence(g.ScssCondTerm, many(sequence(kwAnd, g.ScssCondTerm)))),
    (c: any, r: any, s: any) => build('ScssCondAnd', c, r, s));
  // 'or' / ',' chain (left-associative). `,` is allowed in @if (legacy syntax).
  const ScssCondOr = node('ScssCondOr',
    parser({ trivia: rw }, sequence(g.ScssCondAnd, many(sequence(choice(kwOr, literal(',')), g.ScssCondAnd)))),
    (c: any, r: any, s: any) => build('ScssCondOr', c, r, s));

  // A `{ … }` block body → Rules (statements come from atRuleBody).
  const ScssRules = node('ScssRules',
    parser({ trivia: rw }, sequence(literal('{'), g.atRuleBody, expect(literal('}'), '}'))),
    (c: any, r: any, s: any) => build('ScssRules', c, r, s));

  const ifKw = regex(/@if(?![-\w])/i);
  const elseKw = regex(/@else(?![-\w])/i);
  const ifWord = regex(/if(?![-\w])/i);
  const ScssIf = node('ScssIf',
    parser({ trivia: rw }, sequence(
      ifKw, g.ScssCondOr, g.ScssRules,
      many(sequence(elseKw, choice(
        sequence(ifWord, g.ScssCondOr, g.ScssRules),
        g.ScssRules
      )))
    )),
    (c: any, r: any, s: any) => build('ScssIf', c, r, s));

  // ── Statement injection ─────────────────────────────────────────────────
  // Override Less's containers to try the SCSS control statements first, then
  // fall back to Less's full statement set (`g.stylesheetItem` / `g.blockItem`).
  const scssStatement = choice(g.ScssIf);
  const Stylesheet = node('Stylesheet',
    parser({ trivia: rw }, many(choice(scssStatement, g.stylesheetItem))),
    (c: any, r: any, s: any) => build('Stylesheet', c, r, s));
  const declarationList = parser({ trivia: rw }, many(choice(scssStatement, g.blockItem)));
  const atRuleBody = parser({ trivia: rw }, many(choice(scssStatement, g.blockItem)));

  return {
    VarDeclaration, Reference,
    ScssComparison, ScssCondInParens, ScssCondTerm, ScssCondAnd, ScssCondOr, ScssRules, ScssIf,
    Stylesheet, declarationList, atRuleBody
  };
};
