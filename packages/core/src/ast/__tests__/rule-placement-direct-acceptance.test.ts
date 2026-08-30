import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { atRuleBlock } from '../at-rule.js';
import { buildEvaluator } from '../evaluator.js';
import { decl, keyword, rule, stylesheet } from '../nodes.js';
import { serialize } from '../serialize.js';

describe('canonical flattened rule placement', () => {
  it('preserves parent/child/parent authored order across a collapsed nested rule', () => {
    const document = stylesheet([
      rule('.parent', [
        decl('before', keyword('one')),
        rule('.child', [decl('inside', keyword('two'))]),
        decl('after', keyword('three'))
      ])
    ]);

    expect(serialize(document, {
      evaluator: buildEvaluator(makeLessRegistry()),
      collapseNesting: true
    }).css).toBe('.parent {\n'
      + '  before: one;\n'
      + '}\n'
      + '.parent .child {\n'
      + '  inside: two;\n'
      + '}\n'
      + '.parent {\n'
      + '  after: three;\n'
      + '}\n');
  });

  it('keeps direct declarations after a bubbled at-rule in a trailing parent block', () => {
    const document = stylesheet([
      rule('.onTop', [
        atRuleBlock('@font-face', null, [decl('font-family', keyword('something'))]),
        atRuleBlock('@keyframes', keyword('textscale'), [
          rule('0%', [decl('font-size', keyword('small'))])
        ]),
        decl('animation', keyword('textscale')),
        decl('font-family', keyword('something'))
      ])
    ]);

    expect(serialize(document, {
      evaluator: buildEvaluator(makeLessRegistry()),
      collapseNesting: true
    }).css).toBe('@font-face {\n'
      + '  font-family: something;\n'
      + '}\n'
      + '@keyframes textscale {\n'
      + '  0% {\n'
      + '    font-size: small;\n'
      + '  }\n'
      + '}\n'
      + '.onTop {\n'
      + '  animation: textscale;\n'
      + '  font-family: something;\n'
      + '}\n');
  });
});
