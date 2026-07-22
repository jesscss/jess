import { describe, expect, it } from 'vitest';
import { makeBuiltinRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { decl, keyword, rule, stylesheet } from '../nodes.js';
import { serialize } from '../serialize.js';

describe('canonical flattened rule placement', () => {
  it('emits direct declarations as one parent block across a nested rule', () => {
    const document = stylesheet([
      rule('.parent', [
        decl('before', keyword('one')),
        rule('.child', [decl('inside', keyword('two'))]),
        decl('after', keyword('three'))
      ])
    ]);

    expect(serialize(document, {
      evaluator: buildEvaluator(makeBuiltinRegistry()),
      collapseNesting: true
    }).css).toBe(
      '.parent {\n'
      + '  before: one;\n'
      + '  after: three;\n'
      + '}\n'
      + '.parent .child {\n'
      + '  inside: two;\n'
      + '}\n'
    );
  });
});
