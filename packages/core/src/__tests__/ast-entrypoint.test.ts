import { atRuleBlock, dimension, stylesheet } from '../ast.js';
import { bare } from '../../../../test/provenance-free.js';

describe('@jesscss/core/ast', () => {
  it('constructs AST-v2 nodes without the engine surface', () => {
    const value = dimension(12, 'px');
    const doc = stylesheet([atRuleBlock('@media', value, [])]);

    expect(bare(doc)).toEqual({
      type: 'Stylesheet',
      rules: [{ type: 'AtRuleBlock', name: '@media', prelude: value, rules: [] }]
    });
  });
});
