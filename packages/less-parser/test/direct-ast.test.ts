import { parse } from '../src/direct-ast.js';

describe('direct Less AST-v2 import facts', () => {
  it('constructs canonical import and variable facts without a host, bridge, or import work', () => {
    const parsed = parse('@theme: "dark";\n@import "theme.less";\n@-export \'tokens.less\';');

    expect(parsed.errors).toEqual([]);
    expect(parsed.document).toEqual({
      type: 'Root',
      children: [
        {
          type: 'VarDeclaration',
          name: 'theme',
          value: { type: 'Quoted', src: '"dark"', value: 'dark', quote: '"', escaped: false }
        },
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

  it('rejects variable values outside the directly structured subset', () => {
    const parsed = parse('@theme: dark;');

    expect(parsed.document).toBeNull();
    expect(parsed.errors).toHaveLength(1);
  });
});
