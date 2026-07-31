/**
 * Reviewer probe: what does `noTrivia` bind to across a repetition?
 *
 * Candidate A needs a compound selector that forbids trivia BETWEEN adjacent
 * simple selectors (`a.b` is one compound) while permitting it at the LEFT EDGE
 * (`:has(> .b)` must skip the space after the combinator, and `a .b` must split
 * into two compounds). Four spellings are plausible and three have already been
 * guessed wrong, so this measures rather than reasons.
 *
 * Each variant is the same item repeated; only the `noTrivia` placement moves.
 * The item is deliberately a bare regex so nothing else can absorb whitespace.
 */
import { classifiedTrivia, composeLeaf, many, node, noTrivia, regex, rules, sequence, token } from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';
import { cssSyntax } from '@jesscss/parser-shared/recognition';
import { cssPseudoSyntax } from '@jesscss/parser-shared/pseudo-consts';

const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const whitespaceRun = regex(/[ \t\n\r\f]+/);
const whitespace = classifiedTrivia({ whitespace: whitespaceRun, blockComment });

const simple = regex(/[.#]?[a-zA-Z][a-zA-Z0-9-]*/);

type Names = 'Bare' | 'OuterNoTrivia' | 'InnerNoTrivia' | 'HeadThenGluedTail' | 'TokenWrapped' | 'HeadThenNoTriviaMany' | 'CalledAfterCombinator' | 'CalledAfterSpace';

type ProbeSelf = { readonly [K in Names]: Combinator<unknown> };

const probeFactory = (g: ProbeSelf) => {
  /** Control: ambient trivia everywhere. Should merge `a .b` wrongly. */
  const Bare = node(
    'Bare',
    many(simple),
    children => children.length
  );

  /** A's current shape: noTrivia around the whole repetition. */
  const OuterNoTrivia = node(
    'OuterNoTrivia',
    noTrivia(many(simple)),
    children => children.length
  );

  /** noTrivia bound inside each iteration instead. */
  const InnerNoTrivia = node(
    'InnerNoTrivia',
    many(noTrivia(simple)),
    children => children.length
  );

  /** Trivia-permitting head, then a glued tail — the structural candidate. */
  const HeadThenGluedTail = node(
    'HeadThenGluedTail',
    sequence(simple, many(noTrivia(simple))),
    children => children.length
  );

  /** token() around the whole glued run. */
  const TokenWrapped = node(
    'TokenWrapped',
    token(noTrivia(sequence(simple, many(simple)))),
    children => children.length
  );

  /*
   * The structural candidate: the HEAD is parsed under ambient trivia, so the
   * left edge is permissive, and ONE `noTrivia` scope covers the whole tail
   * repetition, so no gap may open between iterations. This is the only shape
   * that separates the two requirements instead of trading them.
   */
  const HeadThenNoTriviaMany = node(
    'HeadThenNoTriviaMany',
    sequence(simple, noTrivia(many(simple))),
    children => children.length
  );

  /** The real-world shape: a caller consumes the combinator, then enters the glued compound. */
  const CalledAfterCombinator = node(
    'CalledAfterCombinator',
    sequence(regex(/>/), noTrivia(many(simple))),
    children => children.length
  );

  /** A caller that consumes only ambient trivia before the glued compound. */
  const CalledAfterSpace = node(
    'CalledAfterSpace',
    sequence(simple, regex(/>/), noTrivia(many(simple))),
    children => children.length
  );

  return { Bare, CalledAfterCombinator, CalledAfterSpace, OuterNoTrivia, InnerNoTrivia, HeadThenGluedTail, TokenWrapped, HeadThenNoTriviaMany };
};

export const triviaScopeProbe = composeLeaf([cssSyntax, cssPseudoSyntax, rules(
  { trivia: whitespace },
  probeFactory
)]);
