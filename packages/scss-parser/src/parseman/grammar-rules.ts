/**
 * Exportable SCSS grammar fragment — the delta on top of the Less grammar.
 *
 * Spread AFTER `lessGrammarRules` in a consumer's `rules()` map; these keys
 * override Less's `@`-variable rules with SCSS `$`-variable rules. See
 * docs/guide/extending.md (parseman) for the composition model.
 *
 * Macro-neutral: imports `'parseman'` without `with { type: 'macro' }`.
 * Self-contained: terminals are block-local inside the factory.
 */
import { node, regex, literal, sequence, choice, optional, parser, noTrivia } from 'parseman';

export type ScssGrammarDeps = { build: (type: string, c: any, r: any, s: any) => any };

/**
 * SCSS-specific rule overrides. `g.rw`, `g.valueList`, and the rest of the Less
 * grammar come from the spread of `lessGrammarRules` in the consumer.
 */
export const scssGrammarRules = (g: any, { build }: ScssGrammarDeps) => {
  // SCSS `$variable` token — first char may be a letter or `-` after `$`.
  const scssVar = regex(/\$-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);

  const VarDeclaration = node('VarDeclaration',
    parser({ trivia: g.rw }, sequence(
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

  return { VarDeclaration, Reference };
};
