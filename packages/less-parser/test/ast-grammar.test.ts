import { run } from 'parseman';
import type { Stylesheet } from '@jesscss/core/ast';
import { serialize } from '../../core/src/ast/serialize.js';
import { parseLessCst } from '../src/cst.js';
import { lessAstGrammar } from '../src/ast/grammar.js';

function isStylesheet(value: unknown): value is Stylesheet {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Stylesheet'
    && 'children' in value
    && Array.isArray(value.children);
}

function stylesheet(value: unknown): Stylesheet {
  if (!isStylesheet(value)) {
    throw new TypeError('Expected the Less grammar to produce a Stylesheet');
  }
  return value;
}

describe('Less AST grammar facts', () => {
  it('retains a standalone root block comment before an escaped selector in source order', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '/* escaped selector note */ \\62\\6c\\6f\\63\\6b { color: silver; }',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'Comment', text: '/* escaped selector note */' },
        { type: 'Rule', body: [{ type: 'Declaration', name: 'color', value: { type: 'Color', src: 'silver' } }] }
      ]
    });
  });

  it('completes a document with final Less line-comment trivia', () => {
    const result = run(lessAstGrammar.LessAstDocument, '@tone: red; // final override\n', { trivia: lessAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ type: 'Stylesheet', children: [{ type: 'VariableDeclaration', name: 'tone' }] });
  });

  it('completes a namespaced document before terminal line-comment trivia', () => {
    const result = run(lessAstGrammar.LessAstDocument, '#ns { .m() { color: red; } }\n// compatibility note\n', { trivia: lessAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ type: 'Stylesheet', children: [{ type: 'Rule' }] });
  });

  it('keeps a generic block at-rule function prelude structural', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '@document url-prefix() { .child { color: red; } }',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock',
        name: '@document',
        prelude: { type: 'FunctionCall', name: 'url-prefix', args: [] },
        body: [{ type: 'Rule' }]
      }]
    });
  });

  it('preserves the historical doubled-quote function argument as one opaque fact', () => {
    const source = '@-x-document url-prefix(""github.com"") { h1 { color: red; } }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock',
        name: '@-x-document',
        prelude: { type: 'FunctionCall', name: 'url-prefix', args: [{ type: 'Any', src: '""github.com""' }] }
      }]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@-x-document url-prefix(""github.com"") {\n  h1 {\n    color: red;\n  }\n}\n'
    );

    const generic = run(
      lessAstGrammar.LessAstDocument,
      '@unknown custom(""github.com"") { h1 { color: red; } }',
      { trivia: lessAstGrammar.whitespace }
    );
    expect(generic.ok).toBe(true);
    expect(generic.unconsumedFrom).toBeNull();
    expect(generic.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ prelude: { type: 'FunctionCall', name: 'custom', args: [{ type: 'Any', src: '""github.com""' }] } }]
    });
  });

  it('retains a block comment immediately before a function argument comma', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '.card { background: linear-gradient(#333 /* keep */, #111); }',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [{ type: 'Declaration', value: {
        type: 'FunctionCall', name: 'linear-gradient', args: [
          [{ type: 'Color', src: '#333' }, { type: 'Comment', text: '/* keep */' }],
          { type: 'Color', src: '#111' }
        ]
      } }] }]
    });
  });

  it('keeps a CSS escape hack as a typed declaration-value suffix', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '.x { background-color: #000 \\9; }',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        body: [{
          type: 'Declaration',
          value: [{ type: 'Color', src: '#000' }, { type: 'Any', src: '\\9' }]
        }]
      }]
    });
    expect(serialize(stylesheet(result.value)).css).toBe('.x {\n  background-color: #000 \\9;\n}\n');
  });

  it('keeps a generic at-rule parenthesized group structural after ordinary terms', () => {
    const source = '@unknown foo 42 (bar) { x { y: z; } }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock',
        name: '@unknown',
        prelude: {
          type: 'SpacedValue',
          parts: [
            { type: 'Keyword', src: 'foo' },
            { type: 'Dimension', src: '42' },
            { type: 'Block', delimiter: 'paren', inner: { type: 'Keyword', src: 'bar' } }
          ]
        }
      }]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@unknown foo 42 (bar) {\n  x {\n    y: z;\n  }\n}\n'
    );
  });

  it('keeps @page pseudo-pages as one typed header atom', () => {
    const source = '@page :first { margin: 3cm; }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'AtRuleBlock', name: '@page', prelude: { type: 'Any', src: ':first' } }]
    });
    expect(serialize(stylesheet(result.value)).css).toBe('@page :first {\n  margin: 3cm;\n}\n');
  });

  it('constructs static Less selector captures as existing selector-valued facts', () => {
    const source = '@targets: *[.notice, .card:not(.muted, .disabled):nth-child(-n+2), .tail:nth-child(2n+1)];';
    const cst = parseLessCst(source);
    const direct = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'VariableDeclaration',
        name: 'targets',
        value: {
          type: 'SelectorCapture',
          branches: ['.notice', '.card:not(.muted,.disabled):nth-child(-n+2)', '.tail:nth-child(2n+1)'],
          src: '*[.notice, .card:not(.muted,.disabled):nth-child(-n+2), .tail:nth-child(2n+1)]'
        }
      }]
    });

    for (const invalid of [
      '@targets: *[@{selector}];',
      '@targets: *[.card-@{tone}];',
      '@targets: *[.card:not(@{tone})];',
      '@targets: * [.notice];'
    ]) {
      const rejected = run(lessAstGrammar.LessAstDocument, invalid, { trivia: lessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null && isStylesheet(rejected.value), invalid).toBe(false);
    }
  });

  it('lowers Less each() callbacks into canonical Jess-shaped For bindings', () => {
    const source = 'each(@items, .(@entry) { value: @entry; });\neach(@items, .(@item, @key, @index) { value: @item; key: @key; index: @index; });\neach(@items, { value: @value; key: @key; index: @index; });';
    const legacy = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toEqual({
      type: 'Stylesheet',
      children: [
        {
          type: 'For',
          iterable: { type: 'VariableReference', name: 'items', lookup: 'scoped' },
          binding: { kind: 'single', name: 'entry' },
          rules: [
            { type: 'Declaration', name: 'value', value: { type: 'VariableReference', name: 'entry', lookup: 'scoped' }, merge: null, important: false }
          ]
        },
        {
          type: 'For',
          iterable: { type: 'VariableReference', name: 'items', lookup: 'scoped' },
          binding: { kind: 'comma', names: ['item', 'key', 'index'] },
          rules: [
            { type: 'Declaration', name: 'value', value: { type: 'VariableReference', name: 'item', lookup: 'scoped' }, merge: null, important: false },
            { type: 'Declaration', name: 'key', value: { type: 'VariableReference', name: 'key', lookup: 'scoped' }, merge: null, important: false },
            { type: 'Declaration', name: 'index', value: { type: 'VariableReference', name: 'index', lookup: 'scoped' }, merge: null, important: false }
          ]
        },
        {
          type: 'For',
          iterable: { type: 'VariableReference', name: 'items', lookup: 'scoped' },
          binding: { kind: 'comma', names: ['value', 'key', 'index'] },
          rules: [
            { type: 'Declaration', name: 'value', value: { type: 'VariableReference', name: 'value', lookup: 'scoped' }, merge: null, important: false },
            { type: 'Declaration', name: 'key', value: { type: 'VariableReference', name: 'key', lookup: 'scoped' }, merge: null, important: false },
            { type: 'Declaration', name: 'index', value: { type: 'VariableReference', name: 'index', lookup: 'scoped' }, merge: null, important: false }
          ]
        }
      ]
    });
  });

  it('accepts hash-prefixed Less each() callbacks as the same canonical For binding', () => {
    const source = 'each(@items, #(@item, @key) { value: @item; key: @key; });';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'For',
        iterable: { type: 'VariableReference', name: 'items', lookup: 'scoped' },
        binding: { kind: 'comma', names: ['item', 'key', undefined] },
        rules: [
          { type: 'Declaration', name: 'value', value: { type: 'VariableReference', name: 'item', lookup: 'scoped' } },
          { type: 'Declaration', name: 'key', value: { type: 'VariableReference', name: 'key', lookup: 'scoped' } }
        ]
      }]
    });
  });

  it('accepts semicolon-separated anonymous each() callback bindings', () => {
    const source = '.entry { each(a b, .(@value; @index) { item-@{index}: @value; }); }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      children: [{ body: [{
        type: 'For',
        binding: { kind: 'comma', names: ['value', 'index', undefined] }
      }] }]
    });
  });

  it('lowers a flat static mixin call iterable into the existing For iterable fact', () => {
    const source = '.values() { first: red; second: blue; } each(.values(), .(@value, @key) { .item { value: @value; key: @key; } });';
    const cst = parseLessCst(source);
    const direct = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'MixinDef', name: '.values' },
        { type: 'For', iterable: { type: 'MixinCall', name: '.values', args: [], path: [] }, binding: { kind: 'comma', names: ['value', 'key', undefined] }, rules: [{ type: 'Rule' }] }
      ]
    });
  });

  it('lowers a static namespaced mixin-call iterable through the existing MixinCall path fact', () => {
    const source = '.library { .values() { first: red; second: blue; } } each(.library > .values(), .(@value, @key) { .item { value: @value; key: @key; } });';
    const cst = parseLessCst(source);
    const direct = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'Rule', selector: { selectors: [{ head: { simples: [{ text: '.library' }] } }] }, body: [{ type: 'MixinDef', name: '.values' }] },
        { type: 'For', iterable: { type: 'MixinCall', name: '.values', args: [], path: [{ comb: ' ', sel: '.library' }] }, binding: { kind: 'comma', names: ['value', 'key', undefined] }, rules: [{ type: 'Rule' }] }
      ]
    });
    expect(isStylesheet(direct.value)).toBe(true);
    if (!isStylesheet(direct.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(direct.value)).toEqual({
      css: '.item {\n  value: red;\n  key: first;\n}\n.item {\n  value: blue;\n  key: second;\n}\n'
    });
  });

  it('keeps dynamic, important, and semicolon namespaced mixin-call iterables out of the direct route', () => {
    for (const source of [
      'each(.library > .@{name}(), { color: red; });',
      'each(.library > .values() !important, { color: red; });',
      'each(.library > .values();, { color: red; });'
    ]) {
      const direct = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), source).toBe(false);
    }
  });

  it('lowers a flat static mixin call variable value into the existing callable binding fact', () => {
    const source = '.make-map() { tone: blue; } @map: .make-map(red, @tone: blue);';
    const cst = parseLessCst(source);
    const direct = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'MixinDef', name: '.make-map' },
        { type: 'VariableDeclaration', name: 'map', value: { type: 'MixinCall', name: '.make-map', args: [{ value: { src: 'red' } }, { name: 'tone', value: { src: 'blue' } }], path: [], important: false } }
      ]
    });
  });

  it('drops only authored empty statements from simple and named each callbacks', () => {
    const source = 'each(1, { ; value: @value; ; }); each(2, .(@entry) { ; value: @entry; ; });';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'For', binding: { kind: 'comma', names: ['value', 'key', 'index'] }, rules: [{ type: 'Declaration', name: 'value' }] },
        { type: 'For', binding: { kind: 'single', name: 'entry' }, rules: [{ type: 'Declaration', name: 'value' }] }
      ]
    });
  });

  it('retains the existing typed keyframes fact in detached-ruleset and each callback bodies', () => {
    const source = '@theme: { @keyframes fade { from { opacity: 0; } } }; each(1, { @-webkit-keyframes "slide" { 50% { opacity: @value; } } });';
    const cst = parseLessCst(source);
    const direct = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', value: { type: 'DetachedRuleset', body: [{ type: 'AtRuleBlock', name: '@keyframes', body: [{ type: 'Rule' }] }] } },
        { type: 'For', rules: [{ type: 'AtRuleBlock', name: '@-webkit-keyframes', prelude: { type: 'Quoted', value: 'slide' }, body: [{ type: 'Rule' }] }] }
      ]
    });
  });

  it('constructs canonical import, variable, declaration, and ruleset facts directly', () => {
    const result = run(lessAstGrammar.LessAstDocument, '@theme: "dark";\n.a { /* note */ color: red; }\n@import "theme.less";\n@-export \'tokens.less\';', { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(result.value).toEqual({
      type: 'Stylesheet',
      children: [
        {
          type: 'VariableDeclaration',
          name: 'theme',
          value: { type: 'Quoted', src: '"dark"', value: 'dark', quote: '"', escaped: false },
          write: { mode: 'declare' }
        },
        {
          type: 'Rule',
          selector: {
            type: 'SelectorList',
            selectors: [{
              type: 'ComplexSelector',
              head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.a', interp: null }] },
              tail: []
            }]
          },
          body: [
            { type: 'Comment', text: '/* note */' },
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'Color', src: 'red' },
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

  it('constructs an indirect variable as a typed two-step reference and evaluates it', () => {
    const source = '@name: tone; @tone: red; .card { color: @@name; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'name' },
        { type: 'VariableDeclaration', name: 'tone' },
        {
          type: 'Rule', body: [{
            type: 'Declaration', name: 'color', value: {
              type: 'VarIndirect', nameRef: { type: 'VariableReference', name: 'name', lookup: 'scoped' }, lookup: 'scoped'
            }
          }]
        }
      ]
    });
    if (!isStylesheet(result.value)) {
      throw new TypeError('Expected a direct Less Stylesheet.');
    }
    expect(serialize(result.value).css).toBe(
      '.card {\n  color: red;\n}\n'
    );
  });

  it('constructs precedence-aware Less arithmetic without widening slash-list semantics', () => {
    const source = '@a: 2; .math { sum: 1 + 2 * 3; grouped: (1 + 2) * 3; neg: -(@a + 1); signed: -2px + 3px; ratio: 12px / 1.5; compact: 1 +2; spacedMinus: 1 -23; calc: calc(100% - (20px / 2)); }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'a' },
        { type: 'Rule', body: [
          {
            type: 'Declaration', name: 'sum', value: {
              type: 'Operation', operator: '+', left: { type: 'Dimension', src: '1' },
              right: {
                type: 'Operation', operator: '*', left: { type: 'Dimension', src: '2' }, right: { type: 'Dimension', src: '3' }
              }
            }
          },
          {
            type: 'Declaration', name: 'grouped', value: {
              type: 'Operation', operator: '*', left: {
                type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: '+' }
              }, right: { type: 'Dimension', src: '3' }
            }
          },
          {
            type: 'Declaration', name: 'neg', value: {
              type: 'Operation', operator: '*', left: { type: 'Dimension', src: '-1' },
              right: { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: '+' } }
            }
          },
          {
            type: 'Declaration', name: 'signed', value: {
              type: 'Operation', operator: '+', left: { type: 'Dimension', src: '-2px' }, right: { type: 'Dimension', src: '3px' }
            }
          },
          {
            type: 'Declaration', name: 'ratio', value: [{ type: 'Dimension', src: '12px' }, { type: 'Keyword', src: '/' }, { type: 'Dimension', src: '1.5' }]
          },
          {
            type: 'Declaration', name: 'compact', value: [{ type: 'Dimension', src: '1' }, { type: 'Dimension', src: '+2' }]
          },
          {
            type: 'Declaration', name: 'spacedMinus', value: [{ type: 'Dimension', src: '1' }, { type: 'Dimension', src: '-23' }]
          },
          {
            type: 'Declaration', name: 'calc', value: {
              type: 'FunctionCall', name: 'calc', args: [{ type: 'Operation', operator: '-' }]
            }
          }
        ]
        }
      ]
    });
    if (!isStylesheet(result.value)) {
      throw new TypeError('Expected a direct Less Stylesheet.');
    }
    // Serialization without a ValueEvaluator is deliberately structural; this
    // assertion proves the direct tree has not turned Less math into raw text.
    expect(serialize(result.value).css).toContain('sum: 1 + 2 * 3;');
    expect(serialize(result.value).css).toContain('grouped: (1 + 2) * 3;');
    expect(serialize(result.value).css).toContain('ratio: 12px / 1.5;');
    expect(serialize(result.value).css).toContain('compact: 1 +2;');
  });

  it('keeps comment-aware product operators as one flat arithmetic stream', () => {
    const source = '.math { product: 2 * // factor\n 3; modulo: 7 // divisor follows\n % 3; }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'product', value: { type: 'Operation', operator: '*', left: { type: 'Dimension', src: '2' }, right: { type: 'Dimension', src: '3' } } },
        { type: 'Declaration', name: 'modulo', value: { type: 'Operation', operator: '%', left: { type: 'Dimension', src: '7' }, right: { type: 'Dimension', src: '3' } } }
      ] }]
    });
    if (!isStylesheet(result.value)) {
      throw new TypeError('Expected a direct Less Stylesheet.');
    }
    expect(serialize(result.value).css).toBe('.math {\n  product: 2 * 3;\n  modulo: 7 % 3;\n}\n');

    const malformed = run(lessAstGrammar.LessAstDocument, '.math { product: 2 * // missing operand\n; }', { trivia: lessAstGrammar.whitespace });
    expect(malformed.ok && malformed.unconsumedFrom === null).toBe(false);
  });

  it('keeps the comments2 variable/parens product on the same math route', () => {
    const source = '@column-width: @base * 6em; @columns: 12; @gridsystem-width: (@column-width * // total columns */\n @columns) + ( // width */\n @gutter-width * // gutters */\n @columns);';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    if (!isStylesheet(result.value)) {
      throw new TypeError('Expected a direct Less Stylesheet.');
    }
    expect(result.value.children.find(child => child.type === 'VariableDeclaration' && child.name === 'gridsystem-width')).toMatchObject({
      value: { type: 'Operation', operator: '+' }
    });
  });

  it('keeps a glued top-level Less slash group structural for later calc evaluation', () => {
    const source = '@ratio: 50vh/2; .card { direct: @ratio; calc: calc(100% - (@ratio - 20px)); }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(result.value.children[0]).toMatchObject({
      type: 'VariableDeclaration', name: 'ratio',
      value: [{ type: 'Dimension', src: '50vh' }, { type: 'Keyword', src: '/' }, { type: 'Dimension', src: '2' }]
    });
    expect(serialize(result.value).css).toBe(
      '.card {\n  direct: 50vh / 2;\n  calc: calc(100% - (50vh / 2 - 20px));\n}\n'
    );
  });

  it('left-factors preserved slash value pieces without changing their direct AST facts', () => {
    const source = [
      '@trivia: 12px / 1.5 / 3;',
      '.case {',
      '  bare: 12px;',
      '  slash: 12px/1.5;',
      '  multi: 12px/1.5/3;',
      '  function: min(12px/1.5/3, 2px);',
      '}'
    ].join('\n');
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [
        {
          type: 'VariableDeclaration', name: 'trivia', value: {
            type: 'SpacedValue',
            parts: [
              { type: 'Dimension', src: '12px' }, { type: 'Keyword', src: '/' }, { type: 'Dimension', src: '1.5' },
              { type: 'Keyword', src: '/' }, { type: 'Dimension', src: '3' }
            ],
            separators: [' ', ' ', ' ', ' ']
          }
        },
        {
          type: 'Rule', body: [
            { type: 'Declaration', name: 'bare', value: { type: 'Dimension', src: '12px' } },
            {
              type: 'Declaration', name: 'slash', value: [
                { type: 'Dimension', src: '12px' }, { type: 'Keyword', src: '/' }, { type: 'Dimension', src: '1.5' }
              ]
            },
            {
              type: 'Declaration', name: 'multi', value: [
                { type: 'Dimension', src: '12px' }, { type: 'Keyword', src: '/' }, { type: 'Dimension', src: '1.5' },
                { type: 'Keyword', src: '/' }, { type: 'Dimension', src: '3' }
              ]
            },
            {
              type: 'Declaration', name: 'function', value: {
                type: 'FunctionCall', name: 'min', args: [{ type: 'Operation' }, { type: 'Dimension', src: '2px' }]
              }
            }
          ]
        }
      ]
    });

    const malformed = run(
      lessAstGrammar.LessAstDocument,
      '.case { malformed: 12px / * 2px; }',
      { trivia: lessAstGrammar.whitespace }
    );
    expect(malformed.ok && malformed.unconsumedFrom === null).toBe(false);
  });

  it('constructs zero-argument variable calls as final Reference steps directly', () => {
    const source = '@theme(); .card { @theme(); }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'Reference', base: { type: 'VariableReference', name: 'theme', lookup: 'scoped' }, steps: [{ type: 'Call', args: [] }], raw: '@theme()' },
        { type: 'Rule', body: [{ type: 'Reference', base: { type: 'VariableReference', name: 'theme', lookup: 'scoped' }, steps: [{ type: 'Call', args: [] }], raw: '@theme()' }] }
      ]
    });
  });

  it('constructs bare function-call statements as existing FunctionCall facts', () => {
    const source = 'e("x"); .card { e("y"); }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'FunctionCall', name: 'e', args: [{ type: 'Quoted', value: 'x' }] },
        { type: 'Rule', body: [{ type: 'FunctionCall', name: 'e', args: [{ type: 'Quoted', value: 'y' }] }] }
      ]
    });
  });

  it('constructs deprecated Less percent-format syntax as the existing percent FunctionCall', () => {
    const source = '.card { text: %("hello %s", "world"); modulo: 10 % 3; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'text', value: { type: 'FunctionCall', name: '%', args: [{ type: 'Quoted', value: 'hello %s' }, { type: 'Quoted', value: 'world' }] } },
        { type: 'Declaration', name: 'modulo', value: { type: 'Operation', operator: '%' } }
      ] }]
    });
    for (const invalid of ['.card { text: %foo; }', '.card { text: %("x",); }']) {
      const direct = run(lessAstGrammar.LessAstDocument, invalid, { trivia: lessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, invalid).toBe(false);
    }
  });

  it('keeps a static Less escaped quote inside percent-format arguments', () => {
    const source = '.card { text: %(~"hello %s", "world"); }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [{
        type: 'Declaration', value: {
          type: 'FunctionCall', name: '%', args: [
            { type: 'Quoted', value: 'hello %s', escaped: true },
            { type: 'Quoted', value: 'world' }
          ]
        }
      }] }]
    });
  });

  it('constructs static body and inline extends with exact/all multi-target semantics', () => {
    const source = '.target { color: navy; } .body { &:extend(.target, .other !all); } .first, .inline:extend(.target all), .sibling { color: red; }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'Rule', selector: { type: 'SelectorList' } },
        { type: 'Rule', extendInstructions: [
          { target: { type: 'SelectorList' }, partial: false },
          { target: { type: 'SelectorList' }, partial: true }
        ] },
        { type: 'Rule', selector: { type: 'SelectorList', selectors: [{ type: 'ComplexSelector' }, { type: 'ComplexSelector' }, { type: 'ComplexSelector' }] }, extendInstructions: [
          { target: { type: 'SelectorList' }, partial: true, subject: { type: 'SelectorList', selectors: [{ type: 'ComplexSelector' }] } }
        ] }
      ]
    });
  });

  it('keeps a repeated inline extend selector list as branch-owned instructions', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '.ext3:extend(.foo all), .ext4:extend(.foo all) {}',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: {
          type: 'SelectorList',
          selectors: [
            { type: 'ComplexSelector', head: { simples: [{ text: '.ext3' }] } },
            { type: 'ComplexSelector', head: { simples: [{ text: '.ext4' }] } }
          ]
        },
        extendInstructions: [
          { partial: true, target: { selectors: [{ head: { simples: [{ text: '.foo' }] } }] }, subject: { selectors: [{ head: { simples: [{ text: '.ext3' }] } }] } },
          { partial: true, target: { selectors: [{ head: { simples: [{ text: '.foo' }] } }] }, subject: { selectors: [{ head: { simples: [{ text: '.ext4' }] } }] } }
        ]
      }]
    });
  });

  it('stops direct extend targets before terminal all and !all flags', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '.subject { &:extend(.a .b all, .c > .d !all); color: black; }',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{
        type: 'Rule', extendInstructions: [
          { partial: true, target: { selectors: [{ head: { simples: [{ text: '.a' }] }, tail: [{ comb: ' ', compound: { simples: [{ text: '.b' }] } }] }] } },
          { partial: true, target: { selectors: [{ head: { simples: [{ text: '.c' }] }, tail: [{ comb: '>', compound: { simples: [{ text: '.d' }] } }] }] } }
        ]
      }]
    });
    expect(serialize(stylesheet(result.value)).css).toBe('.subject {\n  color: black;\n}\n');
  });

  it('uses the ordinary direct statement body inside an inline extend rule', () => {
    const source = '.paint() { color: red; } .target { width: 1px; } .inline:extend(.target) { .paint(); each(1, { order: @value; }); @media screen { display: block; } }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'MixinDef', name: '.paint' },
        { type: 'Rule' },
        { type: 'Rule', extendInstructions: [{ target: { type: 'SelectorList' } }], body: [
          { type: 'MixinCall', name: '.paint' },
          { type: 'For' },
          { type: 'AtRuleBlock', name: '@media' }
        ] }
      ]
    });
  });

  it('accepts an optional statement terminator after an inline extend ruleset', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '.target { color: navy; } .alias:extend(.target) {};',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule' }, { type: 'Rule' }]
    });
  });

  it('constructs recursively grammar-built detached-ruleset variable bindings directly', () => {
    const source = '@theme: { ; @accent: blue; color: @accent; ; };';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'VariableDeclaration', name: 'theme',
        value: {
          type: 'DetachedRuleset',
          body: [
            { type: 'VariableDeclaration', name: 'accent', value: { type: 'Color', src: 'blue' } },
            { type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'accent' } }
          ]
        }
      }]
    });
  });

  it('retains numeric detached-ruleset map keys as declaration facts', () => {
    const source = '@grays: { 100: #f8f9fa; 900: #212529; <: %3c; #: %23; (: %28; };';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'VariableDeclaration', name: 'grays',
        value: {
          type: 'DetachedRuleset',
          body: [
            { type: 'Declaration', name: '100', value: { type: 'Color', src: '#f8f9fa' } },
            { type: 'Declaration', name: '900', value: { type: 'Color', src: '#212529' } },
            { type: 'Declaration', name: '<' },
            { type: 'Declaration', name: '#' },
            { type: 'Declaration', name: '(' }
          ]
        }
      }]
    });
  });

  it('constructs full direct statement bodies in detached rulesets and each callbacks', () => {
    const source = '@theme: { .nested { color: red; } @media screen { .media { color: blue; } } .tone() { color: green; } each(1, { .item { order: @value; } }); };\neach(1, .(@entry) { .entry { order: @entry; } @media print { .print { color: black; } } });';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        {
          type: 'VariableDeclaration', name: 'theme',
          value: {
            type: 'DetachedRuleset',
            body: [
              { type: 'Rule', body: [{ type: 'Declaration', name: 'color' }] },
              { type: 'AtRuleBlock', name: '@media', body: [{ type: 'Rule' }] },
              { type: 'MixinDef', name: '.tone', body: [{ type: 'Declaration', name: 'color' }] },
              { type: 'For', rules: [{ type: 'Rule', body: [{ type: 'Declaration', name: 'order' }] }] }
            ]
          }
        },
        {
          type: 'For', binding: { kind: 'single', name: 'entry' },
          rules: [
            { type: 'Rule', body: [{ type: 'Declaration', name: 'order' }] },
            { type: 'AtRuleBlock', name: '@media', body: [{ type: 'Rule' }] }
          ]
        }
      ]
    });
  });

  it('keeps standalone extend statements out of direct detached and callback bodies until they have a statement fact', () => {
    for (const source of [
      '@theme: { &:extend(.target); };',
      'each(1, { &:extend(.target); });'
    ]) {
      const cst = parseLessCst(source);
      const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('retains argument-bearing variable calls as typed final Reference steps', () => {
    const source = '@theme(red);';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value)).toBe(true);
    expect(result.value).toMatchObject({
      children: [{ type: 'Reference', base: { type: 'VariableReference', name: 'theme', lookup: 'scoped' }, steps: [{ type: 'Call', args: [{ value: { type: 'Color', src: 'red' } }] }] }]
    });
  });

  it('uses detached rulesets only in public call-argument and parameter-default positions', () => {
    const source = '@theme: { color: red; }; .m(@default: { width: 1px; }) { } .m({ color: blue; }); .m(@named: { color: green; }); fn({ display: block; });';
    const cst = parseLessCst(source);
    const direct = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'VariableDeclaration', name: 'theme', value: { type: 'DetachedRuleset', body: [{ type: 'Declaration', name: 'color' }] } },
        { type: 'MixinDef', name: '.m', params: [{ name: 'default', default: { type: 'DetachedRuleset', body: [{ type: 'Declaration', name: 'width' }] } }] },
        { type: 'MixinCall', name: '.m', args: [{ value: { type: 'DetachedRuleset', body: [{ type: 'Declaration', name: 'color' }] } }] },
        { type: 'MixinCall', name: '.m', args: [{ name: 'named', value: { type: 'DetachedRuleset', body: [{ type: 'Declaration', name: 'color' }] } }] },
        { type: 'FunctionCall', name: 'fn', args: [{ type: 'DetachedRuleset', body: [{ type: 'Declaration', name: 'display' }] }] }
      ]
    });

    const valueArgument = run(lessAstGrammar.LessAstDocument, 'value: fn({ color: red; });', { trivia: lessAstGrammar.whitespace });
    expect(valueArgument.ok).toBe(true);
    expect(valueArgument.unconsumedFrom).toBeNull();
    expect(valueArgument.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Declaration', name: 'value', value: {
        type: 'FunctionCall', name: 'fn', args: [{ type: 'DetachedRuleset', body: [{ type: 'Declaration', name: 'color' }] }]
      } }]
    });

    for (const rejected of ['value: { color: red; };', 'value: %({ color: red; });']) {
      const legacy = parseLessCst(rejected);
      const result = run(lessAstGrammar.LessAstDocument, rejected, { trivia: lessAstGrammar.whitespace });
      expect(legacy.unconsumedFrom, rejected).not.toBeNull();
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), rejected).toBe(false);
    }

    // Punctuation map keys are direct declaration facts, never an opaque
    // detached-body recovery path.
    const rawDetachedBody = '@theme: { <: %3c; };';
    const rawLegacy = parseLessCst(rawDetachedBody);
    const rawDirect = run(lessAstGrammar.LessAstDocument, rawDetachedBody, { trivia: lessAstGrammar.whitespace });
    expect(rawLegacy.errors).toHaveLength(0);
    expect(rawLegacy.unconsumedFrom).toBeNull();
    expect(rawDirect.ok).toBe(true);
    expect(rawDirect.unconsumedFrom).toBeNull();
    expect(rawDirect.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'VariableDeclaration', name: 'theme', value: {
        type: 'DetachedRuleset', body: [{ type: 'Declaration', name: '<', value: { type: 'Any', src: '%3c' } }]
      } }]
    });
    const nestedConditionalArgument = run(
      lessAstGrammar.LessAstDocument,
      '.m({ @media (tv) { color: black; } });',
      { trivia: lessAstGrammar.whitespace }
    );
    expect(nestedConditionalArgument.ok).toBe(true);
    expect(nestedConditionalArgument.unconsumedFrom).toBeNull();
  });

  it('constructs static import options, url targets, and recursively balanced tails directly', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '@import (less, multiple) url(theme.css) screen and (min-width: 600px) supports(label: "wide mode");',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(result.value).toEqual({
      type: 'Stylesheet',
      children: [{
        type: 'ImportAtRule',
        name: '@import',
        options: {
          type: 'List',
          value: [{ type: 'Any', src: 'less' }, { type: 'Any', src: 'multiple' }],
          sep: ','
        },
        target: { type: 'Url', value: { type: 'Any', src: 'theme.css' } },
        alias: null,
        tail: { type: 'Any', src: 'screen and (min-width: 600px) supports(label: "wide mode")' }
      }]
    });
  });

  it('constructs a variable-bearing import query tail without an opaque tail fallback', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '@var: 100px; @import url("//ha.com/file.css") (min-width:@var);',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'var' },
        {
          type: 'ImportAtRule',
          target: { type: 'Url', value: { type: 'Quoted', value: '//ha.com/file.css' } },
          tail: {
            type: 'Block', delimiter: 'paren',
            inner: {
              type: 'Operation', operator: ':',
              left: { type: 'Keyword', src: 'min-width' },
              right: { type: 'VariableReference', name: 'var', lookup: 'scoped' }
            }
          }
        }
      ]
    });
  });

  it('constructs quoted Less import interpolation as a structural target fact', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '@import (less, multiple) "theme-@{name}.css" screen;',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'ImportAtRule',
        options: { type: 'List', sep: ',', value: [{ type: 'Any', src: 'less' }, { type: 'Any', src: 'multiple' }] },
        target: {
          type: 'Interpolation',
          parts: [
            { lit: '"theme-' },
            { ref: { type: 'VariableReference', name: 'name' }, unquote: true },
            { lit: '.css"' }
          ]
        },
        tail: { type: 'Any', src: 'screen' }
      }]
    });
  });

  it('constructs one complete interpolated import tail as a structural fact', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '@import (reference) "theme.less" @{media};',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'ImportAtRule',
        options: { type: 'List', sep: ',', value: [{ type: 'Any', src: 'reference' }] },
        target: { type: 'Quoted', value: 'theme.less' },
        tail: {
          type: 'Interpolation',
          parts: [{ ref: { type: 'VariableReference', name: 'media', lookup: 'scoped' }, unquote: true }]
        }
      }]
    });
  });

  it('constructs unquoted dynamic URL values and import targets as typed interpolation', () => {
    const source = '@asset: icons; @theme: theme; .asset { variable: url(@asset/path.svg); template: url(@{theme}/icon.svg); } @import url(@{theme}.css);';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'asset' },
        { type: 'VariableDeclaration', name: 'theme' },
        { type: 'Rule', body: [
          { type: 'Declaration', name: 'variable', value: { type: 'Url', value: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'asset' } }, { lit: '/path.svg' }] } } },
          { type: 'Declaration', name: 'template', value: { type: 'Url', value: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'theme' } }, { lit: '/icon.svg' }] } } }
        ] },
        { type: 'ImportAtRule', target: { type: 'Url', value: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'theme' } }, { lit: '.css' }] } } }
      ]
    });
  });

  it('keeps invalid interpolation-shaped quoted import text literal', () => {
    for (const source of [
      '@import "theme-@{bad.path}.css";',
      '@import "theme-@{ x }.css";',
      '@import "theme-@{}.css";'
    ]) {
      const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(true);
      expect(result.value).toMatchObject({
        children: [{ type: 'ImportAtRule', target: { type: 'Quoted' } }]
      });
    }
  });

  it('rejects non-static or unbalanced import facts instead of creating opaque fallbacks', () => {
    for (const source of [
      '@import "theme-@{name}.css;',
      '@import "theme.less" @media;',
      '@import "theme.less" @@media;',
      '@import "theme.less" @ {media};',
      '@import "theme.less" @{media} screen;',
      '@import "theme.less" screen @{media};',
      '@import "theme.less" @{media}@{print};',
      '@import "theme.less" ${media};',
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
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value)).toBe(false);
      expect(result.ok ? result.unconsumedFrom : result.errors).not.toBeNull();
    }
  });

  it('constructs keyword and variable-reference values without recovering value text', () => {
    const result = run(lessAstGrammar.LessAstDocument, '@base: red;\n@theme: @base;\n.a { color: @theme; background: red; }', { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(result.value).toEqual({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'base', value: { type: 'Color', src: 'red' }, write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'theme', value: { type: 'VariableReference', name: 'base', lookup: 'scoped' }, write: { mode: 'declare' } },
        {
          type: 'Rule',
          selector: {
            type: 'SelectorList',
            selectors: [{
              type: 'ComplexSelector',
              head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.a', interp: null }] },
              tail: []
            }]
          },
          body: [
            { type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'theme', lookup: 'scoped' }, merge: null, important: false },
            { type: 'Declaration', name: 'background', value: { type: 'Color', src: 'red' }, merge: null, important: false }
          ]
        }
      ]
    });
  });

  it('feeds top-level and ruleset-local variable facts straight into the canonical serializer', () => {
    const result = run(lessAstGrammar.LessAstDocument, '@base: red;\n.a { @tone: @base; color: @tone; }', { trivia: lessAstGrammar.whitespace });

    if (!result.ok || result.unconsumedFrom !== null || !isStylesheet(result.value)) {
      throw new Error('Direct Less AST grammar did not make a Stylesheet.');
    }
    expect(serialize(result.value).css).toBe('.a {\n  color: red;\n}\n');
  });

  it('constructs a commented multiline comma-list variable value with a trailing comma', () => {
    const source = '.items { @values:\n  // fruit\n  apple,\n  banana,\n; }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        body: [{
          type: 'VariableDeclaration',
          name: 'values',
          value: {
            type: 'List', sep: ',',
            value: [{ type: 'Keyword', src: 'apple' }, { type: 'Keyword', src: 'banana' }]

          }
        }]
      }]
    });
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
    expect(isStylesheet(result.value)).toBe(true);
    expect(result.value).toEqual({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: {
          type: 'SelectorList',
          selectors: [{
            type: 'ComplexSelector',
            head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.a', interp: null }] },
            tail: []
          }]
        },
        body: [
          {
            type: 'Declaration', name: 'margin', merge: null, important: false,
            value: [
              { type: 'Dimension', number: 150, unit: 'rem', src: '+1.5e2rem' },
              { type: 'Dimension', number: 0, unit: '', src: '0' },
              { type: 'Dimension', number: -2, unit: '%', src: '-2%' }
            ]
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
              type: 'List', sep: ',',
              value: [
                {
                  type: 'FunctionCall', name: 'rgb', modern: false,
                  args: [
                    { type: 'Dimension', number: 255, unit: '', src: '255' },
                    { type: 'Dimension', number: 0, unit: '', src: '0' },
                    { type: 'Dimension', number: 128, unit: '', src: '128' }
                  ]
                },
                [
                  { type: 'Keyword', src: 'inset' },
                  { type: 'Dimension', number: 0, unit: '', src: '0' },
                  { type: 'Dimension', number: 1, unit: 'px', src: '1px' },
                  { type: 'Color', src: '#000' }
                ]
              ]
            }
          }
        ]
      }]
    });
  });

  it('constructs a bare percent sign as a keyword function argument', () => {
    const source = 'size: unit(100, %);';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Declaration', value: { type: 'FunctionCall', name: 'unit', args: [
        { type: 'Dimension', src: '100' }, { type: 'Keyword', src: '%' }
      ] } }]
    });
    const serializable = run(lessAstGrammar.LessAstDocument, `.test { ${source} }`, { trivia: lessAstGrammar.whitespace });
    expect(serializable.ok).toBe(true);
    expect(serializable.unconsumedFrom).toBeNull();
    expect(serialize(stylesheet(serializable.value)).css).toBe('.test {\n  size: unit(100, %);\n}\n');
  });

  it('constructs a comparison condition in a Less function argument', () => {
    const full = run(lessAstGrammar.LessAstDocument, '#boolean { a: boolean(not(2 < 1)); b: boolean(not(2 > 1) and (true)); c: boolean(not(boolean(true))); }', { trivia: lessAstGrammar.whitespace });
    expect(full.ok).toBe(true);
    expect(full.unconsumedFrom).toBeNull();
    const result = run(lessAstGrammar.LessAstDocument, 'x: boolean(not(2 < 1));', { trivia: lessAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ children: [{ value: { args: [{ type: 'Condition', guard: { g: 'not', inner: { g: 'cmp', op: '<' } } }] } }] });
  });

  it('constructs a truth condition in a multi-argument Less function call', () => {
    const result = run(lessAstGrammar.LessAstDocument, 'x: if(not(false), 1, 2);', { trivia: lessAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
  });

  it('constructs arithmetic inside Less function arguments as an operation', () => {
    const result = run(lessAstGrammar.LessAstDocument, 'x: round(32 / 3);', { trivia: lessAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      children: [{ value: { type: 'FunctionCall', name: 'round', args: [{ type: 'Operation', operator: '/' }] } }]
    });
  });

  it('retains an inter-argument block comment in the preceding typed function argument', () => {
    const source = 'x: mix(blue, #FFF /* explanation */, 50%);';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      children: [{ value: { type: 'FunctionCall', name: 'mix', args: [
        { type: 'Color', src: 'blue' },
        [{ type: 'Color', src: '#FFF' }, { type: 'Comment', text: '/* explanation */' }],
        { type: 'Dimension', src: '50%' }
      ] } }]
    });
    const serializable = run(lessAstGrammar.LessAstDocument, `.test { ${source} }`, { trivia: lessAstGrammar.whitespace });
    expect(serializable.ok).toBe(true);
    expect(serializable.unconsumedFrom).toBeNull();
    expect(serialize(stylesheet(serializable.value)).css).toBe('.test {\n  x: mix(blue, #FFF /* explanation */, 50%);\n}\n');
  });

  it('keeps a generic function argument as one space-separated value slot after its comma boundary', () => {
    const source = 'grid-template-columns: repeat(14, 10px /* gap */ 60px);';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ value: { type: 'FunctionCall', name: 'repeat', args: [
        { type: 'Dimension', src: '14' },
        [
          { type: 'Dimension', src: '10px' },
          { type: 'Comment', text: '/* gap */' },
          { type: 'Dimension', src: '60px' }
        ]
      ] } }]
    });
    const serializable = run(lessAstGrammar.LessAstDocument, `.test { ${source} }`, { trivia: lessAstGrammar.whitespace });
    expect(serializable.ok).toBe(true);
    expect(serializable.unconsumedFrom).toBeNull();
    expect(serialize(stylesheet(serializable.value)).css).toBe('.test {\n  grid-template-columns: repeat(14, 10px /* gap */ 60px);\n}\n');
  });

  it('keeps variable-initializer comments out of later typed call arguments', () => {
    const source = '@color: #FFF/* source note */; html { color: mix(blue, @color, 50%); }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'VariableDeclaration', name: 'color', value: { type: 'Color', src: '#FFF' } },
        { type: 'Rule', body: [{ value: { type: 'FunctionCall', name: 'mix', args: [
          { type: 'Color', src: 'blue' },
          { type: 'VariableReference', name: 'color', lookup: 'scoped' },
          { type: 'Dimension', src: '50%' }
        ] } }] }
      ]
    });
  });

  it('keeps detached rulesets as typed arguments of a Less function value', () => {
    const result = run(lessAstGrammar.LessAstDocument, 'x: if(not(false), { c: 3 }, { d: 4 });', { trivia: lessAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      children: [{ value: {
        type: 'FunctionCall',
        name: 'if',
        args: [{ type: 'Condition' }, { type: 'DetachedRuleset' }, { type: 'DetachedRuleset' }]
      } }]
    });
  });

  it('parses the upstream Less function-condition block without a legacy fallback', () => {
    const statements = [
      'a: if(not(false), 1, 2);',
      'b: if(not(true), 1, 2);',
      '@1: if(not(false), {c: 3}, {d: 4}); @1();',
      'e: if(not(true), 5);',
      '@f: boolean(3 = 4);',
      'f: if(not(@f), 6);',
      'g: if(true, 3, 5);',
      'h: if(false, 3, 5);',
      'i: if(true and isnumber(6), 6, 8);',
      'j: if(not(true) and true, 6, 8);',
      'k: if(true or true, 1);',
      '@some: foo;',
      'l: if((iscolor(@some)), darken(@some, 10%), black);',
      'if((false), {g: 7});',
      '@conditional: if((true), { color: green; }, {}); @conditional();',
      '@falsey: if((false), { color: orange; }, { color: purple; }); @falsey();'
    ];
    for (let count = 1; count <= statements.length; count += 1) {
      const source = `#if { ${statements.slice(0, count).join(' ')} }`;
      const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
      expect(result.ok, `first ${count} function-condition statements`).toBe(true);
      expect(result.unconsumedFrom, `first ${count} function-condition statements`).toBeNull();
    }
  });

  it('constructs escaped parenthesized Less lists as typed, iterable values', () => {
    const result = run(lessAstGrammar.LessAstDocument, '.x { value: ~(1, 2, 3); each(~(1 2 3); { item: @value; }); }', { trivia: lessAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      children: [{ body: [
        { type: 'Declaration', value: { type: 'Block', delimiter: 'paren', escaped: true, inner: { type: 'List', sep: ',', value: [{ type: 'Dimension' }, { type: 'Dimension' }, { type: 'Dimension' }] } } },
        { type: 'For', iterable: { type: 'Block', delimiter: 'paren', escaped: true, inner: [{ type: 'Dimension' }, { type: 'Dimension' }, { type: 'Dimension' }] } }
      ] }]
    });
  });

  it('keeps CSS custom-property tokens structural in nested Less function arguments', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '.a { color: rgba(var(--color-accent), 0.2); }',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ body: [{
        type: 'Declaration', name: 'color', value: {
          type: 'FunctionCall', name: 'rgba', args: [{
            type: 'FunctionCall', name: 'var', args: [{ type: 'Any', src: '--color-accent' }]
          }, { type: 'Dimension', src: '0.2' }]
        }
      }] }]
    });
  });

  it('retains multiline declaration value slots as canonical facts', () => {
    const source = '.grid { grid-template-areas:\n  "header header"\n  "content sidebar"; }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        body: [{
          type: 'Declaration',
          name: 'grid-template-areas',
          valueOnNewLine: true,
          value: [{ type: 'Quoted', value: 'header header' }, { type: 'Quoted', value: 'content sidebar' }]
        }]
      }]
    });
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value)).toEqual({
      css: '.grid {\n  grid-template-areas:\n    "header header"\n    "content sidebar";\n}\n'
    });
  });

  it('constructs bare variable and interpolation URL bodies as typed values', () => {
    const source = '.asset { direct: url(@asset); interpolated: url(@{asset}.svg); quoted: url("@{base}/icon.svg"); }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        body: [
          { type: 'Declaration', name: 'direct', value: { type: 'Url', value: { type: 'VariableReference', name: 'asset' } } },
          {
            type: 'Declaration', name: 'interpolated', value: {
              type: 'Url', value: {
                type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'asset' }, unquote: true }, { lit: '.svg' }]
              }
            }
          },
          {
            type: 'Declaration', name: 'quoted', value: {
              type: 'Url', value: {
                type: 'Interpolation', parts: [{ lit: '"' }, { ref: { type: 'VariableReference', name: 'base' }, unquote: true }, { lit: '/icon.svg"' }]
              }
            }
          }
        ]
      }]
    });
  });

  it('retains block comments in declaration heads while keeping value comments typed', () => {
    const source = '.card { color/* property */: grey; margin /* before merge */ + /* before colon */: 0; border: /* value */ solid black; }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: { type: 'Interpolation', parts: [{ lit: 'color/* property */' }] }, merge: null, value: { type: 'Color', src: 'grey' } },
        { type: 'Declaration', name: { type: 'Interpolation', parts: [{ lit: 'margin /* before merge */  /* before colon */' }] }, merge: ',', value: { type: 'Dimension', src: '0' } },
        { type: 'Declaration', name: 'border', merge: null, value: [{ type: 'Comment', text: '/* value */' }, { type: 'Keyword', src: 'solid' }, { type: 'Color', src: 'black' }] }
      ] }]
    });
    expect(serialize(stylesheet(result.value)).css).toBe('.card {\n  color/* property */: grey;\n  margin /* before merge */  /* before colon */: 0;\n  border: /* value */ solid black;\n}\n');
  });

  it('constructs Less declaration merge and importance modifiers without flattening them into value text', () => {
    const source = '@accent: navy !important; .card { box-shadow+: @accent; box-shadow+: white; font+_: serif !important; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toEqual({
      type: 'Stylesheet',
      children: [
        {
          type: 'VariableDeclaration', name: 'accent',
          value: { type: 'Important', inner: { type: 'Color', src: 'navy' } },
          write: { mode: 'declare' }
        },
        {
          type: 'Rule',
          selector: {
            type: 'SelectorList',
            selectors: [{
              type: 'ComplexSelector',
              head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.card', interp: null }] },
              tail: []
            }]
          },
          body: [
            { type: 'Declaration', name: 'box-shadow', value: { type: 'VariableReference', name: 'accent', lookup: 'scoped' }, merge: ',', important: false },
            { type: 'Declaration', name: 'box-shadow', value: { type: 'Color', src: 'white' }, merge: ',', important: false },
            { type: 'Declaration', name: 'font', value: { type: 'Keyword', src: 'serif' }, merge: ' ', important: true }
          ]
        }
      ]
    });
  });

  it('constructs generic static at-rule blocks and statements through canonical at-rule nodes', () => {
    const source = '@charset "utf-8"; @namespace foo url(http://www.example.com); @font-face { font-family: Inter; src: url(font.woff2); } @media screen { .card { color: red; } } .outer { @layer utilities { color: blue; } }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'AtRuleStatement', name: '@charset', prelude: { type: 'Quoted', src: '"utf-8"', value: 'utf-8' } },
        {
          type: 'AtRuleStatement', name: '@namespace',
          prelude: {
            type: 'SpacedValue',
            parts: [
              { type: 'Keyword', src: 'foo' },
              { type: 'Url', value: { type: 'Any', src: 'http://www.example.com' } }
            ]
          }
        },
        {
          type: 'AtRuleBlock', name: '@font-face', prelude: null,
          body: [
            { type: 'Declaration', name: 'font-family', value: { type: 'Keyword', src: 'Inter' } },
            { type: 'Declaration', name: 'src', value: { type: 'Url', value: { type: 'Any', src: 'font.woff2' } } }
          ]
        },
        {
          type: 'AtRuleBlock', name: '@media', prelude: { type: 'Keyword', src: 'screen' },
          body: [{ type: 'Rule', selector: { type: 'SelectorList' }, body: [{ type: 'Declaration', name: 'color', value: { type: 'Color', src: 'red' } }] }]
        },
        {
          type: 'Rule',
          body: [{ type: 'AtRuleBlock', name: '@layer', prelude: { type: 'Keyword', src: 'utilities' }, body: [{ type: 'Declaration', name: 'color', value: { type: 'Color', src: 'blue' } }] }]
        }
      ]
    });

    for (const dynamic of [
      '@custom @{query} { .card { color: red; } }',
      '@custom foo@{query} { .card { color: red; } }',
      '@custom foo @{query} { .card { color: red; } }',
      '@custom foo@{query};',
      '@custom foo @{query};'
    ]) {
      const rejected = run(lessAstGrammar.LessAstDocument, dynamic, { trivia: lessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null && isStylesheet(rejected.value), dynamic).toBe(false);
    }
  });

  it('keeps charset on the static generic route while retaining typed namespace interpolation', () => {
    const source = '@charset "UTF-8"; @ns: less; @namespace @{ns} "http://lesscss.org";';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        {
          type: 'AtRuleStatement', name: '@charset', prelude: {
            type: 'Quoted', src: '"UTF-8"', value: 'UTF-8'
          }
        },
        { type: 'VariableDeclaration', name: 'ns' },
        {
          type: 'AtRuleStatement', name: '@namespace', prelude: {
            type: 'SpacedValue', parts: [
              { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'ns', lookup: 'scoped' }, unquote: true }] },
              { type: 'Quoted', src: '"http://lesscss.org"', value: 'http://lesscss.org' }
            ]
          }
        }
      ]
    });

    for (const rejectedSource of [
      '@Eight: 8; @charset "UTF-@{Eight}";',
      '@charset @{encoding};',
      '@custom foo@{name};'
    ]) {
      const rejected = run(lessAstGrammar.LessAstDocument, rejectedSource, { trivia: lessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null && isStylesheet(rejected.value), rejectedSource).toBe(false);
    }
  });

  it('constructs interpolated and dotted layer headers through canonical at-rule nodes', () => {
    const source = '@layer-name: theme; @layer @{layer-name} { .card { color: red; } } @layer framework.buttons { .button { color: blue; } } @layer reset, base;';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'layer-name' },
        {
          type: 'AtRuleBlock', name: '@layer',
          prelude: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'layer-name' }, unquote: true }] },
          body: [{ type: 'Rule', body: [{ type: 'Declaration', name: 'color', value: { type: 'Color', src: 'red' } }] }]
        },
        {
          type: 'AtRuleBlock', name: '@layer', prelude: { type: 'Keyword', src: 'framework.buttons' },
          body: [{ type: 'Rule', body: [{ type: 'Declaration', name: 'color', value: { type: 'Color', src: 'blue' } }] }]
        },
        {
          type: 'AtRuleStatement', name: '@layer',
          prelude: { type: 'List', sep: ',', value: [{ type: 'Keyword', src: 'reset' }, { type: 'Keyword', src: 'base' }] }
        }
      ]
    });
  });

  it('constructs static CSS keyframes through canonical at-rule and rule facts', () => {
    const source = '@keyframes fade { from, 50% { opacity: 0; } to { opacity: 1; } } @-webkit-keyframes "slide" { 0%, 100% { left: 0; } } @keyframes ~"spin" { from { opacity: 0; } }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        {
          type: 'AtRuleBlock', name: '@keyframes', prelude: { type: 'Keyword', src: 'fade' },
          body: [{
            type: 'Rule', selector: { type: 'SelectorList', selectors: [
              { type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: 'from' }] } },
              { type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '50%' }] } }
            ] }, body: [{ type: 'Declaration', name: 'opacity' }]
          }, { type: 'Rule', body: [{ type: 'Declaration', name: 'opacity' }] }]
        },
        {
          type: 'AtRuleBlock', name: '@-webkit-keyframes', prelude: { type: 'Quoted', value: 'slide' },
          body: [{ type: 'Rule', selector: { type: 'SelectorList', selectors: [{ type: 'ComplexSelector' }, { type: 'ComplexSelector' }] } }]
        },
        {
          type: 'AtRuleBlock', name: '@keyframes', prelude: { type: 'Quoted', src: '~"spin"', value: 'spin', escaped: true },
          body: [{ type: 'Rule', selector: { type: 'SelectorList', selectors: [{ type: 'ComplexSelector' }] } }]
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@keyframes fade {\n  from,\n  50% {\n    opacity: 0;\n  }\n  to {\n    opacity: 1;\n  }\n}\n@-webkit-keyframes "slide" {\n  0%,\n  100% {\n    left: 0;\n  }\n}\n@keyframes spin {\n  from {\n    opacity: 0;\n  }\n}\n'
    );

    for (const rejected of [
      '@keyframes @name { from { opacity: 0; } }',
      '@keyframes fade { @{step} { opacity: 0; } }',
      '@keyframes fade { 10 { opacity: 0; } }'
    ]) {
      const direct = run(lessAstGrammar.LessAstDocument, rejected, { trivia: lessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, rejected).toBe(false);
    }
  });

  it('keeps Less keyframe comments in the typed body and rejects unrepresentable selector comments', () => {
    const bodyComment = '@keyframes fade { from { /* body note */ opacity: 0; } }';
    const direct = run(lessAstGrammar.LessAstDocument, bodyComment, { trivia: lessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet', children: [{
        type: 'AtRuleBlock', body: [{
          type: 'Rule', body: [{ type: 'Comment', text: '/* body note */' }, { type: 'Declaration', name: 'opacity' }]
        }]
      }]
    });
    expect(serialize(stylesheet(direct.value)).css).toBe(
      '@keyframes fade {\n  from {\n    /* body note */\n    opacity: 0;\n  }\n}\n'
    );

    for (const source of [
      '@keyframes fade { from /* selector note */, 50% { opacity: 0; } }',
      '@keyframes fade { from, /* selector note */ 50% { opacity: 0; } }',
      '@keyframes fade { from /* selector note */ { opacity: 0; } }'
    ]) {
      const rejected = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null, source).toBe(false);
    }
  });

  it('matches public acceptance of an empty statement inside a generic at-rule body without inventing an AST node', () => {
    const source = '@foo { ; color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toEqual({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock', name: '@foo', prelude: null,
        body: [{ type: 'Declaration', name: 'color', value: { type: 'Color', src: 'red' }, merge: null, important: false }]
      }]
    });
  });

  it('constructs bounded static @supports conditions with structural parentheses', () => {
    const source = '@supports ((display: grid) or (color: red)) and (hover) { .card { color: red; } }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock', name: '@supports',
        prelude: { type: 'SpacedValue', parts: [
          { type: 'Block', delimiter: 'paren', inner: { type: 'SpacedValue', parts: [
            { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':' } },
            { type: 'Keyword', src: 'or' },
            { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':' } }
          ] } },
          { type: 'Keyword', src: 'and' },
          { type: 'Block', delimiter: 'paren', inner: { type: 'Keyword', src: 'hover' } }
        ] },
        body: [{ type: 'Rule', body: [{ type: 'Declaration', name: 'color' }] }]
      }]
    });
  });

  it('renders bounded @supports parentheses without changing quoted or escaped feature values', () => {
    const source = '@supports (font-family: "A  \\"B\\"") and ((display: grid) or (color: red)) { .card { color: red; } }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value)).toEqual({
      css: '@supports (font-family: "A  \\"B\\"") and ((display: grid) or (color: red)) {\n  .card {\n    color: red;\n  }\n}\n'
    });
  });

  it('keeps multi-token @supports feature values structural and canonicalizes their padding', () => {
    const source = '@supports ( box-shadow: 2px 2px 2px black ) or ( -moz-box-shadow: 2px 2px 2px black ) { .card { color: red; } }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(result.value.children[0]).toMatchObject({
      type: 'AtRuleBlock', name: '@supports',
      prelude: { type: 'SpacedValue', parts: [
        { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':', right: { type: 'SpacedValue' } } },
        { type: 'Keyword', src: 'or' },
        { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':', right: { type: 'SpacedValue' } } }
      ] }
    });
    expect(serialize(result.value).css).toBe(
      '@supports (box-shadow: 2px 2px 2px black) or (-moz-box-shadow: 2px 2px 2px black) {\n  .card {\n    color: red;\n  }\n}\n'
    );
  });

  it('constructs structural media and container query preludes, including Less variables', () => {
    const source = '@limit: 40rem; @media screen and (min-width: @limit), print { .card { color: red; } } @container (400px < width < @limit) { .card { color: blue; } }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'limit' },
        { type: 'AtRuleBlock', name: '@media', prelude: { type: 'List', sep: ',', value: [
          { type: 'SpacedValue', parts: [
            { type: 'Keyword', src: 'screen' },
            { type: 'Keyword', src: 'and' },
            { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':', right: { type: 'VariableReference', name: 'limit' } } }
          ] },
          { type: 'Keyword', src: 'print' }
        ] }, body: [{ type: 'Rule' }] },
        { type: 'AtRuleBlock', name: '@container', prelude: { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: '<', right: { type: 'VariableReference', name: 'limit' } } }, body: [{ type: 'Rule' }] }
      ]
    });
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value)).toEqual({
      css: '@media screen and (min-width: 40rem), print {\n  .card {\n    color: red;\n  }\n}\n@container (400px < width < 40rem) {\n  .card {\n    color: blue;\n  }\n}\n'
    });
  });

  it('constructs a bare parenthesized media feature as a typed query node', () => {
    const source = '@media (tv) { .card { color: red; } }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock', name: '@media',
        prelude: { type: 'Block', delimiter: 'paren', inner: { type: 'Keyword', src: 'tv' } },
        body: [{ type: 'Rule' }]
      }]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@media (tv) {\n  .card {\n    color: red;\n  }\n}\n'
    );
  });

  it('stores parenthesized colon features as typed values for later media interpolation', () => {
    const source = '@size: 640px; @tablet: (min-width: @size); @media @{tablet} { .card { color: red; } }';
    const feature = run(lessAstGrammar.DirectLessQueryColonFeature, '(min-width: @size)', { trivia: lessAstGrammar.whitespace });
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(feature).toMatchObject({ ok: true, span: { start: 0, end: 18 } });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'size' },
        { type: 'VariableDeclaration', name: 'tablet', value: {
          type: 'Block', delimiter: 'paren', inner: {
            type: 'Operation', operator: ':',
            left: { type: 'Keyword', src: 'min-width' },
            right: { type: 'VariableReference', name: 'size' }
          }
        } },
        { type: 'AtRuleBlock', name: '@media' }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@media (min-width: 640px) {\n  .card {\n    color: red;\n  }\n}\n'
    );

    const incoherent = run(lessAstGrammar.LessAstDocument, '.card { value: (12px 13px); }', { trivia: lessAstGrammar.whitespace });
    expect(incoherent.ok && incoherent.unconsumedFrom === null).toBe(false);
  });

  it('evaluates the upstream namespacing-media accessor as a whole media query term', () => {
    const source = `#ns {
  .sizes() { @small: 600px; }
  .breakpoint(@size) {
    @val: #ns.sizes[@@size];
    @min: (min-width: @val);
    @max: not all and @min;
  }
}
#ns { .sizes() { @small: 480px; } }
.valToGet() { keyword: small; }
@media #ns.breakpoint(.valToGet[])[@max] { .selector { prop: val; } }`;
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        // `#ns { … }` is an ordinary ID-selector ruleset which owns mixin
        // declarations; it is not itself a mixin declaration.
        { type: 'Rule', selector: { selectors: [{ head: { simples: [{ text: '#ns' }] } }] }, body: [{ type: 'MixinDef', name: '.sizes' }, { type: 'MixinDef', name: '.breakpoint' }] },
        { type: 'Rule', selector: { selectors: [{ head: { simples: [{ text: '#ns' }] } }] }, body: [{ type: 'MixinDef', name: '.sizes' }] },
        { type: 'MixinDef', name: '.valToGet' },
        { type: 'AtRuleBlock', name: '@media', prelude: {
          type: 'Reference',
          base: { type: 'MixinCall', name: '.breakpoint', path: [{ comb: ' ', sel: '#ns' }] },
          steps: [{ type: 'BracketLookup', keyKind: 'var', key: { type: 'VariableReference', name: 'max' } }]
        } }
      ]
    });
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value).css).toBe(
      '@media not all and (min-width: 480px) {\n  .selector {\n    prop: val;\n  }\n}\n'
    );
  });

  it('constructs nested negated container-query conditions structurally', () => {
    const source = '@container (width > 760px) and (not (height > 670px)) { .card { color: red; } }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock', name: '@container',
        prelude: { type: 'SpacedValue', parts: [
          { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: '>' } },
          { type: 'Keyword', src: 'and' },
          { type: 'Block', delimiter: 'paren', inner: { type: 'SpacedValue', parts: [{ type: 'Keyword', src: 'not' }, { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: '>' } }] } }
        ] }
      }]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@container (width > 760px) and (not (height > 670px)) {\n  .card {\n    color: red;\n  }\n}\n'
    );
  });

  it('constructs typed container style queries and permits them in shared conditional bodies', () => {
    const source = '@container card (inline-size > 30em) { @container style(--responsive: true) { .card { color: red; } } }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock', name: '@container',
        body: [{
          type: 'AtRuleBlock', name: '@container',
          prelude: { type: 'FunctionCall', name: 'style', args: [{
            type: 'Operation', operator: ':', left: { type: 'Keyword', src: '--responsive' }, right: { type: 'Keyword', src: 'true' }
          }] }
        }]
      }]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@container card (inline-size > 30em) {\n  @container style(--responsive: true) {\n    .card {\n      color: red;\n    }\n  }\n}\n'
    );
  });

  it('constructs an interpolated Less container name with a structural condition', () => {
    const source = '@name: card; @limit: 30em; @container @{name} (inline-size > @limit) { .card { color: red; } }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'name' },
        { type: 'VariableDeclaration', name: 'limit' },
        { type: 'AtRuleBlock', name: '@container', prelude: { type: 'SpacedValue', parts: [
          { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'name' }, unquote: true }] },
          { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: '>', right: { type: 'VariableReference', name: 'limit' } } }
        ] } }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@container card (inline-size > 30em) {\n  .card {\n    color: red;\n  }\n}\n'
    );
  });

  it('retains output-bearing comments in a direct media-query prelude', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '@media screen /* comment */, print /* another */ { body { font-size: 12pt; } }',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value)).toEqual({
      css: '@media screen /* comment */, print /* another */ {\n  body {\n    font-size: 12pt;\n  }\n}\n'
    });
  });

  it('rejects malformed or unmodelled media/container query preludes without generic at-rule fallback', () => {
    for (const source of [
      '@media only (min-width: 1px) { .card { color: red; } }',
      '@media screen and { .card { color: red; } }',
      '@container only screen { .card { color: red; } }',
      '@container selector(.card) { .card { color: red; } }'
    ]) {
      const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
    for (const source of [
      '@media screen { .card { color: red; } }',
      '@container (width > 10px) { .card { color: red; } }'
    ]) {
      const generic = run(lessAstGrammar.DirectLessAtRuleBlock, source, { trivia: lessAstGrammar.whitespace });
      expect(generic.ok && generic.unconsumedFrom === null, source).toBe(false);
    }
  });

  it('constructs complete Less interpolation headers as typed media, supports, and keyframe preludes', () => {
    const source = '@query: screen; @condition: "(display: grid)"; @animation: fade; @media @{query} { .media { color: red; } } @supports @{condition} { .supports { display: grid; } } @keyframes @{animation} { from { opacity: 0; } }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'query' },
        { type: 'VariableDeclaration', name: 'condition' },
        { type: 'VariableDeclaration', name: 'animation' },
        { type: 'AtRuleBlock', name: '@media', prelude: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'query' }, unquote: true }] } },
        { type: 'AtRuleBlock', name: '@supports', prelude: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'condition' }, unquote: true }] } },
        { type: 'AtRuleBlock', name: '@keyframes', prelude: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'animation' }, unquote: true }] } }
      ]
    });
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value)).toEqual({
      css: '@media screen {\n  .media {\n    color: red;\n  }\n}\n@supports (display: grid) {\n  .supports {\n    display: grid;\n  }\n}\n@keyframes fade {\n  from {\n    opacity: 0;\n  }\n}\n'
    });
  });

  it('constructs static and interpolated general-enclosed supports content without a raw fallback', () => {
    const source = '@feature: kind; @supports selector(  .card-@{feature} /* keep */ :is(.a, .b) ) { .card { color: red; } }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'feature' },
        { type: 'AtRuleBlock', name: '@supports', prelude: {
          type: 'GeneralEnclosed', form: 'function', name: 'selector',
          content: { type: 'Interpolation', parts: [
            { lit: '  .card-' },
            { ref: { type: 'VariableReference', name: 'feature', lookup: 'scoped' }, unquote: true },
            { lit: ' /* keep */ :is(.a, .b) ' }
          ] }
        } }
      ]
    });

    for (const source of [
      '@supports (font-tech(color-COLRv1)) { .card { color: red; } }',
      '@supports (@{feature}: grid) { .card { color: red; } }'
    ]) {
      const direct = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), source).toBe(true);
    }
    for (const source of [
      '@supports selector(.card { .card { color: red; } }',
      '@supports selector([.card) { .card { color: red; } }',
      '@supports (display: grid), (color: red) { .card { color: red; } }'
    ]) {
      const direct = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), source).toBe(false);
    }
    const genericSupports = run(
      lessAstGrammar.DirectLessAtRuleBlock,
      '@supports (display: grid) { .card { color: red; } }',
      { trivia: lessAstGrammar.whitespace }
    );
    expect(genericSupports.ok && genericSupports.unconsumedFrom === null).toBe(false);
  });

  it('constructs static mixin definitions and calls through canonical mixin nodes', () => {
    const source = '.space(@amount, @color: blue) { padding: @amount; color: @color; } .card { .space(2px, red); }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        {
          type: 'MixinDef', name: '.space',
          params: [{ name: 'amount' }, { name: 'color', default: { type: 'Color', src: 'blue' } }],
          body: [
            { type: 'Declaration', name: 'padding', value: { type: 'VariableReference', name: 'amount' } },
            { type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'color' } }
          ]
        },
        {
          type: 'Rule',
          body: [{
            type: 'MixinCall', name: '.space', path: [], important: false,
            args: [{ value: { type: 'Dimension', number: 2, unit: 'px', src: '2px' } }, { value: { type: 'Color', src: 'red' } }]
          }]
        }
      ]
    });
  });

  it('parses multiline svg-gradient values inside a mixin definition directly', () => {
    const source = '.gradient-mixin(@color) {\n  background: svg-gradient(to bottom,\n    fade(@color, 0%) 0%,\n    fade(@color, 5%) 60%\n  );\n}';
    for (const candidate of [
      '.gradient-mixin(@color) { background: red; }',
      '.gradient-mixin(@color) { background: svg-gradient(red); }',
      '.gradient-mixin(@color) { background: svg-gradient(to bottom); }',
      '.gradient-mixin(@color) { background: svg-gradient(to bottom, fade(@color, 0%)); }',
      '.gradient-mixin(@color) { background: svg-gradient(to bottom, fade(@color, 0%) 0%); }',
      source
    ]) {
      const result = run(lessAstGrammar.LessAstDocument, candidate, { trivia: lessAstGrammar.whitespace });
      expect(result.ok, candidate).toBe(true);
      expect(result.unconsumedFrom, candidate).toBeNull();
    }
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'MixinDef',
        name: '.gradient-mixin',
        params: [{ name: 'color' }],
        body: [{ type: 'Declaration', name: 'background', value: { type: 'FunctionCall', name: 'svg-gradient' } }]
      }]
    });
  });

  it('keeps CSS-escaped mixin names as direct canonical calls', () => {
    const source = '.mixin\\!tUp() { color: red; } .card { .mixin\\!tUp(); }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'MixinDef', name: '.mixin\\!tUp' },
        { type: 'Rule', body: [{ type: 'MixinCall', name: '.mixin\\!tUp', path: [], args: [] }] }
      ]
    });
  });

  it('accepts an optional statement terminator after a Less mixin definition', () => {
    const source = '.wrap(@value) { color: @value; }; .card { .wrap(red); }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'MixinDef', name: '.wrap', params: [{ name: 'value' }] },
        { type: 'Rule', body: [{ type: 'MixinCall', name: '.wrap', args: [{ value: { type: 'Color', src: 'red' } }] }] }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe('.card {\n  color: red;\n}\n');
  });

  it('constructs semicolon-separated mixin parameters with detached-ruleset defaults', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '.configure(@a: {}; @b: { default: works; };) { @a(); @b(); }',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'MixinDef', name: '.configure', params: [
        { name: 'a', default: { type: 'DetachedRuleset', body: [] } },
        { name: 'b', default: { type: 'DetachedRuleset', body: [{ type: 'Declaration', name: 'default' }] } }
      ] }]
    });
  });

  it('constructs semicolon-separated detached-ruleset mixin arguments', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '.configure(@a; @b) {} .card { .configure({ direct: works; }; @b: { named: works; }); }',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'MixinDef' }, { type: 'Rule', body: [{ type: 'MixinCall', args: [
        { value: { type: 'DetachedRuleset', body: [{ type: 'Declaration', name: 'direct' }] } },
        { name: 'b', value: { type: 'DetachedRuleset', body: [{ type: 'Declaration', name: 'named' }] } }
      ] }] }]
    });
  });

  it('groups comma runs into list-valued arguments when semicolons separate Less mixin arguments', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '.generic(@left; @right) { left: @left; right: @right; } .out { .generic(a, b, c; a, b, c); }',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'MixinDef' }, { type: 'Rule', body: [{
        type: 'MixinCall', name: '.generic', args: [
          { value: { type: 'List', sep: ',', value: [{ type: 'Keyword', src: 'a' }, { type: 'Keyword', src: 'b' }, { type: 'Keyword', src: 'c' }] } },
          { value: { type: 'List', sep: ',', value: [{ type: 'Keyword', src: 'a' }, { type: 'Keyword', src: 'b' }, { type: 'Keyword', src: 'c' }] } }
        ]
      }] }]
    });
    expect(serialize(stylesheet(result.value)).css).toBe('.out {\n  left: a, b, c;\n  right: a, b, c;\n}\n');
  });

  it('keeps recursive value slots inside semicolon-terminated mixin argument groups', () => {
    const source = [
      '.multi-bg(@bgs...) { background: @bgs; }',
      '.hero {',
      '  .multi-bg(linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.3)), url("/images/hero.jpg") center/cover no-repeat);',
      '}'
    ].join('\n');
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'MixinDef' }, { type: 'Rule', body: [{
        type: 'MixinCall',
        name: '.multi-bg',
        args: [
          { value: { type: 'FunctionCall', name: 'linear-gradient' } },
          { value: [
            { type: 'Url' },
            { type: 'SpacedValue' },
            { type: 'Keyword', src: 'no-repeat' }
          ] }
        ]
      }] }]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '.hero {\n  background: linear-gradient(rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.3)) url("/images/hero.jpg") center/cover no-repeat;\n}\n'
    );
  });

  it('constructs public literal-pattern and variadic mixin parameters directly', () => {
    const source = '.badge(red, @gap, @rest...) { padding: @gap; } .card { .badge(red, 2px, 4px); }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        {
          type: 'MixinDef', name: '.badge',
          params: [
            { pattern: { type: 'Color', src: 'red' } },
            { name: 'gap' },
            { name: 'rest', rest: true }
          ]
        },
        {
          type: 'Rule',
          body: [{
            type: 'MixinCall', name: '.badge', path: [], important: false,
            args: [
              { value: { type: 'Color', src: 'red' } },
              { value: { type: 'Dimension', number: 2, unit: 'px', src: '2px' } },
              { value: { type: 'Dimension', number: 4, unit: 'px', src: '4px' } }
            ]
          }]
        }
      ]
    });
  });

  it('constructs a Less mixin argument expansion through the existing spread field', () => {
    const source = '.pair(@a, @b) { first: @a; second: @b; } @args: one, two; .card { .pair(@args...); }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'MixinDef', name: '.pair' },
        { type: 'VariableDeclaration', name: 'args' },
        { type: 'Rule', body: [{
          type: 'MixinCall', name: '.pair',
          args: [{ value: { type: 'VariableReference', name: 'args', lookup: 'scoped' }, spread: true }]
        }] }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe('.card {\n  first: one;\n  second: two;\n}\n');
  });

  it('constructs static namespaced mixin calls through the existing path contract', () => {
    const source = '.card { .library > .colors .tone(red); }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        body: [{
          type: 'MixinCall', name: '.tone', important: false,
          path: [
            { comb: ' ', sel: '.library' },
            { comb: '>', sel: '.colors' }
          ],
          args: [{ value: { type: 'Color', src: 'red' } }]
        }]
      }]
    });
  });

  it('keeps nested callable mixin arguments as MixinCall facts, not value-shaped source recovery', () => {
    const source = '.wrapper(.something(foo)); .wrapper(.output-height());';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'MixinCall', name: '.wrapper', args: [{ value: { type: 'MixinCall', name: '.something', args: [{ value: { type: 'Keyword', src: 'foo' } }] } }] },
        { type: 'MixinCall', name: '.wrapper', args: [{ value: { type: 'MixinCall', name: '.output-height', args: [] } }] }
      ]
    });

    const arithmetic = run(lessAstGrammar.LessAstDocument, '.wrapper(.something(foo) + 1);', { trivia: lessAstGrammar.whitespace });
    expect(arithmetic.ok && arithmetic.unconsumedFrom === null).toBe(false);

    const lexical = run(
      lessAstGrammar.LessAstDocument,
      '@caller: 10px; .wrapper(@m) { @m(); } .something(@value) { width: @value; } .output-height() { height: 10px; } .x { .wrapper(.something(@caller)); .wrapper(.output-height()); }',
      { trivia: lessAstGrammar.whitespace }
    );
    expect(lexical.ok).toBe(true);
    expect(serialize(stylesheet(lexical.value)).css).toBe('.x {\n  width: 10px;\n  height: 10px;\n}\n');
  });

  it('constructs static namespace/map reads as References over the existing MixinCall path base', () => {
    const source = '.out { a: #ns1[foo]; b: #ns1.vars[$sub]; c: #DEF.colors[primary]; d: #library.add-one(1px)[@return]; }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule', body: [
          { type: 'Declaration', name: 'a', value: { type: 'Reference', base: { type: 'MixinCall', name: '#ns1', path: [], args: [] }, steps: [{ type: 'BracketLookup', keyKind: 'prop', key: { type: 'Keyword', src: 'foo' } }], raw: '#ns1[foo]' } },
          { type: 'Declaration', name: 'b', value: { type: 'Reference', base: { type: 'MixinCall', name: '.vars', path: [{ comb: ' ', sel: '#ns1' }], args: [] }, steps: [{ type: 'BracketLookup', keyKind: 'prop', key: { type: 'PropertyReference', name: 'sub' } }], raw: '#ns1 .vars[$sub]' } },
          { type: 'Declaration', name: 'c', value: { type: 'Reference', base: { type: 'MixinCall', name: '.colors', path: [{ comb: ' ', sel: '#DEF' }], args: [] }, steps: [{ type: 'BracketLookup', keyKind: 'prop', key: { type: 'Keyword', src: 'primary' } }], raw: '#DEF .colors[primary]' } },
          { type: 'Declaration', name: 'd', value: { type: 'Reference', base: { type: 'MixinCall', name: '.add-one', path: [{ comb: ' ', sel: '#library' }], args: [{ value: { type: 'Dimension', src: '1px' } }] }, steps: [{ type: 'BracketLookup', keyKind: 'var', key: { type: 'VariableReference', name: 'return' } }], raw: '#library .add-one(1px)[@return]' } }
        ]
      }]
    });
  });

  it('folds mixed namespace call, lookup, member, and call continuations into one direct Reference', () => {
    const source = `
#library {
  .seed() { @next: .inner(); }
  .inner(@n) { answer: @n; }
}
.out { value: #library.seed()[@next](42)[answer]; member: @theme[key].next(1); }
`;
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{}, {
        type: 'Rule', body: [{
          type: 'Declaration', name: 'value', value: {
            type: 'Reference',
            base: { type: 'MixinCall', name: '.seed', path: [{ comb: ' ', sel: '#library' }], args: [] },
            steps: [
              { type: 'BracketLookup', keyKind: 'var', key: { type: 'VariableReference', name: 'next', lookup: 'scoped' } },
              { type: 'Call', args: [{ value: { type: 'Dimension', src: '42' } }] },
              { type: 'BracketLookup', keyKind: 'prop', key: { type: 'Keyword', src: 'answer' } }
            ],
            raw: '#library .seed()[@next](42)[answer]'
          }
        }, {
          type: 'Declaration', name: 'member', value: {
            type: 'Reference',
            base: { type: 'VariableReference', name: 'theme', lookup: 'scoped' },
            steps: [
              { type: 'BracketLookup', keyKind: 'prop', key: { type: 'Keyword', src: 'key' } },
              { type: 'DotLookup', name: 'next' },
              { type: 'Call', args: [{ value: { type: 'Dimension', src: '1' } }] }
            ],
            raw: '@theme[key].next(1)'
          }
        }]
      }]
    });
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value).css).toContain('value: 42;');
  });

  it('constructs $@variable namespace property keys without flattening their indirection', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '@prop-name: my-prop; #namespace { my-prop: prop-value; } .test { value: #namespace[$@prop-name]; }',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{}, {}, {
        type: 'Rule', body: [{
          type: 'Declaration', name: 'value', value: {
            type: 'Reference', base: { type: 'MixinCall', name: '#namespace', path: [], args: [] },
            steps: [{
              type: 'BracketLookup', keyKind: 'prop',
              key: { type: 'VariableReference', name: 'prop-name', lookup: 'scoped' }
            }],
            raw: '#namespace[$@prop-name]'
          }
        }]
      }]
    });
  });

  it('keeps a namespaced mixin map value and its call-level important flag typed', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '@theme-colors: #theme.dark.navbar.colors() !important;',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'VariableDeclaration', name: 'theme-colors',
        value: {
          type: 'MixinCall', name: '.colors', args: [], important: true,
          path: [
            { comb: ' ', sel: '#theme' },
            { comb: ' ', sel: '.dark' },
            { comb: ' ', sel: '.navbar' }
          ]
        }
      }]
    });
  });

  it('constructs bracket-accessed namespace values as arithmetic operands', () => {
    const source = `
#ns { .options() { val1: 10px; } }
@ns: { @options: { val2: 20px; } }
.foo { val: #ns.options[val1] + @ns[@options][val2] + 5px; }
`;
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        {},
        {},
        { type: 'Rule', body: [{ type: 'Declaration', name: 'val', value: {
          type: 'Operation', operator: '+',
          left: { type: 'Operation', operator: '+', left: {
            type: 'Reference', base: { type: 'MixinCall', name: '.options', path: [{ comb: ' ', sel: '#ns' }], args: [] },
            steps: [{ type: 'BracketLookup', keyKind: 'prop', key: { type: 'Keyword', src: 'val1' } }]
          }, right: {
            type: 'Reference', base: { type: 'VariableReference', name: 'ns', lookup: 'scoped' },
            steps: [
              { type: 'BracketLookup', keyKind: 'var', key: { type: 'VariableReference', name: 'options', lookup: 'scoped' } },
              { type: 'BracketLookup', keyKind: 'prop', key: { type: 'Keyword', src: 'val2' } }
            ]
          } },
          right: { type: 'Dimension', src: '5px' }
        } }] }
      ]
    });
  });

  it('evaluates bracket variable members from every applicable implicit and explicit mixin call result', () => {
    const source = `
#library { .implicit() { @return: red; } .explicit(@x) { @return: 1px; } }
#library { .implicit() { @return: blue; } .explicit(@x) { @return: 2px; } }
.out { implicit: #library.implicit[@return]; explicit: #library.explicit(1px)[@return]; }
`;
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value).css).toContain('.out {\n  implicit: blue;\n  explicit: 2px;\n}');
  });

  it('resolves direct `[@key]` members in the aggregated mixin-call result frame, not the caller frame', () => {
    const source = `
#library { .m() { @key: first; @return: first-return; } }
#library { .m() { @key: callee; @return: callee-return; } }
@key: return;
.out { ordinary: #library.m()[@key]; returned: #library.m()[@return]; }
`;
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    // Upstream namespacing-1/2 fixtures establish that `[@name]` selects that
    // named variable member (`[@foo]`, `[@return]`). `[@@name]` is the distinct
    // indirection form, covered separately by namespacing-2 and not widened here.
    expect(serialize(result.value).css).toContain('.out {\n  ordinary: callee;\n  returned: callee-return;\n}');
  });

  it('reads forward-declared detached-ruleset map members and typed indirect keys', () => {
    // Upstream tests-config/namespacing/namespacing-1.less: the map declaration
    // follows its reads, and `@@varToGet` selects the `@default-color` member.
    const source = `
@varToGet: default-color;
.out { direct: @defaults[@default-color]; nested: @defaults[@nested][@color]; indirect: @defaults[@@varToGet]; }
@defaults: { @default-color: red; @nested: { @color: yellow; }; };
`;
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value).css).toContain('.out {\n  direct: red;\n  nested: yellow;\n  indirect: red;\n}');
  });

  it('reads `$name` as a property member on an aggregated static namespace call result', () => {
    // Upstream tests-config/namespacing/namespacing-1.less: #ns1.vars[$sub]
    // selects `sub:` from every applicable `.vars()` result; the last wins.
    const source = `
#ns1 { .vars() { sub: value; } }
#ns1 { .vars() { sub: tres; } }
.out { sub: #ns1.vars[$sub]; }
`;
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value).css).toContain('.out {\n  sub: tres;\n}');
  });

  it('constructs semicolon-terminated parenthesis-free mixin calls through the existing path contract', () => {
    const source = '#theme { .mixin() { color: red; } } .card { #theme > .mixin; } .important { #theme > .mixin !important; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'Rule', body: [{ type: 'MixinDef', name: '.mixin' }] },
        { type: 'Rule', body: [{ type: 'MixinCall', name: '.mixin', args: [], path: [{ comb: ' ', sel: '#theme' }] }] },
        { type: 'Rule', body: [{ type: 'MixinCall', name: '.mixin', args: [], path: [{ comb: ' ', sel: '#theme' }], important: true }] }
      ]
    });

    for (const invalid of [
      '.card { #theme > .mixin }'
    ]) {
      const direct = run(lessAstGrammar.LessAstDocument, invalid, { trivia: lessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), invalid).toBe(false);
    }
  });

  it('constructs the public call-level !important mixin override directly', () => {
    const source = '.card { .space(2px) !important; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        body: [{
          type: 'MixinCall', name: '.space', path: [], important: true,
          args: [{ value: { type: 'Dimension', number: 2, unit: 'px', src: '2px' } }]
        }]
      }]
    });
  });

  it('constructs ordered named arguments for static and namespaced mixin calls directly', () => {
    const source = '.card { .library > .colors .tone(@shade: red, @gap: 2px); }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        body: [{
          type: 'MixinCall', name: '.tone', important: false,
          path: [
            { comb: ' ', sel: '.library' },
            { comb: '>', sel: '.colors' }
          ],
          args: [
            { name: 'shade', value: { type: 'Color', src: 'red' } },
            { name: 'gap', value: { type: 'Dimension', number: 2, unit: 'px', src: '2px' } }
          ]
        }]
      }]
    });
  });

  it('constructs truthful static mixin comparison and truth guards directly', () => {
    const source = '.wide(@width) when (@width >= 20px) { width: @width; } .enabled() when (true) { display: block; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        {
          type: 'MixinDef', name: '.wide',
          guard: {
            g: 'cmp', op: '>=',
            left: { type: 'VariableReference', name: 'width' },
            right: { type: 'Dimension', number: 20, unit: 'px', src: '20px' }
          }
        },
        {
          type: 'MixinDef', name: '.enabled',
          guard: { g: 'truth', value: { type: 'Keyword', src: 'true' } }
        }
      ]
    });
  });

  it('routes the namespacing-7 accessor guards through existing typed References', () => {
    const source = `#ns {
  .options() { option: true; }
}
@ns: { @options: { option: true; }; };
& when (#ns.options[option]) { .output { a: b; } }
& when (#ns.options[option] = true) { .output-2 { c: d; } }
& when (#ns.options[option] = false) { .no-reach { c: d; } }
& when (@ns[@options][option]) { .dr { a: b; } }
& when (@ns[@options][option] = true) { .dr-2 { c: d; } }
& when (@ns[@options][option] = false) { .dr-no-reach { c: d; } }`;
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    const children = stylesheet(result.value).children;
    expect([children[2], children[3], children[7]]).toMatchObject([
      {
        type: 'Rule',
        guard: {
          g: 'truth',
          value: {
            type: 'Reference',
            base: {
              type: 'MixinCall', name: '.options',
              path: [{ comb: ' ', sel: '#ns' }],
              args: []
            },
            steps: [{ type: 'BracketLookup', keyKind: 'prop', key: { type: 'Keyword', src: 'option' } }],
            raw: '#ns .options[option]'
          }
        }
      },
      {
        type: 'Rule',
        guard: {
          g: 'cmp', op: '=',
          left: {
            type: 'Reference',
            base: {
              type: 'MixinCall', name: '.options',
              path: [{ comb: ' ', sel: '#ns' }],
              args: []
            },
            steps: [{ type: 'BracketLookup', keyKind: 'prop', key: { type: 'Keyword', src: 'option' } }],
            raw: '#ns .options[option]'
          },
          right: { type: 'Keyword', src: 'true' }
        }
      },
      {
        type: 'Rule',
        guard: {
          g: 'cmp', op: '=',
          left: {
            type: 'Reference',
            base: {
              type: 'VariableReference', name: 'ns', lookup: 'scoped'
            },
            steps: [
              { type: 'BracketLookup', keyKind: 'var', key: { type: 'VariableReference', name: 'options', lookup: 'scoped' } },
              { type: 'BracketLookup', keyKind: 'prop', key: { type: 'Keyword', src: 'option' } }
            ],
            raw: '@ns[@options][option]'
          },
          right: { type: 'Keyword', src: 'false' }
        }
      }
    ]);
  });

  it('constructs quoted Less mixin guard operands as existing typed values', () => {
    const source = '.match(@value) when (@value = "ok") { color: green; } .yes { .match("ok"); }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ type: 'Stylesheet' });
    expect(stylesheet(result.value).children[0]).toMatchObject({
      type: 'MixinDef', name: '.match',
      guard: {
        g: 'cmp', op: '=',
        left: { type: 'VariableReference', name: 'value', lookup: 'scoped' },
        right: { type: 'Quoted', src: '"ok"', value: 'ok', quote: '"', escaped: false }
      }
    });
  });

  it('constructs static logical, negated, default, and type-call mixin guards directly', () => {
    const source = '.match(@value) when (not (@value < 2) and iscolor(red), default()) { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'MixinDef', name: '.match',
        guard: {
          g: 'or',
          left: {
            g: 'and',
            left: {
              g: 'not',
              inner: {
                g: 'cmp', op: '<',
                left: { type: 'VariableReference', name: 'value' },
                right: { type: 'Dimension', number: 2, unit: '', src: '2' }
              }
            },
            right: {
              g: 'call', name: 'iscolor',
              args: [{ type: 'Color', src: 'red' }]
            }
          },
          right: { g: 'default' }
        }
      }]
    });
  });

  it('constructs default() as the typed comparison operand used by mixin dispatch', () => {
    const source = '.fallback(@value) when (@value = default()) { color: red; }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'MixinDef', name: '.fallback',
        guard: {
          g: 'cmp', op: '=',
          left: { type: 'VariableReference', name: 'value', lookup: 'scoped' },
          right: { type: 'FunctionCall', name: 'default', args: [] }
        }
      }]
    });
  });

  it('requires default() rather than widening the dispatch guard to a bare keyword', () => {
    const source = '.fallback() when default { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    // The historical CST grammar currently accepts this widened spelling. The
    // direct AST route must not manufacture the `{ g: "default" }` sentinel
    // unless the source actually contains the Less `default()` syntax.
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value)).toBe(false);
  });

  it('rejects URL control characters that have no valid URL-token representation', () => {
    for (const source of ['background: url(foo\u0007bar);']) {
      const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value)).toBe(false);
      expect(result.ok ? result.unconsumedFrom : result.errors).not.toBeNull();
    }
  });

  it('constructs wrapped unquoted data URLs without widening ordinary URL text', () => {
    const source = '.asset { data: url(data:image/png;charset=utf-8;base64,\n  kiVBORw0K\n  k//+l2Z/dA==); escaped: url(http://example.test/a\\(b\\)); plain: url( icons/a.svg ); }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        body: [
          { type: 'Declaration', name: 'data', value: { type: 'Url', value: { type: 'Any', src: 'data:image/png;charset=utf-8;base64,\n  kiVBORw0K\n  k//+l2Z/dA==' } } },
          { type: 'Declaration', name: 'escaped', value: { type: 'Url', value: { type: 'Any', src: 'http://example.test/a\\(b\\)' } } },
          { type: 'Declaration', name: 'plain', value: { type: 'Url', value: { type: 'Any', src: 'icons/a.svg' } } }
        ]
      }]
    });

    for (const invalid of [
      '.asset { value: url(foo bar); }',
      '.asset { value: url(foo\nbar); }'
    ]) {
      const rejected = run(lessAstGrammar.LessAstDocument, invalid, { trivia: lessAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null && isStylesheet(rejected.value)).toBe(false);
    }
  });

  it('retains outer list separators, accepts newline function separators, and retains value comments', () => {
    const directList = run(lessAstGrammar.LessAstDocument, 'shadow: 0,\n  1px;', { trivia: lessAstGrammar.whitespace });
    expect(directList.ok).toBe(true);
    expect(directList.unconsumedFrom).toBeNull();
    expect(isStylesheet(directList.value)).toBe(true);
    expect(directList.value.children[0]).toEqual({
      type: 'Declaration', name: 'shadow', merge: null, important: false,
      value: {
        type: 'List', sep: ',',
        value: [
          { type: 'Dimension', number: 0, unit: '', src: '0' },
          { type: 'Dimension', number: 1, unit: 'px', src: '1px' }
        ]
      }
    });

    for (const source of ['shadow: rgb(1,\n2);']) {
      const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value)).toBe(true);
      expect(result.value).toMatchObject({
        type: 'Stylesheet', children: [{ type: 'Declaration', value: { type: 'FunctionCall', args: [
          { type: 'Dimension', src: '1' },
          { type: 'Dimension', src: '2' }
        ] } }]
      });
    }

    const source = 'shadow: rgb(1, /* note */ 2);';
    const commented = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
    expect(commented.ok).toBe(true);
    expect(commented.unconsumedFrom).toBeNull();
    expect(commented.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Declaration', value: { type: 'FunctionCall', args: [
        { type: 'Dimension', src: '1' },
        [{ type: 'Comment', text: '/* note */' }, { type: 'Dimension', src: '2' }]
      ] } }]
    });
    const serializable = run(lessAstGrammar.LessAstDocument, `.test { ${source} }`, { trivia: lessAstGrammar.whitespace });
    expect(serializable.ok).toBe(true);
    expect(serializable.unconsumedFrom).toBeNull();
    expect(serialize(stylesheet(serializable.value)).css).toBe('.test {\n  shadow: rgb(1, /* note */ 2);\n}\n');
  });

  it('keeps escaped and legacy-hack spelling confined to declaration names and CSS-escaped mixins', () => {
    const accepts = run(lessAstGrammar.LessAstDocument, '@base: red; -theme: blue; @import "plain.less";', { trivia: lessAstGrammar.whitespace });
    expect(accepts.ok && accepts.unconsumedFrom === null && isStylesheet(accepts.value)).toBe(true);

    for (const source of [
      '*color: red;',
      '\\63 olor: red;'
    ]) {
      const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value)).toBe(true);
    }

    for (const source of [
      // The declaration-name terminal must not become a value/variable escape
      // route, and malformed declaration escapes stay out.
      'color: r\\65 d;',
      '@\\63 olor: red;',
      '\\\ncolor: red;',
      '*\\\ncolor: red;'
    ]) {
      const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value)).toBe(false);
    }

    const escapedMixin = run(lessAstGrammar.LessAstDocument, '.\\63 lass() { color: red; }', { trivia: lessAstGrammar.whitespace });
    expect(escapedMixin.ok && escapedMixin.unconsumedFrom === null && isStylesheet(escapedMixin.value)).toBe(true);
  });

  it('constructs structural Less interpolation in values, quoted strings, and property names without source reparse', () => {
    const source = '.x { content: "pre-@{theme}-${tone}"; color: @{map[key]}; fallback: ${tone}; mixed: pre-@{theme}-${tone}; pre-@{theme}-${tone}: @{theme}; --theme-@{theme}-${tone}: "x"; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        {
          type: 'Rule',
          body: [
            {
              type: 'Declaration', name: 'content', value: {
                type: 'Interpolation', parts: [
                  { lit: '"pre-' },
                  { ref: { type: 'VariableReference', name: 'theme' }, unquote: true },
                  { lit: '-' },
                  { ref: { type: 'PropertyReference', name: 'tone', raw: '$tone' }, unquote: true },
                  { lit: '"' }
                ]
              }
            },
            {
              type: 'Declaration', name: 'color', value: {
                type: 'Interpolation', parts: [{ ref: { type: 'Reference', base: { type: 'VariableReference', name: 'map', lookup: 'scoped' }, steps: [{ type: 'BracketLookup', key: { type: 'Keyword', src: 'key' }, keyKind: 'prop' }], raw: '@map[key]' }, unquote: true }]
              }
            },
            {
              type: 'Declaration', name: 'fallback', value: {
                type: 'Interpolation', parts: [{ ref: { type: 'PropertyReference', name: 'tone', raw: '$tone' }, unquote: true }]
              }
            },
            {
              type: 'Declaration', name: 'mixed', value: {
                type: 'Interpolation', parts: [
                  { lit: 'pre-' },
                  { ref: { type: 'VariableReference', name: 'theme' }, unquote: true },
                  { lit: '-' },
                  { ref: { type: 'PropertyReference', name: 'tone', raw: '$tone' }, unquote: true }
                ]
              }
            },
            { type: 'Declaration', name: { type: 'Interpolation' }, value: { type: 'Interpolation' } },
            {
              type: 'Declaration', name: { type: 'Interpolation' },
              value: { type: 'Quoted', src: '"x"', value: 'x', quote: '"', escaped: false }
            }
          ]
        }
      ]
    });
  });

  it('constructs custom-property values from balanced grammar parts and accepts a terminal declaration without a semicolon', () => {
    const source = '@name: accent; .x { --theme: pre-@{name}-post (@{map[key]}) [@{index}] { @{nested} }; --literal: @name; color: red }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'name' },
        {
          type: 'Rule', body: [
            {
              type: 'Declaration',
              name: '--theme',
              value: {
                type: 'Interpolation', parts: [
                  { lit: 'pre-' }, { ref: { type: 'VariableReference', name: 'name' }, unquote: true },
                  { lit: '-post (' }, { ref: { type: 'Reference' }, unquote: true }, { lit: ') [' },
                  { ref: { type: 'VariableReference', name: 'index' }, unquote: true }, { lit: '] { ' },
                  { ref: { type: 'VariableReference', name: 'nested' }, unquote: true }, { lit: ' }' }
                ]
              }
            },
            { type: 'Declaration', name: '--literal', value: { type: 'Any', src: '@name' } },
            { type: 'Declaration', name: 'color', value: { type: 'Color', src: 'red' } }
          ]
        }
      ]
    });
  });

  it('keeps malformed interpolation rejected by both public CST and direct AST property/value routes', () => {
    for (const source of [
      '.x { pre-@{ spaced }-post: red; }',
      '.x { --theme-${}: red; }',
      '.x { color: @{}; }',
      '.x { color: ${ spaced }; }'
    ]) {
      const cst = parseLessCst(source);
      const direct = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
      expect(cst.errors.length + Number(cst.unconsumedFrom !== null), source).toBeGreaterThan(0);
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), source).toBe(false);
    }
  });

  it('preserves escaped quoted bytes and constructs both Less interpolation forms structurally', () => {
    const source = '.x { plain: "a\\"b\\@{literal}-${tone}"; interpolated: "a\\"b\\@{literal}-@{theme}-${tone}"; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule', body: [
          {
            type: 'Declaration', name: 'plain', value: {
              type: 'Interpolation', parts: [
                { lit: '"a\\"b\\@{literal}-' },
                { ref: { type: 'PropertyReference', name: 'tone', raw: '$tone' }, unquote: true },
                { lit: '"' }
              ]
            }
          },
          {
            type: 'Declaration', name: 'interpolated', value: {
              type: 'Interpolation', parts: [
                { lit: '"a\\"b\\@{literal}-' },
                { ref: { type: 'VariableReference', name: 'theme' }, unquote: true },
                { lit: '-' },
                { ref: { type: 'PropertyReference', name: 'tone', raw: '$tone' }, unquote: true },
                { lit: '"' }
              ]
            }
          }
        ]
      }]
    });
  });

  it('constructs static Less escaped quotes as existing escaped Quoted facts', () => {
    const source = '.x { double: ~"a/b"; single: ~\'c d\'; ordinary: "e\\\\ f"; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'double', value: { type: 'Quoted', src: '~"a/b"', value: 'a/b', quote: '"', escaped: true } },
        { type: 'Declaration', name: 'single', value: { type: 'Quoted', src: '~\'c d\'', value: 'c d', quote: '\'', escaped: true } },
        { type: 'Declaration', name: 'ordinary', value: { type: 'Quoted', src: '"e\\\\ f"', value: 'e\\\\ f', escaped: false } }
      ] }]
    });
  });

  it('constructs escaped quoted Less interpolation as an unquoted structural template', () => {
    const source = '@tone: red; .x { color: ~"pre-@{tone}"; }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'VariableDeclaration', name: 'tone' }, {
        type: 'Rule', body: [{
          type: 'Declaration', name: 'color', value: {
            type: 'Interpolation', parts: [
              { lit: 'pre-' },
              { ref: { type: 'VariableReference', name: 'tone', lookup: 'scoped' }, unquote: true }
            ]
          }
        }]
      }]
    });
    expect(serialize(stylesheet(result.value)).css).toBe('.x {\n  color: pre-red;\n}\n');
  });

  it('constructs child-combinator and comma-list selectors structurally', () => {
    const result = run(lessAstGrammar.LessAstDocument, '.a > .b, #c { color: red; }', { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(result.value).toEqual({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: {
          type: 'SelectorList',
          selectors: [
            {
              type: 'ComplexSelector',
              head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.a', interp: null }] },
              tail: [{ comb: '>', compound: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.b', interp: null }] } }]
            },
            {
              type: 'ComplexSelector',
              head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '#c', interp: null }] },
              tail: []
            }
          ]
        },
        body: [{
          type: 'Declaration',
          name: 'color',
          value: { type: 'Color', src: 'red' },
          merge: null,
          important: false
        }]
      }]
    });
  });

  it('retains outer Less comments as typed selector payloads', () => {
    const result = run(lessAstGrammar.LessAstDocument, '#a /* first */, /* second */ .b { x: y; }', { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: { type: 'SelectorList', selectors: [
          { head: { simples: [{ text: '#a' }] }, tail: [{ comb: ' ', compound: { simples: [{ text: '/* first */' }] } }] },
          { head: { simples: [{ text: '/* second */ ' }, { text: '.b' }] }, tail: [] }
        ] }
      }]
    });
    expect(serialize(stylesheet(result.value)).css).toBe('#a /* first */,\n/* second */ .b {\n  x: y;\n}\n');
  });

  it('constructs repeated static combinators as canonical complex segments', () => {
    const source = '.a + .b ~ #c | * || article { color: red; }';
    const legacy = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(result.value.children[0]).toEqual({
      type: 'Rule',
      selector: {
        type: 'SelectorList',
        selectors: [{
          type: 'ComplexSelector',
          head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.a', interp: null }] },
          tail: [
            { comb: '+', compound: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.b', interp: null }] } },
            { comb: '~', compound: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '#c', interp: null }] } },
            { comb: '|', compound: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '*', interp: null }] } },
            { comb: '||', compound: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: 'article', interp: null }] } }
          ]
        }]
      },
      body: [{
        type: 'Declaration', name: 'color', value: { type: 'Color', src: 'red' }, merge: null, important: false
      }]
    });
  });

  it('constructs adjacent static simple selectors as one canonical compound', () => {
    const source = 'button.primary#submit, &.is-open { color: red; }';
    const legacy = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(result.value.children[0]).toEqual({
      type: 'Rule',
      selector: {
        type: 'SelectorList',
        selectors: [
          {
            type: 'ComplexSelector',
            head: {
              type: 'CompoundSelector',
              simples: [
                { type: 'SimpleSelector', text: 'button', interp: null },
                { type: 'SimpleSelector', text: '.primary', interp: null },
                { type: 'SimpleSelector', text: '#submit', interp: null }
              ]
            },
            tail: []
          },
          {
            type: 'ComplexSelector',
            head: {
              type: 'CompoundSelector',
              simples: [
                { type: 'SimpleSelector', text: '&', interp: null },
                { type: 'SimpleSelector', text: '.is-open', interp: null }
              ]
            },
            tail: []
          }
        ]
      },
      body: [{
        type: 'Declaration', name: 'color', value: { type: 'Color', src: 'red' }, merge: null, important: false
      }]
    });
  });

  it('constructs production-parity static ampersand parent selectors directly', () => {
    const source = '&, &-active, &1 { color: red; }';
    const legacy = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    // `ampToken` is a production terminal, not an AST recovery shortcut.  Its
    // static form maps exactly to SimpleSelector.text, which is the existing canonical
    // representation core uses to recognize parent selectors.
    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(result.value.children[0]).toEqual({
      type: 'Rule',
      selector: {
        type: 'SelectorList',
        selectors: ['&', '&-active', '&1'].map(text => ({
          type: 'ComplexSelector',
          head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text, interp: null }] },
          tail: []
        }))
      },
      body: [{
        type: 'Declaration', name: 'color', value: { type: 'Color', src: 'red' }, merge: null, important: false
      }]
    });

    // Parent-selector transforms still have no typed AST/evaluator model.
    for (const unsupported of ['&(1) { color: red; }']) {
      const production = parseLessCst(unsupported);
      const direct = run(lessAstGrammar.LessAstDocument, unsupported, { trivia: lessAstGrammar.whitespace });
      expect(production.errors).toHaveLength(0);
      expect(production.unconsumedFrom).toBeNull();
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value)).toBe(false);
    }
  });

  it('constructs nested Less relative selectors through the existing leading-combinator field', () => {
    const result = run(lessAstGrammar.LessAstDocument, '#first { > .second { + #third { color: purple; } } }', { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [{
        type: 'Rule', selector: { selectors: [{ leadingComb: '>', head: { simples: [{ text: '.second' }] } }] }, body: [{
          type: 'Rule', selector: { selectors: [{ leadingComb: '+', head: { simples: [{ text: '#third' }] } }] }
        }]
      }] }]
    });
    expect(serialize(stylesheet(result.value)).css).toBe('#first > .second + #third {\n  color: purple;\n}\n');
  });

  it('constructs descendant selectors as canonical space-combinator segments', () => {
    const source = '.a .b > .c { color: red; }';
    const legacy = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(result.value.children[0]).toMatchObject({
      type: 'Rule',
      selector: {
        type: 'SelectorList',
        selectors: [{
          type: 'ComplexSelector',
          head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.a' }] },
          tail: [
            { comb: ' ', compound: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.b' }] } },
            { comb: '>', compound: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.c' }] } }
          ]
        }]
      }
    });
  });

  it('constructs interpolated class/id selector tokens as existing Interpolation-backed SimpleSelectors', () => {
    const source = '@name: card; @state: active; .@{name}-item, #tone-@{state} { color: red; &.@{state} { color: blue; } }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'name' },
        { type: 'VariableDeclaration', name: 'state' },
        { type: 'Rule', selector: { type: 'SelectorList', selectors: [
          { head: { simples: [{ type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [{ lit: '.' }, { ref: { type: 'VariableReference', name: 'name' }, unquote: true }, { lit: '-item' }] } }] } },
          { head: { simples: [{ type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [{ lit: '#tone-' }, { ref: { type: 'VariableReference', name: 'state' }, unquote: true }] } }] } }
        ] }, body: [{ type: 'Declaration', name: 'color' }, { type: 'Rule', selector: { selectors: [{ head: { simples: [{ text: '&' }, { type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [{ lit: '.' }, { ref: { type: 'VariableReference', name: 'state' }, unquote: true }] } }] } }] } }] }
      ]
    });
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value)).toEqual({
      css: '.card-item,\n#tone-active {\n  color: red;\n}\n.card-item.active,\n#tone-active.active {\n  color: blue;\n}\n'
    });
  });

  it('keeps a bare interpolation with a glued selector suffix as typed interpolation segments', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '@base: ~".foo"; .outer { & @{base}.bbb { color: red; } }',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{}, {
        type: 'Rule', body: [{
          type: 'Rule', selector: { selectors: [{
            head: { simples: [{ type: 'SimpleSelector', text: '&' }] },
            tail: [{ comb: ' ', compound: { simples: [{ type: 'SimpleSelector', text: null, interp: {
              type: 'Interpolation', parts: [
                { ref: { type: 'VariableReference', name: 'base', lookup: 'scoped' }, unquote: true },
                { lit: '.bbb' }
              ]
            } }
            ] } }]
          }] }
        }]
      }]
    });
  });

  it('constructs glued Less parent-suffix interpolation as one Interpolation-backed selector token', () => {
    const source = '@suffix: active; @left: x; @right: y; .button { &-@{suffix}, &@{left}-@{right} { color: red; } }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'VariableDeclaration' }, { type: 'VariableDeclaration' }, { type: 'VariableDeclaration' }, {
        type: 'Rule', body: [{ type: 'Rule', selector: { selectors: [
          { head: { simples: [{ type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [{ lit: '&-' }, { ref: { type: 'VariableReference', name: 'suffix' } }] } }] } },
          { head: { simples: [{ type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [{ lit: '&' }, { ref: { type: 'VariableReference', name: 'left' } }, { lit: '-' }, { ref: { type: 'VariableReference', name: 'right' } }] } }] } }
        ] } }]
      }]
    });
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value)).toEqual({ css: '.button-active,\n.buttonx-y {\n  color: red;\n}\n' });
  });

  it('keeps malformed, whitespace-split, and extend selector interpolation out of the direct route', () => {
    for (const source of [
      '. @{name}-item { color: red; }',
      '.@{name}:extend(.target) { color: red; }'
    ]) {
      const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('constructs interpolated Less pseudo names as selector interpolation atoms', () => {
    const source = '@pseudo: hover; .card:@{pseudo} { color: black; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'VariableDeclaration' }, {
        type: 'Rule',
        selector: { selectors: [{ head: { simples: [
          { type: 'SimpleSelector', text: '.card' },
          { type: 'SimpleSelector', text: null, interp: { parts: [{ lit: ':' }, { ref: { type: 'VariableReference', name: 'pseudo' } }] } }
        ] } }] }
      }]
    });
  });

  it('constructs static single- and double-colon pseudos as existing SimpleSelector text in compounds and lists', () => {
    const source = '.card:hover::before, .note:focus { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: {
          type: 'SelectorList',
          selectors: [
            {
              type: 'ComplexSelector',
              head: {
                type: 'CompoundSelector',
                simples: [
                  { type: 'SimpleSelector', text: '.card' },
                  { type: 'SimpleSelector', text: ':hover' },
                  { type: 'SimpleSelector', text: '::before' }
                ]
              }
            },
            {
              type: 'ComplexSelector',
              head: {
                type: 'CompoundSelector',
                simples: [
                  { type: 'SimpleSelector', text: '.note' },
                  { type: 'SimpleSelector', text: ':focus' }
                ]
              }
            }
          ]
        }
      }]
    });
  });

  it('constructs macro-fused static An+B pseudos as existing SimpleSelector text', () => {
    const source = '.card:nth-child(odd):nth-last-child(2n + 1), .note:nth-child(even) { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: {
          type: 'SelectorList',
          selectors: [
            {
              type: 'ComplexSelector',
              head: {
                type: 'CompoundSelector',
                simples: [
                  { type: 'SimpleSelector', text: '.card' },
                  { type: 'SimpleSelector', text: ':nth-child(odd)' },
                  { type: 'SimpleSelector', text: ':nth-last-child(2n + 1)' }
                ]
              }
            },
            {
              type: 'ComplexSelector',
              head: {
                type: 'CompoundSelector',
                simples: [
                  { type: 'SimpleSelector', text: '.note' },
                  { type: 'SimpleSelector', text: ':nth-child(even)' }
                ]
              }
            }
          ]
        }
      }]
    });
  });

  it('constructs static selector-valued functional pseudos through the recursive direct selector grammar', () => {
    const source = '.card:not(.disabled):has(.child > .grandchild), .note:is(.a, .b) { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [
        { head: { simples: [{ text: '.card' }, { text: ':not(.disabled)' }, { text: ':has(.child > .grandchild)' }] } },
        { head: { simples: [{ text: '.note' }, { text: ':is(.a,.b)' }] } }
      ] } }]
    });
  });

  it('retains leading combinators inside nested functional pseudo selectors', () => {
    const source = ':is(:not(:has(>.foo)), :has(>.foo.bar)) { overflow: clip; }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule', selector: { selectors: [{ head: { simples: [
        { type: 'SimpleSelector', text: ':is(:not(:has(> .foo)),:has(> .foo.bar))' }
      ] } }] } }]
    });
    expect(isStylesheet(result.value) ? serialize(result.value).css : undefined).toBe(
      ':is(:not(:has(> .foo)),:has(> .foo.bar)) {\n  overflow: clip;\n}\n'
    );
  });

  it('constructs static non-selector functional pseudos as existing SimpleSelector text', () => {
    const source = '.card:lang(en-US)::part(icon):state(foo[bar]) { color: blue; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [{ head: { simples: [
        { type: 'SimpleSelector', text: '.card' },
        { type: 'SimpleSelector', text: ':lang(en-US)' },
        { type: 'SimpleSelector', text: '::part(icon)' },
        { type: 'SimpleSelector', text: ':state(foo[bar])' }
      ] } }] } }]
    });
    expect(isStylesheet(result.value) ? serialize(result.value).css : undefined).toBe(
      '.card:lang(en-US)::part(icon):state(foo[bar]) {\n  color: blue;\n}\n'
    );

    for (const invalid of [
      '.card:nth-child(2n +) { color: blue; }',
      '.card:nth-child(1.5) { color: blue; }',
      '.card:nth-of-type(2n +) { color: blue; }',
      '.card:nth-last-of-type(1.5) { color: blue; }',
      '.card:nth-of-type(2n of .item) { color: blue; }',
      '.card:nth-last-of-type(2n of .item) { color: blue; }',
      '.card:nth-child { color: blue; }',
      '.card:nth-of-type { color: blue; }',
      '.card:lang(@{locale}) { color: blue; }',
      '.card::part(icon-@{name}) { color: blue; }',
      '.card:lang(@locale) { color: blue; }',
      '.card:lang(@@locale) { color: blue; }'
    ]) {
      const direct = run(lessAstGrammar.LessAstDocument, invalid, { trivia: lessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), invalid).toBe(false);
    }
  });

  it('constructs the complete static An+B pseudo family without raw fallback', () => {
    const source = '.child:nth-child(-n+2 of .item):nth-last-child(2n + 1), .type:nth-of-type(odd):nth-last-of-type(3n) { color: blue; }';
    const direct = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({ type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [
      { head: { simples: [{ text: '.child' }, { text: ':nth-child(-n+2 of .item)' }, { text: ':nth-last-child(2n + 1)' }] } },
      { head: { simples: [{ text: '.type' }, { text: ':nth-of-type(odd)' }, { text: ':nth-last-of-type(3n)' }] } }
    ] } }] });
  });

  it('keeps public block-comment trivia inside static selector-valued pseudo arguments', () => {
    const source = '.card:not(/* before */ .disabled, /* between */ .muted):nth-child(/* numeric */ 2n + 1) { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [{ head: { simples: [
        { text: '.card' }, { text: ':not(.disabled,.muted)' }, { text: ':nth-child(2n + 1)' }
      ] } }] } }]
    });
  });

  it('rejects non-selector and interpolation-bearing functional pseudo arguments without a raw fallback', () => {
    for (const source of [
      '.card:not(2n+1) { color: red; }',
      '.card:has(#{dynamic}) { color: red; }',
      '.card:has(.child { color: red; }) { color: red; }',
      '.card:extend/* not a pseudo */(.target) { color: red; }'
    ]) {
      const cst = parseLessCst(source);
      const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('constructs static unqualified attribute selectors as existing SimpleSelector text through the public selector shape', () => {
    const source = '.card[data-state][role=button][title="Save" i] { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: {
          type: 'SelectorList',
          selectors: [{
            type: 'ComplexSelector',
            head: {
              type: 'CompoundSelector',
              simples: [
                { type: 'SimpleSelector', text: '.card' },
                { type: 'SimpleSelector', text: '[data-state]' },
                { type: 'SimpleSelector', text: '[role=button]' },
                { type: 'SimpleSelector', text: '[title="Save" i]' }
              ]
            }
          }]
        }
      }]
    });
  });

  it('constructs CSS-escaped attribute names structurally', () => {
    const result = run(lessAstGrammar.LessAstDocument, '[ng\\:cloak], ng\\:form { display: none; }', { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ selector: { selectors: [
        { head: { simples: [{ text: '[ng\\:cloak]' }] } },
        { head: { simples: [{ text: 'ng\\:form' }] } }
      ] } }]
    });
  });

  it('constructs static namespace attribute selectors from grammar components', () => {
    const source = '.card[svg|role=button][*|data-state][|title="Save" i] { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: {
          type: 'SelectorList',
          selectors: [{
            type: 'ComplexSelector',
            head: {
              type: 'CompoundSelector',
              simples: [
                { type: 'SimpleSelector', text: '.card' },
                { type: 'SimpleSelector', text: '[svg|role=button]' },
                { type: 'SimpleSelector', text: '[*|data-state]' },
                { type: 'SimpleSelector', text: '[|title="Save" i]' }
              ]
            }
          }]
        }
      }]
    });
  });

  it('keeps static namespace type selectors as one SimpleSelector rather than a column-combinator complex', () => {
    const source = 'svg|a, *|a, |a, svg|* { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: {
          type: 'SelectorList',
          selectors: [
            { type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: 'svg|a' }] }, tail: [] },
            { type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '*|a' }] }, tail: [] },
            { type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '|a' }] }, tail: [] },
            { type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: 'svg|*' }] }, tail: [] }
          ]
        }
      }]
    });
  });

  it('keeps the ordinary column combinator distinct from namespace type selector syntax', () => {
    const result = run(lessAstGrammar.LessAstDocument, 'a | b { color: red; }', { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: {
          type: 'SelectorList',
          selectors: [{
            type: 'ComplexSelector',
            head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: 'a' }] },
            tail: [{ comb: '|', compound: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: 'b' }] } }]
          }]
        }
      }]
    });
  });

  it('constructs interpolated attribute selectors as one structural selector token', () => {
    const source = '@field: state; @value: active; @name: role; @quoted: button; .card[data-@{field}=@{value}][svg|@{name}="@{quoted}"] { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'field' },
        { type: 'VariableDeclaration', name: 'value' },
        { type: 'VariableDeclaration', name: 'name' },
        { type: 'VariableDeclaration', name: 'quoted' },
        { type: 'Rule', selector: { selectors: [{ head: { simples: [
          { type: 'SimpleSelector', text: '.card' },
          { type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [{ lit: '[data-' }, { ref: { type: 'VariableReference', name: 'field', lookup: 'scoped' }, unquote: true }, { lit: '=' }, { ref: { type: 'VariableReference', name: 'value', lookup: 'scoped' }, unquote: false }, { lit: ']' }] } },
          { type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [{ lit: '[svg|' }, { ref: { type: 'VariableReference', name: 'name', lookup: 'scoped' }, unquote: true }, { lit: '="' }, { ref: { type: 'VariableReference', name: 'quoted', lookup: 'scoped' }, unquote: true }, { lit: '"]' }] } }
        ] } }] } }
      ]
    });
    if (!isStylesheet(result.value)) {
      throw new TypeError('Expected a direct Less Stylesheet.');
    }
    expect(serialize(result.value).css).toBe('.card[data-state=active][svg|role="button"] {\n  color: red;\n}\n');

    for (const invalid of [
      '.card[@{ spaced }=button] { color: red; }',
      '.card[${name}=button] { color: red; }',
      '@{namespace}|a { color: red; }'
    ]) {
      const direct = run(lessAstGrammar.LessAstDocument, invalid, { trivia: lessAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), invalid).toBe(false);
    }
  });

  it('retains a quoted Less variable when it fills an unquoted attribute-selector value', () => {
    const result = run(
      lessAstGrammar.LessAstDocument,
      '@value: "test3"; .card[data=@{value}] { color: red; }',
      { trivia: lessAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    if (!isStylesheet(result.value)) {
      throw new TypeError('Expected a direct Less Stylesheet.');
    }
    expect(serialize(result.value).css).toBe('.card[data="test3"] {\n  color: red;\n}\n');
  });

  it('keeps the |= attribute operator distinct from a namespace prefix with interpolation', () => {
    const source = '@num: 3; [prop|="value@{num}"] { attributes: yes; }';
    const result = run(lessAstGrammar.LessAstDocument, source, { trivia: lessAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'VariableDeclaration', name: 'num' }, {
        type: 'Rule',
        selector: { selectors: [{ head: { simples: [{
          type: 'SimpleSelector',
          text: null,
          interp: { parts: [{ lit: '[prop|="value' }, { ref: { type: 'VariableReference', name: 'num' }, unquote: true }, { lit: '"]' }] }
        }] } }] }
      }]
    });
  });
});
