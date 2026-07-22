import { describe, expect, it } from 'vitest';
import { makeBuiltinRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../../core/src/ast/evaluator.js';
import { sourceSpanOf } from '../../core/src/ast/provenance.js';
import { serialize } from '../../core/src/ast/serialize.js';
import { parse } from '@jesscss/less-parser';
import { parseLessCst, parseLessDoc } from '@jesscss/less-parser/cst';

describe('public Less parse()', () => {
  it('constructs boundary-complete CSS named colors as Color values', () => {
    const document = parse('@tone: ReD; .card { color: lighten(@tone, 10%); enabled: iscolor(blue); plain: redder; current: currentColor; }');

    expect(document).toMatchObject({
      children: [
        { type: 'VariableDeclaration', name: 'tone', value: { type: 'Color', src: 'ReD' } },
        { type: 'Rule', body: [
          { type: 'Declaration', name: 'color', value: { type: 'FunctionCall', name: 'lighten', args: [{ type: 'VariableReference', name: 'tone', lookup: 'scoped' }, { type: 'Dimension', src: '10%' }] } },
          { type: 'Declaration', name: 'enabled', value: { type: 'FunctionCall', name: 'iscolor', args: [{ type: 'Color', src: 'blue' }] } },
          { type: 'Declaration', name: 'plain', value: { type: 'Keyword', src: 'redder' } },
          { type: 'Declaration', name: 'current', value: { type: 'Keyword', src: 'currentColor' } }
        ] }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.card {\n  color: #ff3333;\n  enabled: true;\n  plain: redder;\n  current: currentColor;\n}\n'
    );
    expect(parse('.x { color: redder; }')).toMatchObject({ children: [{ body: [{ value: { type: 'Keyword', src: 'redder' } }] }] });
    expect(parse('.x { color: red-2; }')).toMatchObject({ children: [{ body: [{ value: { type: 'Keyword', src: 'red-2' } }] }] });
    expect(parse('.x { color: red(foo); }')).toMatchObject({ children: [{ body: [{ value: { type: 'FunctionCall', name: 'red' } }] }] });
  });

  it('retains parser provenance for direct function calls without changing their AST shape', () => {
    const source = '.x { color: rgb(50%,0,0); }';
    const document = parse(source);
    const rule = document.children[0];
    const declaration = rule?.type === 'Rule' ? rule.body[0] : undefined;
    if (declaration?.type !== 'Declaration' || typeof declaration.value !== 'object' || declaration.value === null) {
      throw new Error('expected a declaration with a structured value');
    }

    expect(sourceSpanOf(declaration.value)).toEqual({ start: source.indexOf('rgb'), end: source.indexOf(')') + 1 });
  });

  it('returns the canonical Stylesheet directly while named CST/document APIs remain available', () => {
    const source = '@tone: red;\n.card { color: @tone; }';
    const cst = parseLessCst(source);
    const doc = parseLessDoc(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(doc.tree).not.toBeNull();
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'tone', value: { type: 'Color', src: 'red' } },
        {
          type: 'Rule',
          body: [{ type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'tone' } }]
        }
      ]
    });
  });

  it('does not expose a CST-to-AST compatibility route through parse()', () => {
    expect(() => parse('.card { color: red;')).toThrow(SyntaxError);
  });

  it('constructs standalone Plugin facts with grammar-owned targets and option segments', () => {
    const document = parse('@plugin (mode=@{mode}, nested=(a b)) "./plugin-@{name}.js";');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Plugin',
        target: { type: 'Interpolation' },
        options: { type: 'Interpolation' }
      }]
    });
    const directive = document.children[0];
    expect(directive?.type).toBe('Plugin');
    if (directive?.type !== 'Plugin') {
      throw new Error('Expected Plugin AST fact.');
    }
    expect(directive.options?.parts).toEqual(expect.arrayContaining([
      { lit: 'mode=' },
      { lit: ', nested=(a b)' }
    ]));
  });

  it('keeps explicit empty Less declaration values as canonical empty facts', () => {
    const document = parse('.card { margin: ; padding:; }');

    expect(document).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'margin', value: { type: 'Any', src: '' } },
        { type: 'Declaration', name: 'padding', value: { type: 'Any', src: '' } }
      ] }]
    });
    expect(serialize(document)).toEqual({ css: '.card {\n  margin: ;\n  padding: ;\n}\n' });
  });

  it('recognizes spaced Less priority markers as typed importance', () => {
    const document = parse('.card { color: red !important; width: 100%!important; height: 20px ! important; }');

    expect(document).toMatchObject({
      children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'color', important: true },
        { type: 'Declaration', name: 'width', important: true },
        { type: 'Declaration', name: 'height', important: true }
      ] }]
    });
    expect(serialize(document)).toEqual({ css: '.card {\n  color: red !important;\n  width: 100% !important;\n  height: 20px !important;\n}\n' });
  });

  it('returns interpolated general-enclosed supports facts through public parse()', () => {
    const source = '@kind: card; @supports selector(.@{kind} /* keep */ :is(.a, .b)) { .card { color: red; } }';
    const cst = parseLessCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parse(source)).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'VariableDeclaration', name: 'kind' },
        { type: 'AtRuleBlock', name: '@supports', prelude: {
          type: 'GeneralEnclosed', form: 'function', name: 'selector',
          content: { type: 'Interpolation', parts: [
            { lit: '.' },
            { ref: { type: 'VariableReference', name: 'kind', lookup: 'scoped' }, unquote: true },
            { lit: ' /* keep */ :is(.a, .b)' }
          ] }
        } }
      ]
    });
  });

  it('returns detached rulesets only through public Less call-argument and parameter-default routes', () => {
    const source = '@theme: { color: red; }; .m(@default: { width: 1px; }) { } .m({ color: blue; }); .m(@named: { color: green; }); fn({ display: block; });';
    const cst = parseLessCst(source);
    const document = parse(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(document).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'VariableDeclaration', name: 'theme', value: { type: 'DetachedRuleset' } },
        { type: 'MixinDef', name: '.m', params: [{ name: 'default', default: { type: 'DetachedRuleset' } }] },
        { type: 'MixinCall', name: '.m', args: [{ value: { type: 'DetachedRuleset' } }] },
        { type: 'MixinCall', name: '.m', args: [{ name: 'named', value: { type: 'DetachedRuleset' } }] },
        { type: 'FunctionCall', name: 'fn', args: [{ type: 'DetachedRuleset' }] }
      ]
    });

    // A detached ruleset is valid as a function argument (including in a
    // declaration value); only a bare value or percent-format argument is invalid.
    for (const rejected of ['value: { color: red; };', 'value: %({ color: red; });']) {
      const legacy = parseLessCst(rejected);
      expect(legacy.unconsumedFrom, rejected).not.toBeNull();
      expect(() => parse(rejected), rejected).toThrow(SyntaxError);
    }
  });

  it('keeps an existing CSS import fact at its nested rule placement through public parse and render', () => {
    const source = '.card { @import url("nested.css"); color: red; }';
    const cst = parseLessCst(source);
    const document = parse(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(document).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [
        { type: 'ImportAtRule', target: { type: 'Url', value: { value: 'nested.css' } } },
        { type: 'Declaration', name: 'color' }
      ] }]
    });
    expect(serialize(document)).toEqual({
      css: '.card {\n  @import url("nested.css");\n  color: red;\n}\n'
    });
  });

  it('uses a static Less selector capture through the public AST and render route', () => {
    const source = '@targets: *[.notice, .tail:nth-child(-n+2)]; @{targets} { color: red; }';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'VariableDeclaration',
        name: 'targets',
        value: { type: 'SelectorCapture', branches: ['.notice', '.tail:nth-child(-n+2)'] }
      }, { type: 'Rule', body: [{ type: 'Declaration', name: 'color', value: { type: 'Color', src: 'red' } }] }]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.notice,\n.tail:nth-child(-n+2) {\n  color: red;\n}\n'
    );

    for (const invalid of [
      '@targets: *[@{selector}];',
      '@targets: *[.card-@{tone}];',
      '@targets: *[.card:not(@{tone})];',
      '@targets: * [.notice];'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('retains top-level comments in the public Stylesheet route', () => {
    expect(parse('/* before */ .card { color: red; } /* after */')).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'Comment', text: '/* before */' },
        { type: 'Rule', body: [{ type: 'Declaration', name: 'color' }] },
        { type: 'Comment', text: '/* after */' }
      ]
    });
  });

  it('retains block comments at typed function-argument boundaries on the public route', () => {
    const document = parse('.card { background: linear-gradient(#333 /* keep */, #111); }');

    expect(document).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [{ type: 'Declaration', value: {
        type: 'FunctionCall', name: 'linear-gradient', args: [
          [{ type: 'Color', src: '#333' }, { type: 'Comment', text: '/* keep */' }],
          { type: 'Color', src: '#111' }
        ]
      } }] }]
    });
    expect(serialize(document).css).toBe('.card {\n  background: linear-gradient(#333 /* keep */, #111);\n}\n');
  });

  it('retains declaration-head block comments structurally in the property interpolation', () => {
    const document = parse('.card { color/* survive */ /* me too */: grey; }');

    expect(document).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [{ type: 'Declaration', name: {
        type: 'Interpolation', parts: [{ lit: 'color/* survive */ /* me too */' }]
      }, value: { type: 'Color', src: 'grey' } }] }]
    });
    expect(serialize(document).css).toBe('.card {\n  color/* survive */ /* me too */: grey;\n}\n');
  });

  it('treats Less line comments as trivia', () => {
    expect(parse('// setup\n.card { color: red; }')).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        body: [{ type: 'Declaration', name: 'color', value: { type: 'Color', src: 'red' } }]
      }]
    });
    expect(parse('.card { background: url(//cdn.example/icon.svg); }')).toMatchObject({
      children: [{
        type: 'Rule',
        body: [{ type: 'Declaration', name: 'background', value: {
          type: 'Url', value: { type: 'Any', src: '//cdn.example/icon.svg' }
        } }]
      }]
    });
  });

  it('preserves wrapped unquoted data URLs through the public parser boundary', () => {
    expect(parse('.asset { image: url( data:image/png;base64,\n  kiVBORw0K\n  k//+l2Z/dA== ); }')).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        body: [{
          type: 'Declaration', name: 'image', value: {
            type: 'Url', value: { type: 'Any', src: 'data:image/png;base64,\n  kiVBORw0K\n  k//+l2Z/dA==' }
          }
        }]
      }]
    });
  });

  it('keeps keyframes-header block comments as typed prelude facts on the public route', () => {
    const document = parse('@-webkit-keyframes /* Safari */ hover /* and Chrome */ { 0% { color: red; } }');

    expect(document).toMatchObject({
      type: 'Stylesheet', children: [{
        type: 'AtRuleBlock', name: '@-webkit-keyframes', prelude: {
          type: 'SpacedValue', parts: [
            { type: 'Any', src: '/* Safari */' },
            { type: 'Keyword', src: 'hover' },
            { type: 'Any', src: '/* and Chrome */' }
          ]
        },
        body: [{ type: 'Rule', body: [{ type: 'Declaration', name: 'color' }] }]
      }]
    });
  });

  it('accepts empty statements in an ordinary ruleset without inventing AST nodes', () => {
    expect(parse('.card { ; color: red; ; }')).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        body: [{ type: 'Declaration', name: 'color', value: { type: 'Color', src: 'red' } }]
      }]
    });
  });

  it('keeps CSS unicode-range tokens opaque and outside Less arithmetic on the public AST route', () => {
    const source = '@font-face { unicode-range: U+??????, U+0???, U+0-7F, U+A5; } .range { values: U+0-7F 1, U+A5; }';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        {
          type: 'AtRuleBlock', name: '@font-face', body: [{
            type: 'Declaration', name: 'unicode-range', value: {
              type: 'List', sep: ',', value: [
                { type: 'Any', src: 'U+??????' },
                { type: 'Any', src: 'U+0???' },
                { type: 'Any', src: 'U+0-7F' },
                { type: 'Any', src: 'U+A5' }
              ]
            }
          }]
        },
        {
          type: 'Rule', body: [{
            type: 'Declaration', name: 'values', value: {
              type: 'List', sep: ',', value: [
                [{ type: 'Any', src: 'U+0-7F' }, { type: 'Dimension', src: '1' }],
                { type: 'Any', src: 'U+A5' }
              ]
            }
          }]
        }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '@font-face {\n  unicode-range: U+??????, U+0???, U+0-7F, U+A5;\n}\n.range {\n  values: U+0-7F 1, U+A5;\n}\n'
    );

    expect(() => parse('.range { value: U+0-7F + 1; }')).toThrow(SyntaxError);
  });

  it('retains escaped ordinary declaration names and the Less star hack without widening other identifier positions', () => {
    const source = '.card { \\63 olor: red; *zoom: 1; }';
    const cst = parseLessCst(source);
    const document = parse(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: '\\63 olor', value: { type: 'Color', src: 'red' } },
        { type: 'Declaration', name: '*zoom', value: { type: 'Dimension', src: '1' } }
      ] }]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.card {\n  \\63 olor: red;\n  *zoom: 1;\n}\n'
    );

    for (const invalid of [
      'color: r\\65 d;',
      '@\\63 olor: red;',
      '\\\ncolor: red;',
      '*\\\ncolor: red;'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('returns a structural interpolated quoted import target directly', () => {
    const document = parse('@import (less, multiple) "theme-@{name}.css" screen;');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'ImportAtRule',
        target: {
          type: 'Interpolation',
          parts: [
            { lit: '"theme-' },
            { ref: { type: 'VariableReference', name: 'name' }, unquote: true },
            { lit: '.css"' }
          ]
        }
      }]
    });
    expect(() => parse('@import "theme-@{name}.css;')).toThrow(SyntaxError);
  });

  it('returns and renders one complete interpolated import tail directly', () => {
    const document = parse('@media: print; @import "theme.less" @{media};');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'media' },
        {
          type: 'ImportAtRule',
          target: { type: 'Quoted', value: 'theme.less' },
          tail: {
            type: 'Interpolation',
            parts: [{ ref: { type: 'VariableReference', name: 'media', lookup: 'scoped' }, unquote: true }]
          }
        }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe('@import "theme.less" print;\n');

    for (const invalid of [
      '@import "theme.less" @{media} screen;',
      '@import "theme.less" screen @{media};',
      '@import "theme.less" @{media}@{print};'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('returns and evaluates a variable-bearing import query tail directly', () => {
    const document = parse('@var: 100px; @import url("//ha.com/file.css") (min-width:@var);');

    expect(document).toMatchObject({
      children: [
        { type: 'VariableDeclaration', name: 'var' },
        {
          type: 'ImportAtRule',
          target: { type: 'Url', value: { type: 'Quoted', value: '//ha.com/file.css' } },
          tail: { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':' } }
        }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe('@import url("//ha.com/file.css") (min-width: 100px);\n');
  });

  it('renders public typed interpolation in dynamic URL, import, and block-header positions', () => {
    const source = '@asset: icons; @theme: theme; @query: screen; @condition: "(display: grid)"; @animation: fade; .asset { image: url(@asset/path.svg); template: url(@{theme}/icon.svg); } @import url(@{theme}.css); @media @{query} { .media { color: red; } } @supports @{condition} { .supports { display: grid; } } @keyframes @{animation} { from { opacity: 0; } }';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'asset' },
        { type: 'VariableDeclaration', name: 'theme' },
        { type: 'VariableDeclaration', name: 'query' },
        { type: 'VariableDeclaration', name: 'condition' },
        { type: 'VariableDeclaration', name: 'animation' },
        { type: 'Rule', body: [
          { type: 'Declaration', name: 'image', value: { type: 'Url', value: { type: 'Interpolation' } } },
          { type: 'Declaration', name: 'template', value: { type: 'Url', value: { type: 'Interpolation' } } }
        ] },
        { type: 'ImportAtRule', target: { type: 'Url', value: { type: 'Interpolation' } } },
        { type: 'AtRuleBlock', name: '@media', prelude: { type: 'Interpolation' } },
        { type: 'AtRuleBlock', name: '@supports', prelude: { type: 'Interpolation' } },
        { type: 'AtRuleBlock', name: '@keyframes', prelude: { type: 'Interpolation' } }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.asset {\n  image: url(icons/path.svg);\n  template: url(theme/icon.svg);\n}\n@import url(theme.css);\n@media screen {\n  .media {\n    color: red;\n  }\n}\n@supports (display: grid) {\n  .supports {\n    display: grid;\n  }\n}\n@keyframes fade {\n  from {\n    opacity: 0;\n  }\n}\n'
    );

    for (const invalid of [
      '@media @{query} screen { .media { color: red; } }',
      '@container @{query} { .media { color: red; } }',
      '@custom @{query} { .media { color: red; } }',
      '@custom foo@{query} { .media { color: red; } }',
      '@custom foo @{query} { .media { color: red; } }',
      '@custom foo@{query};',
      '@custom foo @{query};'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('keeps invalid interpolation-shaped quoted import text literal', () => {
    for (const source of [
      '@import "theme-@{bad.path}.css";',
      '@import "theme-@{ x }.css";',
      '@import "theme-@{}.css";'
    ]) {
      expect(parse(source)).toMatchObject({
        children: [{ type: 'ImportAtRule', target: { type: 'Quoted' } }]
      });
    }
  });

  it('returns a structural custom-property interpolation and a final declaration without a semicolon', () => {
    const document = parse('@name: accent; .card { --theme: pre-@{name}; color: red }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'VariableDeclaration', name: 'name' }, {
        type: 'Rule', body: [
          { type: 'Declaration', name: '--theme', value: { type: 'Interpolation', parts: [{ lit: 'pre-' }, { ref: { type: 'VariableReference', name: 'name' }, unquote: true }] } },
          { type: 'Declaration', name: 'color', value: { type: 'Color', src: 'red' } }
        ]
      }]
    });
  });

  it('renders a detached-ruleset binding and call from the public AST route', () => {
    const document = parse('@theme: { ; @accent: blue; color: @accent; ; };\n.card { @theme(); }');

    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.card {\n  color: blue;\n}\n'
    );
  });

  it('returns and renders full detached-ruleset and each callback bodies from the public AST route', () => {
    const document = parse('@theme: { .nested { color: red; } @media screen { .media { color: blue; } } .tone() { color: green; } each(1 2, { .item { order: @value; } }); }; .card { @theme(); } each(3 4, .(@entry) { .entry { order: @entry; } });');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', value: { type: 'DetachedRuleset', body: [{ type: 'Rule' }, { type: 'AtRuleBlock' }, { type: 'MixinDef' }, { type: 'For' }] } },
        { type: 'Rule', body: [{ type: 'Reference', base: { type: 'VariableReference' }, steps: [{ type: 'Call', args: [] }] }] },
        { type: 'For', rules: [{ type: 'Rule' }] }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.card .nested {\n  color: red;\n}\n@media screen {\n  .card .media {\n    color: blue;\n  }\n}\n.card .item {\n  order: 1;\n  order: 2;\n}\n.entry {\n  order: 3;\n}\n.entry {\n  order: 4;\n}\n'
    );
  });

  it('iterates a flat static mixin call through the existing public For evaluator path', () => {
    const source = '.values() { first: red; second: blue; } each(.values(), .(@value, @key) { .item { value: @value; key: @key; } });';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'MixinDef', name: '.values' },
        { type: 'For', iterable: { type: 'MixinCall', name: '.values', args: [], path: [] }, binding: { kind: 'comma', names: ['value', 'key', undefined] } }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.item {\n  value: red;\n  key: first;\n}\n.item {\n  value: blue;\n  key: second;\n}\n'
    );
    for (const source of [
      'each(.@{name}(), { .item { value: @value; } });'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('iterates a static namespaced mixin call through the existing MixinCall path evaluator', () => {
    const source = '.library { .values() { first: red; second: blue; } } each(.library > .values(), .(@value, @key) { .item { value: @value; key: @key; } });';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'Rule', body: [{ type: 'MixinDef', name: '.values' }] },
        { type: 'For', iterable: { type: 'MixinCall', name: '.values', args: [], path: [{ comb: ' ', sel: '.library' }] }, binding: { kind: 'comma', names: ['value', 'key', undefined] } }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.item {\n  value: red;\n  key: first;\n}\n.item {\n  value: blue;\n  key: second;\n}\n'
    );
    for (const invalid of [
      'each(.library > .@{name}(), { .item { value: @value; } });',
      'each(.library > .values() !important, { .item { value: @value; } });',
      'each(.library > .values();, { .item { value: @value; } });'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('binds a flat static mixin call as an existing callable declaration map', () => {
    const source = '.make-map() { tone: blue; } @map: .make-map(); .lookup { color: @map[tone]; } .call { @map(); }';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'MixinDef', name: '.make-map' },
        { type: 'VariableDeclaration', name: 'map', value: { type: 'MixinCall', name: '.make-map', args: [], path: [], important: false } },
        { type: 'Rule', body: [{ type: 'Declaration', value: { type: 'Reference', base: { type: 'VariableReference', name: 'map' }, steps: [{ type: 'BracketLookup', keyKind: 'prop' }] } }] },
        { type: 'Rule', body: [{ type: 'Reference', base: { type: 'VariableReference', name: 'map', lookup: 'scoped' }, steps: [{ type: 'Call', args: [] }] }] }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.lookup {\n  color: blue;\n}\n.call {\n  tone: blue;\n}\n'
    );
    // A namespaced mixin call is a valid Less value: it carries the same
    // callable declaration map as the flat form, with its namespace path.
    const namespaced = parse('.library { .make-map() { tone: blue; } } @map: .library > .make-map(); .lookup { color: @map[tone]; } .call { @map(); }');
    expect(namespaced.children[0]).toMatchObject({ type: 'Rule', body: [{ type: 'MixinDef', name: '.make-map' }] });
    expect(namespaced.children[1]).toMatchObject({
      type: 'VariableDeclaration', name: 'map',
      value: { type: 'MixinCall', name: '.make-map', args: [], path: [{ comb: ' ', sel: '.library' }], important: false }
    });
    expect(serialize(namespaced, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.lookup {\n  color: blue;\n}\n.call {\n  tone: blue;\n}\n'
    );
    expect(() => parse('@map: .make-map() !important;')).toThrow(SyntaxError);
  });

  it('lowers empty Less namespace access to the existing final bracket index', () => {
    const document = parse('.library { .answer() { value: blue; } } .out { value: .library.answer[]; }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule' }, {
        type: 'Rule', body: [{
          type: 'Declaration', name: 'value', value: {
            type: 'Reference',
            base: { type: 'MixinCall', name: '.answer', path: [{ comb: ' ', sel: '.library' }], args: [] },
            steps: [{ type: 'BracketLookup', keyKind: 'index', key: -1 }],
            raw: '.library .answer[-1]'
          }
        }]
      }]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe('.out {\n  value: blue;\n}\n');
  });

  it('retains and renders typed static keyframes from detached-ruleset and each callback bodies', () => {
    const source = '@theme: { @keyframes fade { from { opacity: 0; } } }; .host { @theme(); } each(1, { @-webkit-keyframes "slide" { 50% { opacity: @value; } } });';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', value: { type: 'DetachedRuleset', body: [{ type: 'AtRuleBlock', name: '@keyframes', body: [{ type: 'Rule' }] }] } },
        { type: 'Rule', body: [{ type: 'Reference', base: { type: 'VariableReference' }, steps: [{ type: 'Call', args: [] }] }] },
        { type: 'For', rules: [{ type: 'AtRuleBlock', name: '@-webkit-keyframes', prelude: { type: 'Quoted', value: 'slide' }, body: [{ type: 'Rule' }] }] }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '@keyframes fade {\n  from {\n    opacity: 0;\n  }\n}\n@-webkit-keyframes "slide" {\n  50% {\n    opacity: 1;\n  }\n}\n'
    );
    expect(() => parse('each(1, { @keyframes @name { from { opacity: 0; } } });')).toThrow(SyntaxError);
  });

  it('retains a detached-ruleset call inside a parameterized keyframes body', () => {
    const document = parse('.frames(@name) { @keyframes @{name} { @rules(); } @rules: { from { opacity: 1; } }; }');

    expect(document).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'MixinDef', body: [
        { type: 'AtRuleBlock', name: '@keyframes', prelude: { type: 'Interpolation' }, body: [{ type: 'Reference' }] },
        { type: 'VariableDeclaration', name: 'rules' }
      ] }]
    });
  });

  it('unquotes a static escaped keyframe name through public parse', () => {
    const document = parse('@keyframes ~"spin" { from { opacity: 0; } }');
    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock',
        name: '@keyframes',
        prelude: { type: 'Quoted', src: '~"spin"', value: 'spin', escaped: true }
      }]
    });
    expect(serialize(document).css).toBe('@keyframes spin {\n  from {\n    opacity: 0;\n  }\n}\n');
  });

  it('discards empty statements while retaining simple and named each callback bodies on the public route', () => {
    const document = parse('each(1, { ; .simple { order: @value; } ; }); each(2, .(@entry) { ; .named { order: @entry; } ; });');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'For', binding: { kind: 'comma', names: ['value', 'key', 'index'] }, rules: [{ type: 'Rule' }] },
        { type: 'For', binding: { kind: 'single', name: 'entry' }, rules: [{ type: 'Rule' }] }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.simple {\n  order: 1;\n}\n.named {\n  order: 2;\n}\n'
    );
  });

  it('returns and evaluates a typed indirect variable from the public Stylesheet route', () => {
    const document = parse('@name: tone; @tone: red; .card { color: @@name; }');

    expect(document).toEqual({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'name', value: { type: 'Keyword', src: 'tone' }, write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'tone', value: { type: 'Color', src: 'red' }, write: { mode: 'declare' } },
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
          body: [{
            type: 'Declaration', name: 'color', merge: null, important: false,
            value: { type: 'VarIndirect', nameRef: { type: 'VariableReference', name: 'name', lookup: 'scoped' }, lookup: 'scoped' }
          }]
        }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.card {\n  color: red;\n}\n'
    );
  });

  it('returns and renders interpolated selector tokens through the public Stylesheet route', () => {
    const document = parse('@name: card; @state: active; .@{name}-item, #tone-@{state} { color: red; &.@{state} { color: blue; } }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'name' },
        { type: 'VariableDeclaration', name: 'state' },
        { type: 'Rule', selector: { selectors: [
          { head: { simples: [{ type: 'SimpleSelector', text: null, interp: { type: 'Interpolation' } }] } },
          { head: { simples: [{ type: 'SimpleSelector', text: null, interp: { type: 'Interpolation' } }] } }
        ] } }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.card-item,\n#tone-active {\n  color: red;\n}\n.card-item.active,\n#tone-active.active {\n  color: blue;\n}\n'
    );
    for (const invalid of [
      '. @{name}-item { color: red; }',
      '.@{name}:extend(.target) { color: red; }'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('returns and renders glued parent-suffix selector interpolation through nesting', () => {
    const document = parse('@suffix: active; @left: x; @right: y; .button { &-@{suffix}, &@{left}-@{right} { color: red; } }');

    expect(document).toMatchObject({
      children: [{ type: 'VariableDeclaration' }, { type: 'VariableDeclaration' }, { type: 'VariableDeclaration' }, {
        type: 'Rule', body: [{ type: 'Rule', selector: { selectors: [
          { head: { simples: [{ type: 'SimpleSelector', text: null, interp: { type: 'Interpolation' } }] } },
          { head: { simples: [{ type: 'SimpleSelector', text: null, interp: { type: 'Interpolation' } }] } }
        ] } }]
      }]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.button-active,\n.buttonx-y {\n  color: red;\n}\n'
    );
    expect(() => parse('.button { &(1) { color: red; } }')).toThrow(SyntaxError);
  });

  it('returns and evaluates an ordinary typed property reference without treating it as an accessor', () => {
    const source = '.card { color: red; border-color: $color; }';
    const cst = parseLessCst(source);
    const document = parse(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        body: [
          { type: 'Declaration', name: 'color', value: { type: 'Color', src: 'red' } },
          { type: 'Declaration', name: 'border-color', value: { type: 'PropertyReference', name: 'color', raw: '$color' } }
        ]
      }]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.card {\n  color: red;\n  border-color: red;\n}\n'
    );
  });

  it('keeps an ordinary property reference glued and does not widen it into map access', () => {
    for (const source of [
      '.card { border-color: $ color; }',
      '.card { border-color: $color[shade]; }'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('constructs a variable-keyed map accessor with a hyphenated Less variable name', () => {
    const document = parse('@varToGet: default-color; .foo { color: @defaults[@default-color]; }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'varToGet', value: { type: 'Keyword', src: 'default-color' } },
        {
          type: 'Rule',
          body: [{
            type: 'Declaration',
            value: {
              type: 'Reference',
              base: { type: 'VariableReference', name: 'defaults', lookup: 'scoped' },
              steps: [{ type: 'BracketLookup', key: { type: 'VariableReference', name: 'default-color', lookup: 'scoped' }, keyKind: 'var' }],
              raw: '@defaults[@default-color]'
            }
          }]
        }
      ]
    });
  });

  it('constructs an indirect-variable map key without reparsing its source spelling', () => {
    const document = parse('@key: default-color; .foo { color: @defaults[@@key]; }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'key' },
        { type: 'Rule', body: [{ type: 'Declaration', value: {
          type: 'Reference', raw: '@defaults[@@key]', steps: [{
            type: 'BracketLookup', keyKind: 'var', key: {
              type: 'VarIndirect', nameRef: { type: 'VariableReference', name: 'key', lookup: 'scoped' }
            }
          }]
        } }] }
      ]
    });
  });

  it('returns and evaluates typed Less arithmetic from the public Stylesheet route', () => {
    const document = parse('@a: 2; .math { sum: 1 + 2 * 3; grouped: (1 + 2) * 3; neg: -(@a + 1); signed: -2px + 3px; unarySpace: - @a; ratio: 12px / 1.5; calc: calc(100% - (20px / 2)); }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'a' },
        { type: 'Rule', body: [
          { type: 'Declaration', name: 'sum', value: { type: 'Operation', operator: '+' } },
          { type: 'Declaration', name: 'grouped', value: { type: 'Operation', operator: '*' } },
          { type: 'Declaration', name: 'neg', value: { type: 'Operation', operator: '*' } },
          { type: 'Declaration', name: 'signed', value: { type: 'Operation', operator: '+' } },
          { type: 'Declaration', name: 'unarySpace', value: [{ type: 'Keyword', src: '-' }, { type: 'VariableReference', name: 'a', lookup: 'scoped' }] },
          { type: 'Declaration', name: 'ratio', value: [{ type: 'Dimension', src: '12px' }, { type: 'Keyword', src: '/' }, { type: 'Dimension', src: '1.5' }] },
          { type: 'Declaration', name: 'calc', value: { type: 'FunctionCall', name: 'calc' } }
        ] }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.math {\n  sum: 7;\n  grouped: 9;\n  neg: -3;\n  signed: 1px;\n  unarySpace: - 2;\n  ratio: 12px / 1.5;\n  calc: calc(100% - 10px);\n}\n'
    );
  });

  it('evaluates comment-aware Less product operators on the public Stylesheet route', () => {
    const document = parse('.math { product: 2 * // factor\n 3; modulo: 7 // divisor\n % 3; }');
    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'product', value: { type: 'Operation', operator: '*' } },
        { type: 'Declaration', name: 'modulo', value: { type: 'Operation', operator: '%' } }
      ] }]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.math {\n  product: 6;\n  modulo: 1;\n}\n'
    );
    expect(() => parse('.math { product: 2 * // missing operand\n; }')).toThrow();
  });

  it('returns and evaluates deprecated Less percent-format calls through the public route', () => {
    const document = parse('.card { text: %("hello %s", "world"); }');
    expect(document).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [{
        type: 'Declaration', value: { type: 'FunctionCall', name: '%' }
      }] }]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.card {\n  text: "hello world";\n}\n'
    );

    const escaped = parse('.card { text: %(~"hello %s", "world"); }');
    expect(serialize(escaped, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.card {\n  text: hello world;\n}\n'
    );
  });

  it('returns static attribute selectors from the public Stylesheet route', () => {
    const document = parse('.card[data-state][role=button][title="Save" i] { color: red; }');

    expect(document).toMatchObject({
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

  it('returns static namespace attribute selectors from the public Stylesheet route', () => {
    const document = parse('.card[svg|role=button][*|data-state][|title="Save" i] { color: red; }');

    expect(document).toMatchObject({
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

  it('returns and evaluates interpolated attribute selectors through the public route', () => {
    const document = parse('@field: state; @value: active; @name: role; @quoted: button; .card[data-@{field}=@{value}][svg|@{name}="@{quoted}"] { color: red; }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'VariableDeclaration', name: 'field' }, { type: 'VariableDeclaration', name: 'value' }, { type: 'VariableDeclaration', name: 'name' }, { type: 'VariableDeclaration', name: 'quoted' }, {
        type: 'Rule', selector: { selectors: [{ head: { simples: [
          { type: 'SimpleSelector', text: '.card' },
          { type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [{ lit: '[data-' }, { ref: { type: 'VariableReference', name: 'field' } }, { lit: '=' }, { ref: { type: 'VariableReference', name: 'value' } }, { lit: ']' }] } },
          { type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [{ lit: '[svg|' }, { ref: { type: 'VariableReference', name: 'name' } }, { lit: '="' }, { ref: { type: 'VariableReference', name: 'quoted' } }, { lit: '"]' }] } }
        ] } }] } }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.card[data-state=active][svg|role="button"] {\n  color: red;\n}\n'
    );

    for (const invalid of ['.card[@{ spaced }=button] { color: red; }', '.card[${name}=button] { color: red; }']) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('returns static namespace type selectors as one SimpleSelector from the public Stylesheet route', () => {
    const document = parse('svg|a, *|a, |a, svg|* { color: red; }');

    expect(document).toMatchObject({
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

  it('returns and renders static selector-valued functional pseudos from the public route', () => {
    const document = parse('.card:not(.disabled):has(.child > .grandchild) { color: red; }');

    expect(document).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [{ head: { simples: [
        { text: '.card' }, { text: ':not(.disabled)' }, { text: ':has(.child > .grandchild)' }
      ] } }] } }]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.card:not(.disabled):has(.child > .grandchild) {\n  color: red;\n}\n'
    );
  });

  it('returns and renders static non-selector functional pseudos from the public route', () => {
    const document = parse('.card:lang(en-US)::part(icon):state(foo[bar]) { color: red; }');

    expect(document).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [{ head: { simples: [
        { text: '.card' }, { text: ':lang(en-US)' }, { text: '::part(icon)' }, { text: ':state(foo[bar])' }
      ] } }] } }]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.card:lang(en-US)::part(icon):state(foo[bar]) {\n  color: red;\n}\n'
    );
    for (const source of [
      '.card:lang(@{locale}) { color: red; }',
      '.card::part(icon-@{name}) { color: red; }',
      '.card:lang(@locale) { color: red; }',
      '.card:lang(@@locale) { color: red; }',
      '.card:nth-of-type(2n of .item) { color: red; }',
      '.card:nth-child { color: red; }'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('returns and renders bounded typed static @supports conditions from the public route', () => {
    const document = parse('@supports ((display: grid) or (color: red)) and (hover) { .card { color: red; } }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock', name: '@supports',
        prelude: { type: 'SpacedValue', parts: [
          { type: 'Block', delimiter: 'paren', inner: { type: 'SpacedValue' } },
          { type: 'Keyword', src: 'and' },
          { type: 'Block', delimiter: 'paren', inner: { type: 'Keyword', src: 'hover' } }
        ] }
      }]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '@supports ((display: grid) or (color: red)) and (hover) {\n  .card {\n    color: red;\n  }\n}\n'
    );
  });

  it('returns and renders structural media/container query preludes from the public route', () => {
    const document = parse('@limit: 40rem; @media only screen and (min-width: @limit), print { .card { color: red; } } @container sidebar (400px < width < @limit) { .card { color: blue; } }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'limit' },
        { type: 'AtRuleBlock', name: '@media', prelude: { type: 'List', sep: ',', value: [
          { type: 'SpacedValue', parts: [{ type: 'Keyword', src: 'only' }, { type: 'Keyword', src: 'screen' }, { type: 'Keyword', src: 'and' }, { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':' } }] },
          { type: 'Keyword', src: 'print' }
        ] } },
        { type: 'AtRuleBlock', name: '@container', prelude: { type: 'SpacedValue', parts: [{ type: 'Keyword', src: 'sidebar' }, { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: '<' } }] } }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '@media only screen and (min-width: 40rem), print {\n  .card {\n    color: red;\n  }\n}\n@container sidebar (400px < width < 40rem) {\n  .card {\n    color: blue;\n  }\n}\n'
    );
    for (const source of [
      '@container selector(.card) { .card { color: red; } }',
      '@media screen (width > 10px) { .card { color: red; } }'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('keeps interpolated Less media-query terms structural in a multi-term header', () => {
    const document = parse('@all: ~"all"; @tv: ~"(tv)"; @media @{all} and @{tv} { .card { color: red; } }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'all' },
        { type: 'VariableDeclaration', name: 'tv' },
        { type: 'AtRuleBlock', name: '@media', prelude: { type: 'SpacedValue', parts: [
          { type: 'Interpolation' }, { type: 'Keyword', src: 'and' }, { type: 'Interpolation' }
        ] } }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '@media all and (tv) {\n  .card {\n    color: red;\n  }\n}\n'
    );
  });

  it('preserves a structural query prelude when a media block is emitted from nested mode', () => {
    const document = parse('@limit: 40rem; .card { @media (min-width: @limit) { color: red; } }');

    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '@media (min-width: 40rem) {\n  .card {\n    color: red;\n  }\n}\n'
    );
  });

  it('accepts selector comments in static functional pseudo arguments on the public route', () => {
    const document = parse('.card:not(/* before */ .disabled, /* between */ .muted, .a /* left */ > /* right */ .b):nth-child(/* numeric */ 2n + 1) { color: red; }');

    expect(document).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [{ head: { simples: [
        { text: '.card' }, { text: ':not(.disabled,.muted,.a > .b)' }, { text: ':nth-child(2n + 1)' }
      ] } }] } }]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '.card:not(.disabled,.muted,.a > .b):nth-child(2n + 1) {\n  color: red;\n}\n'
    );
  });

  it('does not turn a comment-only simple-selector boundary into a descendant combinator', () => {
    const document = parse('.card:not(.x/* glued */.y, .a /* descendant */ .b) { color: red; }');

    expect(document).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [{ head: { simples: [
        { text: '.card' }, { text: ':not(.x.y,.a .b)' }
      ] } }] } }]
    });
  });

  it('retains outer selector comments on the public route', () => {
    const document = parse('#planadvisor, /* first *//* second */\n.first, /* third */.planning { color: red; }');

    expect(document).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [
        { head: { simples: [{ text: '#planadvisor' }] }, tail: [] },
        { head: { simples: [{ text: '/* first */' }, { text: '/* second */\n' }, { text: '.first' }] }, tail: [] },
        { head: { simples: [{ text: '/* third */' }, { text: '.planning' }] }, tail: [] }
      ] } }]
    });
    expect(serialize(document).css).toBe(
      '#planadvisor,\n/* first *//* second */\n.first,\n/* third */.planning {\n  color: red;\n}\n'
    );
  });

  it('attaches inline extend only to its later comma sibling and lowers !all as partial', () => {
    const document = parse('.body { &:extend(.target !all); } .first, .inline:extend(.target all), .sibling { color: red; }');
    const body = document.children[0];
    const inline = document.children[1];
    if (body?.type !== 'Rule' || inline?.type !== 'Rule') {
      throw new Error('expected two rules with extend instructions');
    }

    expect(body.extendInstructions).toMatchObject([{ partial: true }]);
    expect(inline.extendInstructions).toMatchObject([{ partial: true, subject: { selectors: [{ head: { simples: [{ text: '.inline' }] } }] } }]);
    expect(inline.selector.selectors).toHaveLength(3);
  });

  it('plans a later inline extend for only its attached selector', () => {
    const document = parse('.target { color: navy; } .first, .inline:extend(.target), .sibling {}');
    const css = serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css;

    expect(css).toContain('.target,\n.inline {');
    expect(css).not.toContain('.first {');
    expect(css).not.toContain('.sibling {');
  });

  it('retains an interpolated extend target as a typed selector fact', () => {
    const document = parse('@name: target; .target { color: red; } .replacement:extend(.@{name}) { color: blue; }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'VariableDeclaration', name: 'name' }, { type: 'Rule' }, {
        type: 'Rule',
        extendInstructions: [{
          partial: false,
          target: {
            type: 'SelectorList',
            selectors: [{
              head: {
                simples: [{
                  interp: {
                    type: 'Interpolation',
                    parts: [
                      { lit: '.' },
                      { ref: { type: 'VariableReference', name: 'name', lookup: 'scoped' }, unquote: true }
                    ]
                  }
                }]
              }
            }]
          }
        }]
      }]
    });
  });

  it('rejects a mixin call that mixes comma and semicolon separators', () => {
    const source = '.mixin(@a: 4, @b: 3, @c: 2) {} .mixin-test { .mixin(@a: 5, @b: 6; @c: 7); }';
    expect(() => parse(source)).toThrow(SyntaxError);
  });

  it('evaluates canonical statement bodies inside an inline extend rule through public parse', () => {
    const source = '.paint() { color: red; } .target { width: 1px; } .inline:extend(.target) { .paint(); each(1, { order: @value; }); @media screen { display: block; } }';
    const document = parse(source);
    expect(document).toMatchObject({ children: [
      { type: 'MixinDef' },
      { type: 'Rule' },
      { type: 'Rule', body: [{ type: 'MixinCall' }, { type: 'For' }, { type: 'AtRuleBlock', name: '@media' }] }
    ] });
    const css = serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css;
    expect(css).toContain('.inline {');
    expect(css).toContain('color: red;');
    expect(css).toContain('order: 1;');
    expect(css).toContain('@media screen');
    expect(css).toContain('display: block;');
  });

  it('returns and evaluates parenthesis-free namespaced mixin calls through the public route', () => {
    const document = parse('#theme { .mixin() { color: red; } } .card { #theme > .mixin; } .important { #theme > .mixin !important; }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'Rule', body: [{ type: 'MixinDef', name: '.mixin' }] },
        { type: 'Rule', body: [{ type: 'MixinCall', name: '.mixin', args: [], path: [{ comb: ' ', sel: '#theme' }] }] },
        { type: 'Rule', body: [{ type: 'MixinCall', name: '.mixin', args: [], path: [{ comb: ' ', sel: '#theme' }], important: true }] }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe('.card {\n  color: red;\n}\n.important {\n  color: red !important;\n}\n');
  });

  it('returns static ruleset guards from the public Stylesheet route', () => {
    expect(parse('.wide when (not (@width < 20px) and iscolor(red), default()) { color: red; }')).toMatchObject({
      children: [{ type: 'Rule', guard: { g: 'or', left: { g: 'and', left: { g: 'not' }, right: { g: 'call', name: 'iscolor' } }, right: { g: 'default' } } }]
    });
    expect(() => parse('.x when (@{dynamic}) { color: red; }')).toThrow(SyntaxError);
  });

  it('returns bare function-call statements through the public Stylesheet route', () => {
    const document = parse('e("x"); .card { e("y"); }');
    expect(document).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'FunctionCall', name: 'e', args: [{ type: 'Quoted', value: 'x' }] },
        { type: 'Rule', body: [{ type: 'FunctionCall', name: 'e', args: [{ type: 'Quoted', value: 'y' }] }] }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe('x\n.card {\n  y\n}\n');
  });

  it('returns and renders static escaped quoted values through the public route', () => {
    const document = parse('.x { double: ~"a/b"; single: ~\'c d\'; ordinary: "e\\\\ f"; }');

    expect(document).toMatchObject({
      children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'double', value: { type: 'Quoted', escaped: true, value: 'a/b' } },
        { type: 'Declaration', name: 'single', value: { type: 'Quoted', escaped: true, value: 'c d' } },
        { type: 'Declaration', name: 'ordinary', value: { type: 'Quoted', escaped: false } }
      ] }]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe('.x {\n  double: a/b;\n  single: c d;\n  ordinary: "e\\\\ f";\n}\n');
  });

  it('carries static escaped quotes through import facts, URLs, and guards', () => {
    const document = parse('@choice: ~"yes"; @import (css) ~"foo.css"; .m(@value) when (@value = ~"yes") { guarded: ok; } .card { asset: url(~"a b.svg"); .m(@choice); }');
    const css = serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css;

    expect(document).toMatchObject({
      children: [
        { type: 'VariableDeclaration', value: { type: 'Quoted', escaped: true, value: 'yes' } },
        { type: 'ImportAtRule', target: { type: 'Quoted', escaped: true, value: 'foo.css' } },
        { type: 'MixinDef', guard: { g: 'cmp', op: '=' } },
        { type: 'Rule', body: [{ type: 'Declaration', value: { type: 'Url', value: { type: 'Quoted', escaped: true, value: 'a b.svg' } } }, { type: 'MixinCall' }] }
      ]
    });
    expect(css).toContain('asset: url(a b.svg);');
    expect(css).toContain('guarded: ok;');
  });

  it('keeps terminal and at-rule-body function calls on the public Less route', () => {
    const evaluator = buildEvaluator(makeBuiltinRegistry());

    expect(serialize(parse('e("x")'), { evaluator }).css).toBe('x\n');
    expect(serialize(parse('.card { e("y") }'), { evaluator }).css).toBe('.card {\n  y\n}\n');
    expect(serialize(parse('@media screen { e("z"); }'), { evaluator }).css).toBe('@media screen {\n  z\n}\n');
    expect(serialize(parse('@keyframes a { from { e("k"); } }'), { evaluator }).css).toBe('@keyframes a {\n  from {\n    k\n  }\n}\n');
    expect(serialize(parse('.a:extend(.b) { e("i"); }'), { evaluator }).css).toBe('.a {\n  i\n}\n');
    expect(() => parse('e("x") e("y")')).toThrow(SyntaxError);
  });
});
