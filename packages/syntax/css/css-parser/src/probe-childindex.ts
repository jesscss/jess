/**
 * Reviewer probe: do `literal()` matches occupy reducer child slots?
 *
 * Candidate A's `Group` and `GeneralEnclosed` both reduce with `children[1]`
 * over `sequence(literal('('), <value>, literal(')'))` and produce
 * `block(undefined, 'paren')`. If literals are dropped from the child array the
 * value sits at index 0 and every such reducer is off by one.
 */
import { classifiedTrivia, composeLeaf, literal, node, optional, regex, rules, sequence } from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';
import { cssSyntax } from '@jesscss/parser-shared/recognition';
import { cssPseudoSyntax } from '@jesscss/parser-shared/pseudo-consts';

const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const whitespaceRun = regex(/[ \t\n\r\f]+/);
const whitespace = classifiedTrivia({ whitespace: whitespaceRun, blockComment });

type ProbeSelf = { readonly [K in 'Stylesheet' | 'Identifier']: Combinator<unknown> };

const probeFactory = (g: ProbeSelf) => {
  const Stylesheet = node(
    'Stylesheet',
    sequence(literal('('), optional(g.Identifier), literal(')')),
    children => ({
      count: children.length,
      kinds: children.map(child => (typeof child === 'string'
        ? `str:${child}`
        : typeof child === 'object' && child !== null && 'value' in child
          ? `tok:${String((child as { value: unknown }).value)}`
          : `other:${typeof child}`))
    })
  );
  return { Stylesheet };
};

export const childIndexProbe = composeLeaf([cssSyntax, cssPseudoSyntax, rules(
  { trivia: whitespace },
  probeFactory
)]);
