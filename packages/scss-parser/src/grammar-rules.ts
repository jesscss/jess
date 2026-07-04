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
import { node, regex, literal, sequence, choice, optional, parser, noTrivia, many, expect, sepBy } from 'parseman';

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

  // ── Control flow: @each / @for / @while ────────────────────────────────────
  // Faithful ports of scssEachAtRule / scssForAtRule / scssWhileAtRule
  // (productions/atRules.ts). All normalize to Jess `For` / `While` nodes.
  const inKw = regex(/\bin\b/);
  const fromKw = regex(/\bfrom\b/);
  const forThrough = regex(/\bthrough\b/);
  const forTo = regex(/\bto\b/);
  const eachKw = regex(/@each(?![-\w])/i);
  const forKw = regex(/@for(?![-\w])/i);
  const whileKw = regex(/@while(?![-\w])/i);

  const ScssEach = node('ScssEach',
    parser({ trivia: rw }, sequence(
      eachKw,
      sepBy(scssVar, literal(',')),
      inKw,
      g.valueSequence,
      g.ScssRules
    )),
    (c: any, r: any, s: any) => build('ScssEach', c, r, s));

  const ScssFor = node('ScssFor',
    parser({ trivia: rw }, sequence(
      forKw,
      scssVar,
      fromKw,
      g.topSum,
      choice(forThrough, forTo),
      g.topSum,
      g.ScssRules
    )),
    (c: any, r: any, s: any) => build('ScssFor', c, r, s));

  const ScssWhile = node('ScssWhile',
    parser({ trivia: rw }, sequence(whileKw, g.ScssCondOr, g.ScssRules)),
    (c: any, r: any, s: any) => build('ScssWhile', c, r, s));

  // ── Mixins: @mixin / @include / @content ───────────────────────────────────
  // Faithful ports of scssMixinAtRule / scssIncludeAtRule / scssContentAtRule.
  // Interpolated mixin names (`foo-#{$bar}`) deferred to the interpolation tranche.
  const plainIdent = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const mixinKw = regex(/@mixin(?![-\w])/i);
  const includeKw = regex(/@include(?![-\w])/i);
  const contentKw = regex(/@content(?![-\w])/i);
  const usingKw = regex(/\busing\b/);

  // SCSS call/mixin argument: `$x: val`, `val...`, or a plain value.
  const ScssCallArg = node('ScssCallArg',
    parser({ trivia: rw }, choice(
      sequence(scssVar, literal(':'), g.valueSequence),
      sequence(g.valueSequence, literal('...')),
      g.valueSequence
    )),
    (c: any, r: any, s: any) => build('ScssCallArg', c, r, s));
  const ScssCallArgsInner = node('ScssCallArgsInner',
    parser({ trivia: rw }, optional(sequence(
      g.ScssCallArg,
      many(sequence(literal(','), optional(g.ScssCallArg)))
    ))),
    (c: any, r: any, s: any) => build('ScssCallArgsInner', c, r, s));
  const optionalCallParens = optional(sequence(
    literal('('), g.ScssCallArgsInner, expect(literal(')'), ')')
  ));

  // Mixin parameter: `...$rest`, `$rest...`, `$a: default`, or bare `$a`.
  const ScssMixinParam = node('ScssMixinParam',
    parser({ trivia: rw }, choice(
      sequence(literal('...'), scssVar),
      sequence(scssVar, literal('...')),
      sequence(scssVar, optional(sequence(literal(':'), g.valueSequence)))
    )),
    (c: any, r: any, s: any) => build('ScssMixinParam', c, r, s));
  const ScssMixinParams = node('ScssMixinParams',
    parser({ trivia: rw }, sequence(
      literal('('),
      optional(sequence(
        g.ScssMixinParam,
        many(sequence(literal(','), optional(g.ScssMixinParam)))
      )),
      expect(literal(')'), ')')
    )),
    (c: any, r: any, s: any) => build('ScssMixinParams', c, r, s));

  // Mixin/include name: `foo` or module-qualified `ns.foo`.
  const ScssMixinName = node('ScssMixinName',
    parser({ trivia: rw }, choice(
      sequence(plainIdent, literal('.'), plainIdent),
      plainIdent
    )),
    (c: any, r: any, s: any) => build('ScssMixinName', c, r, s));

  const ScssDeclBody = node('ScssDeclBody',
    parser({ trivia: rw }, sequence(literal('{'), g.declarationList, expect(literal('}'), '}'))),
    (c: any, r: any, s: any) => build('ScssDeclBody', c, r, s));

  const ScssMixin = node('ScssMixin',
    parser({ trivia: rw }, sequence(
      mixinKw, plainIdent, optional(g.ScssMixinParams), g.ScssDeclBody
    )),
    (c: any, r: any, s: any) => build('ScssMixin', c, r, s));

  const ScssIncludeUsing = node('ScssIncludeUsing',
    parser({ trivia: rw }, sequence(
      usingKw, literal('('), sepBy(scssVar, literal(',')), expect(literal(')'), ')')
    )),
    (c: any, r: any, s: any) => build('ScssIncludeUsing', c, r, s));

  const ScssInclude = node('ScssInclude',
    parser({ trivia: rw }, sequence(
      includeKw, g.ScssMixinName, optionalCallParens,
      optional(g.ScssIncludeUsing), optional(g.ScssRules), optional(literal(';'))
    )),
    (c: any, r: any, s: any) => build('ScssInclude', c, r, s));

  const ScssContent = node('ScssContent',
    parser({ trivia: rw }, sequence(contentKw, optionalCallParens, optional(literal(';')))),
    (c: any, r: any, s: any) => build('ScssContent', c, r, s));

  // ── Statement injection ─────────────────────────────────────────────────
  // Override Less's containers to try the SCSS control statements first, then
  // fall back to Less's full statement set (`g.stylesheetItem` / `g.blockItem`).
  const scssStatement = choice(
    g.ScssIf, g.ScssEach, g.ScssFor, g.ScssWhile,
    g.ScssMixin, g.ScssInclude, g.ScssContent
  );
  const Stylesheet = node('Stylesheet',
    parser({ trivia: rw }, many(choice(scssStatement, g.stylesheetItem))),
    (c: any, r: any, s: any) => build('Stylesheet', c, r, s));
  const declarationList = parser({ trivia: rw }, many(choice(scssStatement, g.blockItem)));
  const atRuleBody = parser({ trivia: rw }, many(choice(scssStatement, g.blockItem)));

  return {
    VarDeclaration, Reference,
    ScssComparison, ScssCondInParens, ScssCondTerm, ScssCondAnd, ScssCondOr, ScssRules, ScssIf,
    ScssEach, ScssFor, ScssWhile,
    ScssCallArg, ScssCallArgsInner, ScssMixinParam, ScssMixinParams, ScssMixinName,
    ScssDeclBody, ScssMixin, ScssIncludeUsing, ScssInclude, ScssContent,
    Stylesheet, declarationList, atRuleBody
  };
};
