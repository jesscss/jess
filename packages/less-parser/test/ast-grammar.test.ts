import { run } from 'parseman';
import type { Root } from '@jesscss/core/ast';
import { serialize } from '../../core/src/ast/serialize.js';
import { parseLessCst } from '../src/cst.js';
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

  it('constructs static import options, url targets, and recursively balanced tails directly', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '@import (less, multiple) url(theme.css) screen and (min-width: 600px) supports(label: "wide mode");',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isRoot(result.value)).toBe(true);
    expect(result.value).toEqual({
      type: 'Root',
      children: [{
        type: 'ImportAtRule',
        name: '@import',
        options: {
          type: 'List',
          items: [{ type: 'Any', src: 'less' }, { type: 'Any', src: 'multiple' }],
          sep: ',',
          separators: [', ']
        },
        target: { type: 'Url', value: { type: 'Any', src: 'theme.css' } },
        alias: null,
        tail: { type: 'Any', src: 'screen and (min-width: 600px) supports(label: "wide mode")' }
      }]
    });
  });

  it('rejects non-static or unbalanced import facts instead of creating opaque fallbacks', () => {
    for (const source of [
      '@import (reference) "theme.less" @{media};',
      '@import url(@{theme}.css);',
      '@import "theme.less" @media;',
      '@import "theme.less" @@media;',
      '@import "theme.less" @ {media};',
      '@import "theme.less" screen and (min-width: 600px;',
      '@import "theme.less" screen and [min-width: 600px);',
      '@import "theme.less" screen and [min-width: 600px];',
      '@import "theme.less" screen and {min-width: 600px};',
      '@import "theme.less" screen and (min-width: {600px});',
      '@import "theme.less" screen and "unterminated;',
      '@import \'theme.less\' screen and \'unterminated;',
      '@import "theme.less" screen and (min-width: 600px));',
      '@import "theme.less" screen and (min-width: 600px)};',
      '@import (unknown) "theme.less";'
    ]) {
      const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isRoot(result.value)).toBe(false);
      expect(result.ok ? result.unconsumedFrom : result.errors).not.toBeNull();
    }
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

  it('constructs static dimensions, colors, URLs, calls, and comma/space lists directly', () => {
    const source = '.a { margin: +1.5e2rem 0 -2%; color: #ff00aa; background: url(icons/a.svg); empty: url(); escaped: url(foo\\ bar); shadow: rgb(255, 0, 128),\n inset 0 1px #000; }';
    const legacy = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    // This is the same static lexical subset the existing Less grammar accepts;
    // the direct grammar receives each piece as a Parseman child and never
    // reclassifies a captured declaration string.
    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isRoot(result.value)).toBe(true);
    expect(result.value).toEqual({
      type: 'Root',
      children: [{
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
          {
            type: 'Declaration', name: 'margin', merge: null, important: false,
            value: {
              type: 'SpacedValue',
              parts: [
                { type: 'Dimension', number: 150, unit: 'rem', src: '+1.5e2rem' },
                { type: 'Dimension', number: 0, unit: '', src: '0' },
                { type: 'Dimension', number: -2, unit: '%', src: '-2%' }
              ]
            }
          },
          { type: 'Declaration', name: 'color', value: { type: 'Color', src: '#ff00aa' }, merge: null, important: false },
          {
            type: 'Declaration', name: 'background', merge: null, important: false,
            value: { type: 'Url', value: { type: 'Any', src: 'icons/a.svg' } }
          },
          {
            type: 'Declaration', name: 'empty', merge: null, important: false,
            value: { type: 'Url', value: { type: 'Any', src: '' } }
          },
          {
            type: 'Declaration', name: 'escaped', merge: null, important: false,
            value: { type: 'Url', value: { type: 'Any', src: 'foo\\ bar' } }
          },
          {
            type: 'Declaration', name: 'shadow', merge: null, important: false,
            value: {
              type: 'List', sep: ',', separators: [',\n '],
              items: [
                {
                  type: 'FunctionCall', name: 'rgb', modern: false,
                  args: [
                    { type: 'Dimension', number: 255, unit: '', src: '255' },
                    { type: 'Dimension', number: 0, unit: '', src: '0' },
                    { type: 'Dimension', number: 128, unit: '', src: '128' }
                  ]
                },
                {
                  type: 'SpacedValue',
                  parts: [
                    { type: 'Keyword', src: 'inset' },
                    { type: 'Dimension', number: 0, unit: '', src: '0' },
                    { type: 'Dimension', number: 1, unit: 'px', src: '1px' },
                    { type: 'Color', src: '#000' }
                  ]
                }
              ]
            }
          }
        ]
      }]
    });
  });

  it('does not lower dynamic URL or interpolation syntax into an incorrect static value node', () => {
    for (const source of [
      'color: @{theme};',
      'background: url(@asset);',
      'background: url(@{asset}.svg);',
      'background: url("a\\"b");',
      'background: url(foo\u0007bar);'
    ]) {
      const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

      expect(result.ok && result.unconsumedFrom === null && isRoot(result.value)).toBe(false);
      expect(result.ok ? result.unconsumedFrom : result.errors).not.toBeNull();
    }
  });

  it('retains outer list separators and rejects function separators the AST cannot represent', () => {
    const directList = run(lessAstGrammar.LessAstDocument, 'shadow: 0,\n  1px;', { trivia: lessAstGrammar.whitespace });
    expect(directList.ok).toBe(true);
    expect(directList.unconsumedFrom).toBeNull();
    expect(isRoot(directList.value)).toBe(true);
    expect(directList.value.children[0]).toEqual({
      type: 'Declaration', name: 'shadow', merge: null, important: false,
      value: {
        type: 'List', sep: ',', separators: [',\n  '],
        items: [
          { type: 'Dimension', number: 0, unit: '', src: '0' },
          { type: 'Dimension', number: 1, unit: 'px', src: '1px' }
        ]
      }
    });

    for (const source of ['shadow: rgb(1,\n2);', 'shadow: rgb(1, /* note */ 2);']) {
      const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isRoot(result.value)).toBe(false);
    }
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
