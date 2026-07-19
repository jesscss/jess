/** Closed direct AST-v2 Parseman grammar pilot. */
import { choice, literal, many, node, regex, rules, sequence, trivia } from 'parseman' with { type: 'macro' };
import type { Comment, SelectorList, Statement } from '@jesscss/core/ast';

const whitespace = trivia(regex(/[ \t\n\r\f]+/));
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const simpleSelector = regex(/(?:[.#]?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\*)/);

export const directCssAstGrammar = rules({ trivia: whitespace }, (g: any) => {
  const DirectCssComment = node('DirectCssComment', blockComment, children => ({
    type: 'Comment' as const,
    text: (() => {
      const first = children[0];
      return typeof first === 'object' && first !== null && 'value' in first && typeof first.value === 'string'
        ? first.value
        : '';
    })()
  }));
  const DirectCssSelector = node('DirectCssSelector', simpleSelector, (children) => {
    const first = children[0];
    const text = typeof first === 'object' && first !== null && 'value' in first && typeof first.value === 'string'
      ? first.value
      : '';
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
    (children) => {
      const first = children[0];
      if (typeof first !== 'object' || first?.type !== 'SelectorList' || !('selectors' in first) || !Array.isArray(first.selectors)) {
        throw new Error('DirectCssRuleset requires a selector');
      }
      const selector: SelectorList = { type: 'SelectorList', selectors: first.selectors };
      return {
        type: 'Rule' as const,
        selector,
        body: children.filter((child): child is Comment =>
          typeof child === 'object' && child !== null && (child as { type?: unknown }).type === 'Comment')
      };
    }
  );
  const DirectCssDocument = node(
    'DirectCssDocument',
    many(choice(g.DirectCssComment, g.DirectCssRuleset)),
    children => ({
      type: 'Root' as const,
      children: children.filter((child): child is Statement =>
        typeof child === 'object' && child !== null
        && ((child as { type?: unknown }).type === 'Rule' || (child as { type?: unknown }).type === 'Comment'))
    }),
    { trailingTrivia: true }
  );
  return { DirectCssDocument, DirectCssComment, DirectCssSelector, DirectCssRuleset, whitespace };
});
