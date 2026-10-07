import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import {
  decl, dimension, forNode, operation, range, stylesheet, rule, variableDeclaration,
  variableReference, type Stylesheet
} from '../nodes.js';
import { serialize } from '../serialize.js';

const evaluator = buildEvaluator(makeLessRegistry());
const render = (doc: Stylesheet, collapseNesting = true): string | undefined =>
  serialize(doc, { evaluator, collapseNesting }).css;

const iPlusX = () =>
  operation('+', variableReference('i', 'live'), variableReference('x', 'live'), false, true);

/** `$i: 0; for x in 1..3 { $i (::=) $i + $x } .a { width: $i }` — accumulator. */
const accumulator = (): Stylesheet => stylesheet([
  variableDeclaration('i', dimension(0), { mode: 'declare' }),
  forNode(range(dimension(1), dimension(3)), [
    variableDeclaration('i', iPlusX(), { mode: 'reassign-or-declare', scope: 'live' })
  ], { kind: 'single', name: 'x' }),
  rule('.a', [decl('width', variableReference('i', 'live'))])
]);

describe('reassign-or-declare (optional-shadow) eval', () => {
  it('a loop accumulator reassigns the outer binding each iteration (0+1+2+3 = 6)', () => {
    expect(render(accumulator())).toBe('.a {\n  width: 6;\n}\n');
  });

  it('gives the same result collapsed and nested (both evaluators share the write arm)', () => {
    expect(render(accumulator(), true)).toBe(render(accumulator(), false));
  });

  it('declares a block-local binding when none exists outside (does not leak past the loop)', () => {
    const doc = stylesheet([
      forNode(range(dimension(1), dimension(2)), [
        variableDeclaration('tmp', variableReference('x', 'live'), { mode: 'reassign-or-declare', scope: 'live' })
      ], { kind: 'single', name: 'x' }),
      rule('.a', [decl('width', dimension(5, 'px'))])
    ]);
    expect(render(doc)).toBe('.a {\n  width: 5px;\n}\n');
  });
});
