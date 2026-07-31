/**
 * Per-call-site emission decomposition.
 *
 * Six grammars that differ by exactly one construct each, so subtracting
 * adjacent artifacts isolates what a single call site emits. The whole-artifact
 * budget is 4x source; a call site whose SOURCE is 30-60 B was measured at
 * 1,145 B emitted, so per-site emission is the thing over budget, not the
 * grammar. This itemises where those bytes go.
 */
import { choice, classifiedTrivia, composeLeaf, literal, many, node, optional, regex, rules, sequence } from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';
import { cssSyntax } from '@jesscss/parser-shared/recognition';
import { cssPseudoSyntax } from '@jesscss/parser-shared/pseudo-consts';

const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const whitespaceRun = regex(/[ \t\n\r\f]+/);
const whitespace = classifiedTrivia({ whitespace: whitespaceRun, blockComment });

type Names =
  | 'Base' | 'PlusLiteral' | 'PlusOptional' | 'PlusChoiceArm'
  | 'Leaf' | 'RefOnce' | 'RefTwice';

type ProbeSelf = { readonly [K in Names]: Combinator<unknown> };

const probeFactory = (g: ProbeSelf) => {
  /** Two literal sites. */
  const Base = node(
    'Base',
    sequence(literal('a'), literal('b')),
    children => children.length
  );

  /** Base + ONE literal site. Difference isolates a bare terminal site. */
  const PlusLiteral = node(
    'PlusLiteral',
    sequence(literal('a'), literal('b'), literal('c')),
    children => children.length
  );

  /** Base + ONE optional() wrapper around an existing site. */
  const PlusOptional = node(
    'PlusOptional',
    sequence(literal('a'), optional(literal('b'))),
    children => children.length
  );

  /** Base + ONE choice arm. */
  const PlusChoiceArm = node(
    'PlusChoiceArm',
    sequence(literal('a'), choice(literal('b'), literal('c'))),
    children => children.length
  );

  /** A named rule with a non-trivial body, referenced 0/1/2 times below. */
  const Leaf = node(
    'Leaf',
    sequence(literal('x'), many(literal('y'))),
    children => children.length
  );

  /** One `g.` reference to Leaf. */
  const RefOnce = node(
    'RefOnce',
    sequence(literal('a'), g.Leaf),
    children => children.length
  );

  /** Two `g.` references to Leaf. Difference isolates a proxy call site. */
  const RefTwice = node(
    'RefTwice',
    sequence(literal('a'), g.Leaf, g.Leaf),
    children => children.length
  );

  return { Base, PlusLiteral, PlusOptional, PlusChoiceArm, Leaf, RefOnce, RefTwice };
};

export const siteCostProbe = composeLeaf([cssSyntax, cssPseudoSyntax, rules(
  { trivia: whitespace },
  probeFactory
)]);
