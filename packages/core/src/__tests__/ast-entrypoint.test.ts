import { atRuleBlock, dimension, stylesheet } from '../ast.js';

describe('@jesscss/core/ast', () => {
  it('constructs AST-v2 nodes without the engine surface', () => {
    const value = dimension(12, 'px');
    const doc = stylesheet([atRuleBlock('@media', value, [])]);

    expect(doc).toEqual({
      type: 'Stylesheet',
      rules: [{ type: 'AtRuleBlock', name: '@media', prelude: value, rules: [] }]
    });
  });
});
