import { run } from 'parseman';
import type { Root } from '@jesscss/core/ast';
import { serialize } from '../../core/src/ast/serialize.js';
import { lessAstGrammar } from '../src/ast/grammar.js';

function isRoot(value: unknown): value is Root {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Root'
    && 'children' in value
    && Array.isArray(value.children);
}

describe('private Less AST grammar facts', () => {
  it('constructs canonical import, variable, declaration, and ruleset facts directly', () => {
    const result = run(lessAstGrammar.LessAstDocument, '@theme: "dark";\n.a { /* note */ color: red; }\n@import "theme.less";\n@-export \'tokens.less\';', { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isRoot(result.value)).toBe(true);
    expect(result.value).toEqual({
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
    const result = run(lessAstGrammar.LessAstDocument, '@import (reference) "theme.less";', { trivia: lessAstGrammar.whitespace });

    expect(result.ok && result.unconsumedFrom === null && isRoot(result.value)).toBe(false);
    expect(result.ok ? result.unconsumedFrom : result.errors).not.toBeNull();
  });

  it('constructs keyword and variable-reference values without recovering value text', () => {
    const result = run(lessAstGrammar.LessAstDocument, '@base: red;\n@theme: @base;\n.a { color: @theme; background: red; }', { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isRoot(result.value)).toBe(true);
    expect(result.value).toEqual({
      type: 'Root',
      children: [
        { type: 'VarDeclaration', name: 'base', value: { type: 'Keyword', src: 'red' } },
        { type: 'VarDeclaration', name: 'theme', value: { type: 'VarRef', name: 'base' } },
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
            { type: 'Declaration', name: 'color', value: { type: 'VarRef', name: 'theme' }, merge: null, important: false },
            { type: 'Declaration', name: 'background', value: { type: 'Keyword', src: 'red' }, merge: null, important: false }
          ]
        }
      ]
    });
  });

  it('feeds top-level and ruleset-local variable facts straight into the canonical serializer', () => {
    const result = run(lessAstGrammar.LessAstDocument, '@base: red;\n.a { @tone: @base; color: @tone; }', { trivia: lessAstGrammar.whitespace });

    if (!result.ok || result.unconsumedFrom !== null || !isRoot(result.value)) {
      throw new Error('Direct Less AST grammar did not make a Root.');
    }
    expect(serialize(result.value).css).toBe('.a {\n  color: red;\n}\n');
  });

  it('rejects declaration forms outside the directly structured subset', () => {
    const result = run(lessAstGrammar.LessAstDocument, 'color: #f00;', { trivia: lessAstGrammar.whitespace });

    expect(result.ok && result.unconsumedFrom === null && isRoot(result.value)).toBe(false);
    expect(result.ok ? result.unconsumedFrom : result.errors).not.toBeNull();
  });

  it('keeps the prior closed identifier and quoted-content subset while macro-fusing recognition', () => {
    const accepts = run(lessAstGrammar.LessAstDocument, '@base: red; -theme: blue; @import "plain.less";', { trivia: lessAstGrammar.whitespace });
    expect(accepts.ok && accepts.unconsumedFrom === null && isRoot(accepts.value)).toBe(true);

    for (const source of [
      '*color: red;',
      '\\63 olor: red;',
      'color: r\\65 d;',
      '@import "a\\"b";'
    ]) {
      const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isRoot(result.value)).toBe(false);
    }
  });

  it('constructs child-combinator and comma-list selectors structurally', () => {
    const result = run(lessAstGrammar.LessAstDocument, '.a > .b, #c { color: red; }', { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isRoot(result.value)).toBe(true);
    expect(result.value).toEqual({
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
    const result = run(lessAstGrammar.LessAstDocument, '.a + .b { color: red; }', { trivia: lessAstGrammar.whitespace });

    expect(result.ok && result.unconsumedFrom === null && isRoot(result.value)).toBe(false);
    expect(result.ok ? result.unconsumedFrom : result.errors).not.toBeNull();
  });
});
