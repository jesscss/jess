/** Closed direct AST-v2 Parseman grammar pilot. */
import { choice, literal, many, node, regex, rules, sequence, trivia } from 'parseman' with { type: 'macro' };
import type { Comment, SelectorList, Statement } from '@jesscss/core/ast';

type Token = { readonly value: string };

const whitespace = trivia(regex(/[ \t\n\r\f]+/));
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const simpleSelector = regex(/(?:[.#]?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\*)/);

export const directCssAstGrammar = rules({ trivia: whitespace }, (g: any) => {
  const DirectCssComment = node('DirectCssComment', blockComment, (children: readonly Token[]) => ({
    type: 'Comment' as const,
    text: children[0]!.value
  }));
  const DirectCssSelector = node('DirectCssSelector', simpleSelector, (children: readonly Token[]) => {
    const text = children[0]!.value;
    return {
      type: 'SelectorList' as const,
      selectors: [{
        type: 'Complex' as const,
        head: { type: 'Compound' as const, simples: [{ type: 'Simple' as const, text, interp: null }] },
        tail: []
      }]
    };
  });
  const DirectCssRuleset = node(
    'DirectCssRuleset',
    sequence(g.DirectCssSelector, literal('{'), many(g.DirectCssComment), literal('}')),
    (children: readonly [SelectorList, Token, ...(Comment | Token)[]]) => {
      const selector = children[0];
      return {
        type: 'Rule' as const,
        selector,
        // The enclosing closed sequence fixes these slots to comments between
        // `{` and `}`; Parseman exposes the literal delimiters in children too.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        body: children.slice(2, -1) as Comment[]
      };
    }
  );
  const DirectCssDocument = node(
    'DirectCssDocument',
    many(choice(g.DirectCssComment, g.DirectCssRuleset)),
    (children: readonly Statement[]) => ({
      type: 'Root' as const,
      children
    }),
    { trailingTrivia: true }
  );
  return { DirectCssDocument, DirectCssComment, DirectCssSelector, DirectCssRuleset, whitespace };
});
