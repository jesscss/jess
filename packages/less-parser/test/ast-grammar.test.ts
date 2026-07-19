import { parse } from '../src/ast/parse.js';

describe('private Less AST grammar facts', () => {
  it('constructs canonical import, variable, declaration, and ruleset facts directly', () => {
    const parsed = parse('@theme: "dark";\n.a { /* note */ color: red; }\n@import "theme.less";\n@-export \'tokens.less\';');

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
          type: 'Rule',
          selector: {
            type: 'SelectorList',
            selectors: [{
              type: 'Complex',
              head: { type: 'Compound', simples: [{ type: 'Simple', text: '.a', interp: null }] },
              tail: []
            }]
          },
          body: [
            { type: 'Comment', text: '/* note */' },
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'Keyword', src: 'red' },
              merge: null,
              important: false
            }
          ]
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

  it('rejects declaration forms outside the directly structured subset', () => {
    const parsed = parse('color: #f00;');

    expect(parsed.document).toBeNull();
    expect(parsed.errors).toHaveLength(1);
  });

  it('constructs child-combinator and comma-list selectors structurally', () => {
    const parsed = parse('.a > .b, #c { color: red; }');

    expect(parsed.errors).toEqual([]);
    expect(parsed.document).toEqual({
      type: 'Root',
      children: [{
        type: 'Rule',
        selector: {
          type: 'SelectorList',
          selectors: [
            {
              type: 'Complex',
              head: { type: 'Compound', simples: [{ type: 'Simple', text: '.a', interp: null }] },
              tail: [{ comb: '>', compound: { type: 'Compound', simples: [{ type: 'Simple', text: '.b', interp: null }] } }]
            },
            {
              type: 'Complex',
              head: { type: 'Compound', simples: [{ type: 'Simple', text: '#c', interp: null }] },
              tail: []
            }
          ]
        },
        body: [{
          type: 'Declaration',
          name: 'color',
          value: { type: 'Keyword', src: 'red' },
          merge: null,
          important: false
        }]
      }]
    });
  });

  it('rejects rulesets outside the directly structured selector/body subset', () => {
    const parsed = parse('.a + .b { color: red; }');

    expect(parsed.document).toBeNull();
    expect(parsed.errors).toHaveLength(1);
  });
});
