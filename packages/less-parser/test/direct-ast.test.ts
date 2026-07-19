import { parse } from '../src/direct-ast.js';

describe('direct Less AST-v2 import facts', () => {
  it('constructs a canonical ImportAtRule without a host, bridge, or import work', () => {
    const parsed = parse('@import "theme.less";\n@-export \'tokens.less\';');

    expect(parsed.errors).toEqual([]);
    expect(parsed.document).toEqual({
      type: 'Root',
      children: [
        {
          type: 'ImportAtRule',
          name: '@import',
          options: null,
          target: { type: 'Quoted', src: '"theme.less"', value: 'theme.less', quote: '"', escaped: false },
          alias: null,
          tail: null
        },
        {
          type: 'ImportAtRule',
          name: '@-export',
          options: null,
          target: { type: 'Quoted', src: '\'tokens.less\'', value: 'tokens.less', quote: '\'', escaped: false },
          alias: null,
          tail: null
        }
      ]
    });
  });

  it('rejects import forms outside the closed fact-only subset', () => {
    const parsed = parse('@import (reference) "theme.less";');

    expect(parsed.document).toBeNull();
    expect(parsed.errors).toHaveLength(1);
  });
});
