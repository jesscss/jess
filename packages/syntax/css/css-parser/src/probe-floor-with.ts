/**
 * Byte-attribution probe (Candidate B tournament scaffolding — not shipped).
 *
 * One trivial rule composed with the three shared recognition leaves. Its
 * artifact size is the fixed cost `grammar.ts` cannot reach.
 */
import { composeLeaf, classifiedTrivia, literal, many, node, regex, rules } from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';
import { cssSyntax } from '@jesscss/parser-shared/recognition';
import { opaqueAtRuleRecognition } from '@jesscss/parser-shared/opaque-at-rule';
import { cssPseudoSyntax } from '@jesscss/parser-shared/pseudo-consts';

const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const whitespaceRun = regex(/[ \t\n\r\f]+/);
const whitespace = classifiedTrivia({ whitespace: whitespaceRun, blockComment });

type ProbeSelf = { readonly Stylesheet: Combinator<unknown> };

const probeFactory = (g: ProbeSelf) => {
  const Stylesheet = node(
    'Stylesheet',
    many(literal(';')),
    () => null
  );
  return { Stylesheet, unused: g.Stylesheet };
};

export const withLeaves = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules(
  { trivia: whitespace },
  probeFactory
)]);
