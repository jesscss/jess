import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';
import { parseScssCst, parseScssDoc } from '@jesscss/scss-parser/cst';
import { makeBuiltinRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../../core/src/ast/evaluator.js';
import { serialize as serializeMaybeAsync, type SerializeResult } from '../../core/src/ast/serialize.js';

// `serialize` lifts to `Promise<SerializeResult>` only when an async built-in
// forces a leaf onto the async branch — never for these all-sync SCSS fixtures.
// Asserting that here is what lets every case below read `.css` directly, and it
// fails loudly rather than silently comparing against a pending Promise.
function serialize(...args: Parameters<typeof serializeMaybeAsync>): SerializeResult {
  const result = serializeMaybeAsync(...args);
  if (result instanceof Promise) {
    throw new TypeError('This SCSS test expects a synchronous serialize result.');
  }
  return result;
}

describe('@jesscss/scss-parser public parse API', () => {
  it('exposes @supports general-enclosed facts without evaluating their contents', () => {
    const source = '@supports selector(.card-#{$tone}:has([data-x="#{$state}"])) { .card { color: blue; } }';
    const root = parse(source);

    expect(parseScssCst(source).errors).toHaveLength(0);
    expect(root).toMatchObject({
      type: 'Stylesheet', children: [{
        type: 'AtRuleBlock', name: '@supports', prelude: {
          type: 'GeneralEnclosed', form: 'function', name: 'selector', content: {
            type: 'Interpolation', parts: [
              { lit: '.card-' }, { ref: { type: 'VariableReference', name: 'tone' }, unquote: true },
              { lit: ':has([data-x="' }, { ref: { type: 'VariableReference', name: 'state' }, unquote: true }, { lit: '"])' }
            ]
          }
        }
      }]
    });
    expect(() => parse('@supports selector(#{}) { .card { color: blue; } }')).toThrow(SyntaxError);
  });

  it('returns a direct Stylesheet while retaining named CST/document APIs', () => {
    const source = '$tone: blue; .card { color: $tone; }';

    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'tone', value: { type: 'Keyword', src: 'blue' } },
        { type: 'Rule', body: [{ type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'tone' } }] }
      ]
    });
    expect(parseScssDoc(source).tree).not.toBeNull();
  });

  it('accepts a final SCSS variable declaration without a semicolon through public parse', () => {
    expect(parse('$tone: blue')).toEqual({
      type: 'Stylesheet',
      children: [{ type: 'VariableDeclaration', name: 'tone', value: { type: 'Keyword', src: 'blue' }, write: { mode: 'declare' } }]
    });
    expect(() => parse('$one: red $two: blue;')).toThrow(SyntaxError);
  });

  it('keeps static CSS imports as existing facts at selected and nested executable placements', () => {
    const root = parse('@if true { @import "selected.css"; } .card { @import url("nested.css"); color: red; }');

    expect(root).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'If', branches: [{ body: [{ type: 'ImportAtRule', target: { value: 'selected.css' } }] }] },
        { type: 'Rule', body: [
          { type: 'ImportAtRule', target: { type: 'Url', value: { value: 'nested.css' } } },
          { type: 'Declaration', name: 'color' }
        ] }
      ]
    });
    expect(serialize(root)).toEqual({
      css: '@import "selected.css";\n.card {\n  @import url("nested.css");\n  color: red;\n}\n'
    });
  });

  it('parses typed structural property interpolation without CST fallback', () => {
    expect(parse('.card { #{$property}: blue; margin-#{$side}: 1rem; }')).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'property' } }] } },
        { type: 'Declaration', name: { type: 'Interpolation', parts: [{ lit: 'margin-' }, { ref: { type: 'VariableReference', name: 'side' } }] } }
      ] }]
    });
  });

  it('parses SCSS arithmetic and Sass slash-list boundaries through the public Stylesheet route', () => {
    expect(parse('$base: 2; .card { result: 1 + 2 * 3; neg: - $base; pos: + ($base); minus-list: 1 -2; ratio: 1 / 2; grouped: (1 / 2); values: 1 2 + 3; }')).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'VariableDeclaration' }, { type: 'Rule', body: [
        { name: 'result', value: { type: 'Operation', operator: '+', right: { type: 'Operation', operator: '*' } } },
        { name: 'neg', value: { type: 'Operation', operator: '*', left: { src: '-1' }, right: { type: 'VariableReference', name: 'base' } } },
        { name: 'pos', value: { type: 'Block', delimiter: 'paren', inner: { type: 'VariableReference', name: 'base' } } },
        { name: 'minus-list', value: [{ src: '1' }, { src: '-2' }] },
        { name: 'ratio', value: { type: 'List', sep: '/', value: [{ src: '1' }, { src: '2' }] } },
        { name: 'grouped', value: { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: '/' } } },
        { name: 'values', value: [{ src: '1' }, { type: 'Operation', operator: '+' }] }
      ] }]
    });
  });

  it('parses static custom-property tokens as value Keywords through calls, calc, and queries', () => {
    const root = parse('.card { direct: --theme; via-var: var(--theme, --fallback); via-env: env(--safe-area); via-calc: calc(--size + 1px); } @media (width: --viewport) { .media { color: red; } } @supports (display: --mode) { .support { color: blue; } }');
    expect(root).toMatchObject({
      children: [
        { type: 'Rule', body: [
          { name: 'direct', value: { type: 'Keyword', src: '--theme' } },
          { name: 'via-var', value: { type: 'FunctionCall', name: 'var', args: [{ src: '--theme' }, { src: '--fallback' }] } },
          { name: 'via-env', value: { type: 'FunctionCall', name: 'env', args: [{ src: '--safe-area' }] } },
          { name: 'via-calc', value: { type: 'FunctionCall', name: 'calc', args: [{ type: 'Operation', left: { src: '--size' } }] } }
        ] },
        { type: 'AtRuleBlock', name: '@media', prelude: { type: 'Block', delimiter: 'paren', inner: { right: { src: '--viewport' } } } },
        { type: 'AtRuleBlock', name: '@supports', prelude: { type: 'Block', delimiter: 'paren', inner: { right: { src: '--mode' } } } }
      ]
    });
    expect(serialize(root)).toEqual({
      css: '.card {\n  direct: --theme;\n  via-var: var(--theme, --fallback);\n  via-env: env(--safe-area);\n  via-calc: calc(--size + 1px);\n}\n@media (width: --viewport) {\n  .media {\n    color: red;\n  }\n}\n@supports (display: --mode) {\n  .support {\n    color: blue;\n  }\n}\n'
    });

    for (const malformed of [
      '.card { value: --; }',
      '.card { value: --#{$name}; }',
      '.card { value: --theme#{$name}; }',
      '.card { value: -- theme; }',
      '@media (width: --#{$value}) { .bad { color: red; } }'
    ]) {
      expect(() => parse(malformed), malformed).toThrow(SyntaxError);
    }
  });

  it('parses static attribute selectors through the public Stylesheet route', () => {
    expect(parse('.card[data-state="open" i] { color: blue; }')).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule', selector: { selectors: [{ head: { simples: [
        { text: '.card' }, { text: '[data-state="open"i]' }
      ] } }] } }]
    });
  });

  it('parses and renders ordinary SCSS interpolated simple selectors through the public Stylesheet route', () => {
    const root = parse('$kind: card; .#{$kind}-header, #main-#{$kind} { color: blue; }');

    expect(root).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'VariableDeclaration' }, {
        type: 'Rule', selector: { selectors: [
          { head: { simples: [{ type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [
            { lit: '.' }, { ref: { type: 'VariableReference', name: 'kind', lookup: 'live' }, unquote: true }, { lit: '-header' }
          ] } }] } },
          { head: { simples: [{ type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [
            { lit: '#main-' }, { ref: { type: 'VariableReference', name: 'kind', lookup: 'live' }, unquote: true }
          ] } }] } }
        ] }
      }]
    });
    expect(serialize(root)).toEqual({ css: '.card-header,\n#main-card {\n  color: blue;\n}\n' });
  });

  it('parses static placeholder selectors through the public Stylesheet route', () => {
    expect(parse('%notice { color: blue; }')).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule', selector: { selectors: [{ head: { simples: [{ text: '%notice' }] } }] } }]
    });
  });

  it('parses SCSS declaration merge modifiers through the public Stylesheet route', () => {
    expect(parse('.card { font+: Arial; font+_: sans-serif; }')).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'font', merge: ',' },
        { type: 'Declaration', name: 'font', merge: ' ' }
      ] }]
    });
  });

  it('lowers static nested SCSS properties through the public Stylesheet route', () => {
    const root = parse('.card { font: { family: fantasy; weight: bold; } }');

    expect(root).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'font', value: { type: 'Collection', entries: [
          { type: 'Declaration', name: 'family', value: { src: 'fantasy' } },
          { type: 'Declaration', name: 'weight', value: { src: 'bold' } }
        ] } }
      ] }]
    });
    expect(serialize(root)).toEqual({
      css: '.card {\n  font-family: fantasy;\n  font-weight: bold;\n}\n'
    });

    const empty = parse('.empty { font: {}; }');
    expect(empty).toMatchObject({ type: 'Stylesheet', children: [{ type: 'Rule', body: [
      { type: 'Declaration', name: 'font', value: { type: 'Collection', entries: [] } }
    ] }] });
    expect(serialize(empty)).toEqual({ css: '' });

    const interpolated = '$prefix: font; $part: weight; .card { #{$prefix}: { color: red; } font: { #{$part}: bold; } #{$prefix}: { #{$part}: 700; } }';
    expect(parseScssCst(interpolated).errors).toHaveLength(0);
    const dynamic = parse(interpolated);
    expect(dynamic).toMatchObject({
      children: [{ type: 'VariableDeclaration' }, { type: 'VariableDeclaration' }, { type: 'Rule', body: [
        { name: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'prefix' } }] }, value: { type: 'Collection', entries: [
          { name: 'color', value: { src: 'red' } }
        ] } },
        { name: 'font', value: { type: 'Collection', entries: [
          { name: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'part' } }] }, value: { src: 'bold' } }
        ] } },
        { name: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'prefix' } }] }, value: { type: 'Collection', entries: [
          { name: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'part' } }] }, value: { src: '700' } }
        ] } }
      ] }]
    });
    expect(serialize(dynamic)).toEqual({
      css: '.card {\n  font-color: red;\n  font-weight: bold;\n  font-weight: 700;\n}\n'
    });

    const important = '.card { font: 20px { size: 1rem; } !important; }';
    expect(parseScssCst(important).errors).toHaveLength(0);
    expect(parse(important)).toMatchObject({
      children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'font', important: true, value: { type: 'Collection', entries: [
          { type: 'Declaration', name: 'size', important: false }
        ] } }
      ] }]
    });
    expect(serialize(parse(important))).toEqual({
      css: '.card {\n  font: 20px !important;\n  font-size: 1rem;\n}\n'
    });
  });

  it('parses a static SCSS url import through the public Stylesheet route', () => {
    expect(parse('@import url("theme.css");')).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'ImportAtRule', target: { type: 'Url', value: { type: 'Quoted', value: 'theme.css' } } }]
    });
  });

  it('parses and renders the public-CST-valid empty SCSS url import through the public route', () => {
    const root = parse('@import url();');
    expect(root).toEqual({
      type: 'Stylesheet',
      children: [{
        type: 'ImportAtRule', name: '@import', options: null,
        target: { type: 'Url', value: { type: 'Any', src: '' } },
        alias: null, tail: null
      }]
    });
    expect(serialize(root)).toEqual({ css: '@import url();\n' });
  });

  it('parses interpolated SCSS import targets through the public Stylesheet route', () => {
    for (const source of ['@import "theme-#{$mode}.css";', '@import url("theme-#{$mode}.css");']) {
      expect(parse(source)).toMatchObject({
        type: 'Stylesheet',
        children: [{ type: 'ImportAtRule', target: source.includes('url(')
          ? { type: 'Url', value: { type: 'Interpolation' } }
          : { type: 'Interpolation' } }]
      });
    }
  });

  it('keeps unquoted SCSS url interpolation structural through public parse and render', () => {
    const root = parse('$asset: icon; .card { bare: url(#{$asset}); joined: url(images/#{$asset}.svg); }');

    expect(root).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'asset' },
        { type: 'Rule', body: [
          { type: 'Declaration', name: 'bare', value: { type: 'Url', value: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'asset' }, unquote: true }] } } },
          { type: 'Declaration', name: 'joined', value: { type: 'Url', value: { type: 'Interpolation', parts: [{ lit: 'images/' }, { ref: { type: 'VariableReference', name: 'asset' }, unquote: true }, { lit: '.svg' }] } } }
        ] }
      ]
    });
    expect(serialize(root)).toEqual({ css: '.card {\n  bare: url(icon);\n  joined: url(images/icon.svg);\n}\n' });

    for (const malformed of ['.card { image: url(#{}) }', '.card { image: url(images/#{$asset.svg) }']) {
      expect(() => parse(malformed), malformed).toThrow(SyntaxError);
    }
  });

  it('rejects malformed interpolated SCSS import targets through the public route', () => {
    for (const source of ['@import "theme-#{$mode.css";', '@import url("theme-#{$mode.css");', '@import "theme-#{}";', '@import "theme.css"', '@import url(foo bar);', '@import url();, "other.css";']) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('parses static SCSS import options through the public Stylesheet route', () => {
    expect(parse('@import (css, once) "theme.css";')).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'ImportAtRule', options: { type: 'List', sep: ',', value: [{ src: 'css' }, { src: 'once' }] } }]
    });
  });

  it('preserves the bounded static SCSS CSS-import tail as ImportAtRule.tail', () => {
    const media = parse('@import "print.css" print;');
    const layer = parse('@import "theme.css" layer(theme);');
    const layeredMedia = parse('@import "a.css" layer(foo) screen;');

    expect(media).toMatchObject({
      children: [{ type: 'ImportAtRule', target: { value: 'print.css' }, tail: { type: 'Keyword', src: 'print' } }]
    });
    expect(layer).toMatchObject({
      children: [{ type: 'ImportAtRule', target: { value: 'theme.css' }, tail: { type: 'FunctionCall', name: 'layer', args: [{ type: 'Keyword', src: 'theme' }] } }]
    });
    expect(layeredMedia).toEqual({
      type: 'Stylesheet',
      children: [{
        type: 'ImportAtRule', name: '@import', options: null,
        target: { type: 'Quoted', src: '"a.css"', value: 'a.css', quote: '"', escaped: false },
        alias: null,
        tail: {
          type: 'SpacedValue',
          parts: [
            { type: 'FunctionCall', name: 'layer', args: [{ type: 'Keyword', src: 'foo' }], modern: false },
            { type: 'Keyword', src: 'screen' }
          ]
        }
      }]
    });
    expect(serialize(media).css).toBe('@import "print.css" print;\n');
    expect(serialize(layer).css).toBe('@import "theme.css" layer(theme);\n');
    expect(serialize(layeredMedia).css).toBe('@import "a.css" layer(foo) screen;\n');

    for (const unsupported of [
      '@import "theme.css" screen layer(theme);',
      '@import "theme.css" layer(#{$name}) screen;',
      '@import "a.css", "b.css";'
    ]) {
      expect(() => parse(unsupported), unsupported).toThrow(SyntaxError);
    }
  });

  it('preserves typed static CSS-import supports tails without authored-text fallback', () => {
    const simple = parse('@import "theme.css" supports(display: grid);');
    const supported = parse('@import "theme.css" supports((display: grid));');
    const layered = parse('@import "theme.css" layer(tokens) supports((display: grid)) screen;');

    expect(supported).toEqual({
      type: 'Stylesheet',
      children: [{
        type: 'ImportAtRule', name: '@import', options: null,
        target: { type: 'Quoted', src: '"theme.css"', value: 'theme.css', quote: '"', escaped: false },
        alias: null,
        tail: {
          type: 'FunctionCall', name: 'supports', modern: false,
          args: [{ type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':', left: { type: 'Keyword', src: 'display' }, right: { type: 'Keyword', src: 'grid' } } }]
        }
      }]
    });
    expect(simple).toEqual(supported);
    expect(layered).toMatchObject({
      children: [{
        tail: {
          type: 'SpacedValue', parts: [
            { type: 'FunctionCall', name: 'layer', args: [{ type: 'Keyword', src: 'tokens' }] },
            { type: 'FunctionCall', name: 'supports', args: [{ type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':' } }] },
            { type: 'Keyword', src: 'screen' }
          ]
        }
      }]
    });
    // The canonical Operation renderer owns normal whitespace around the
    // declaration-condition colon. The typed tree, not source-byte replay, is
    // the public contract.
    expect(serialize(simple).css).toBe('@import "theme.css" supports((display : grid));\n');
    expect(serialize(supported).css).toBe('@import "theme.css" supports((display : grid));\n');
    expect(serialize(layered).css).toBe('@import "theme.css" layer(tokens) supports((display : grid)) screen;\n');

    for (const unsupported of [
      '@import "theme.css" supports(#{$feature});'
    ]) {
      expect(() => parse(unsupported), unsupported).toThrow(SyntaxError);
    }
  });

  it('parses and renders typed static CSS-import media-query tails through the public route', () => {
    const root = parse('@import "theme.css" layer(tokens) supports((display: grid)) only screen and (min-width: 1px), (color), not (color: red);');
    expect(root).toMatchObject({
      type: 'Stylesheet', children: [{
        type: 'ImportAtRule',
        tail: {
          type: 'SpacedValue', parts: [
            { type: 'FunctionCall', name: 'layer' },
            { type: 'FunctionCall', name: 'supports' },
            {
              type: 'List', sep: ',', value: [
                { type: 'SpacedValue', parts: [{ src: 'only' }, { src: 'screen' }, { src: 'and' }, { type: 'Block', delimiter: 'paren' }] },
                { type: 'Block', delimiter: 'paren', inner: { src: 'color' } },
                { type: 'SpacedValue', parts: [{ src: 'not' }, { type: 'Block', delimiter: 'paren' }] }
              ]
            }
          ]
        }
      }]
    });
    expect(serialize(root)).toEqual({
      css: '@import "theme.css" layer(tokens) supports((display : grid)) only screen and (min-width: 1px), (color), not (color: red);\n'
    });
    expect(parse('@import "theme.css" (color) or (monochrome);')).toMatchObject({
      children: [{ type: 'ImportAtRule', tail: { type: 'SpacedValue', parts: [{ type: 'Block', delimiter: 'paren' }, { src: 'or' }, { type: 'Block', delimiter: 'paren' }] } }]
    });

    for (const source of [
      '@import "theme.css" screen and foo(bar);',
      '@import "theme.css" #{$media};',
      '@import "theme.css" screen /* no raw/comment tail */ and (color);',
      '@import "theme.css" screen, #{$media};',
      '@import "a.css", "b.css" screen;',
      '@import "theme.css" screen or (color);',
      '@import "theme.css" only screen or (color);'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('classifies static SCSS module directives through the public Stylesheet route', () => {
    expect(parse('@use "sass:math" as math; @use "./theme.scss" as theme; @forward "./public.scss";')).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'ModuleImport', mode: 'use', path: { value: '#sass/math' }, namespace: 'math' },
        { type: 'StyleImport', mode: 'compose', path: { value: './theme.scss' }, namespace: 'theme', forward: false },
        { type: 'StyleImport', mode: 'compose', path: { value: './public.scss' }, namespace: null, forward: true }
      ]
    });
  });

  it('requires static SCSS module directives to remain in the document prefix', () => {
    expect(parse('$theme: red; @forward "./public.scss"; @use "./theme.scss"; .card { color: $theme; }')).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'theme' },
        { type: 'StyleImport', forward: true },
        { type: 'StyleImport', forward: false },
        { type: 'Rule' }
      ]
    });
    expect(parse('@use "./theme.scss"; @forward "./public.scss"; .card { color: red; }')).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'StyleImport', forward: false }, { type: 'StyleImport', forward: true }, { type: 'Rule' }]
    });
    for (const source of [
      '.card { color: red; } @use "./theme.scss";',
      '.card { color: red; } @forward "./public.scss";',
      '.card { @use "./theme.scss"; }',
      '.card { @forward "./public.scss"; }'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('keeps static module directives in the comment/variable document prefix', () => {
    const source = '/* head */ $theme: red; // before use\n @use "./theme.scss" as theme; /* between */ @forward "./public.scss"; @import "print.css";';
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'Comment' }, { type: 'VariableDeclaration', name: 'theme' },
        { type: 'Comment' }, { type: 'StyleImport', path: { value: './theme.scss' }, forward: false },
        { type: 'Comment' }, { type: 'StyleImport', path: { value: './public.scss' }, forward: true },
        { type: 'ImportAtRule' }
      ]
    });
  });

  it('parses and renders the restricted static @if route without a CST fallback', () => {
    const root = parse('@if false { .no { color: red; } } @else { .yes { color: green; } }');
    expect(root).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'If', branches: [
        { guard: { g: 'truth', value: { src: 'false' } } },
        { guard: null, body: [{ type: 'Rule' }] }
      ] }]
    });
    expect(serialize(root)).toEqual({ css: '.yes {\n  color: green;\n}\n' });
  });

  it('parses restricted static @if blocks inside the public @media route', () => {
    const root = parse('@media screen { @if true { .inside { color: green; } } @else { .no { color: red; } } }');
    expect(root).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'AtRuleBlock', name: '@media', body: [{ type: 'If', branches: [
        { guard: { g: 'truth', value: { src: 'true' } } }, { guard: null }
      ] }] }]
    });
    expect(serialize(root)).toEqual({ css: '@media screen {\n  .inside {\n    color: green;\n  }\n}\n' });
  });

  it('publishes a selected SCSS @if mixin for a later public sibling', () => {
    const document = parse('@if true { @mixin paint { color: blue; } } .after { @include paint; }');
    expect(document).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'If', branches: [{ body: [{ type: 'MixinDef', name: 'paint' }] }] },
        { type: 'Rule', body: [{ type: 'MixinCall', name: 'paint' }] }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeBuiltinRegistry()) })).toEqual({
      css: '.after {\n  color: blue;\n}\n'
    });
  });

  it('returns arithmetic SCSS @for bounds as canonical Range values through the public route', () => {
    expect(parse('@for $i from 1 + 1 through 4 - 1 { .n { width: $i; } }')).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'For',
        iterable: {
          type: 'Range',
          start: { type: 'Operation', operator: '+' },
          end: { type: 'Operation', operator: '-' },
          includeStart: true,
          includeEnd: true
        }
      }]
    });
  });

  it('keeps direct literal and comparison @if AST reachable in mixin and loop bodies', () => {
    const root = parse('@mixin paint($color) { @if true { color: $color; } } .card { @include paint(red); } @each $tone in blue { @if true { .each { color: $tone; } } } @for $i from 1px through 1px { @if $i == 1px { .step { width: $i; } } }');

    expect(root).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'MixinDef', body: [{ type: 'If', branches: [{ guard: { g: 'truth', value: { src: 'true' } } }] }] },
        { type: 'Rule', body: [{ type: 'MixinCall' }] },
        { type: 'For', binding: { kind: 'single', name: 'tone' }, rules: [{ type: 'If' }] },
        { type: 'For', binding: { kind: 'single', name: 'i' }, rules: [{ type: 'If', branches: [{ guard: { g: 'cmp', op: '=' } }] }] }
      ]
    });
    expect(serialize(root, { evaluator: buildEvaluator(makeBuiltinRegistry()) })).toEqual({
      css: '.card {\n  color: red;\n}\n.each {\n  color: blue;\n}\n.step {\n  width: 1px;\n}\n'
    });

    for (const notThisBatch of [
      '@each $tone in blue { @if $enabled { .each { color: $tone; } } }',
      '@mixin paint { @while true { color: red; } }'
    ]) {
      expect(() => parse(notThisBatch), notThisBatch).toThrow(SyntaxError);
    }
  });

  it('parses descriptor-only @font-face through the public Stylesheet route', () => {
    expect(parse('@font-face { font-family: $font; src: url("font.woff2"); }')).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'AtRuleBlock', name: '@font-face', body: [
        { type: 'Declaration', value: { type: 'VariableReference', name: 'font' } }, { type: 'Declaration', value: { type: 'Url' } }
      ] }]
    });
  });

  it('parses descriptor-only @counter-style through the public Stylesheet route', () => {
    expect(parse('@counter-style thumbs { system: cyclic; }')).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'AtRuleBlock', name: '@counter-style', prelude: { src: 'thumbs' }, body: [{ type: 'Declaration', name: 'system' }] }]
    });
  });

  it('parses and renders static @page/margin blocks at root and inside SCSS nesting', () => {
    const root = parse('@page report:left { size: A4; @top-left { content: "head"; } } @media print { @page :right { margin: 1cm; @bottom-center { content: "folio"; } } } .host { @page appendix { size: letter; } }');

    expect(root).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'AtRuleBlock', name: '@page', prelude: { type: 'Any', src: 'report:left' }, body: [{ type: 'Declaration', name: 'size' }, { type: 'AtRuleBlock', name: '@top-left', prelude: null, body: [{ type: 'Declaration', name: 'content' }] }] },
        { type: 'AtRuleBlock', name: '@media', body: [{ type: 'AtRuleBlock', name: '@page', prelude: { type: 'Any', src: ':right' }, body: [{ type: 'Declaration', name: 'margin' }, { type: 'AtRuleBlock', name: '@bottom-center', body: [{ type: 'Declaration', name: 'content' }] }] }] },
        { type: 'Rule', body: [{ type: 'AtRuleBlock', name: '@page', prelude: { type: 'Any', src: 'appendix' }, body: [{ type: 'Declaration', name: 'size' }] }] }
      ]
    });
    expect(serialize(root, { evaluator: buildEvaluator(makeBuiltinRegistry()) })).toEqual({
      css: '@page report:left {\n  size: A4;\n  @top-left {\n    content: "head";\n  }\n}\n@media print {\n  @page :right {\n    margin: 1cm;\n    @bottom-center {\n      content: "folio";\n    }\n  }\n}\n@page appendix {\n  size: letter;\n}\n'
    });
  });

  it('parses and renders finite static @font-feature-values blocks at root and inside SCSS nesting', () => {
    const root = parse('@font-feature-values "Fira Code", Demo { /* family */ @stylistic { salt: 1; } @styleset { nice: 2; } @character-variant { cv01: 3; } @swash { swsh: 4; } @ornaments { orn: 5; } @annotation { note: 6; } @historical-forms { hist: 7; } } @media print { @font-feature-values Print { @styleset { compact: 1; } } } .host { @font-feature-values Nested { @annotation { label: 1; } } }');

    expect(root).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'AtRuleBlock', name: '@font-feature-values', prelude: { type: 'Any', src: '"Fira Code", Demo' }, body: [
          { type: 'Comment', text: '/* family */' },
          ...['stylistic', 'styleset', 'character-variant', 'swash', 'ornaments', 'annotation', 'historical-forms'].map(name => ({ type: 'AtRuleBlock', name: `@${name}`, prelude: null, body: [{ type: 'Declaration' }] }))
        ] },
        { type: 'AtRuleBlock', name: '@media', body: [{ type: 'AtRuleBlock', name: '@font-feature-values', prelude: { src: 'Print' }, body: [{ type: 'AtRuleBlock', name: '@styleset' }] }] },
        { type: 'Rule', body: [{ type: 'AtRuleBlock', name: '@font-feature-values', prelude: { src: 'Nested' }, body: [{ type: 'AtRuleBlock', name: '@annotation' }] }] }
      ]
    });
    expect(serialize(root, { evaluator: buildEvaluator(makeBuiltinRegistry()) })).toEqual({
      css: '@font-feature-values "Fira Code", Demo {\n  /* family */\n  @stylistic {\n    salt: 1;\n  }\n  @styleset {\n    nice: 2;\n  }\n  @character-variant {\n    cv01: 3;\n  }\n  @swash {\n    swsh: 4;\n  }\n  @ornaments {\n    orn: 5;\n  }\n  @annotation {\n    note: 6;\n  }\n  @historical-forms {\n    hist: 7;\n  }\n}\n@media print {\n  @font-feature-values Print {\n    @styleset {\n      compact: 1;\n    }\n  }\n}\n@font-feature-values Nested {\n  @annotation {\n    label: 1;\n  }\n}\n'
    });
  });

  it('rejects dynamic and non-finite @font-feature-values forms instead of flattening them', () => {
    for (const source of [
      '@font-feature-values #{$family} { @styleset { nice: 1; } }',
      '@font-feature-values Demo { color: red; }',
      '@font-feature-values Demo { @unknown { nice: 1; } }',
      '@font-feature-values Demo { @styleset extra { nice: 1; } }',
      '@font-feature-values Demo { @styleset { .nested { nice: 1; } } }'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('parses and bubbles static @document blocks without a raw or CST route', () => {
    const root = parse('@-MOZ-DOCUMENT url-prefix("https://example.test/"), domain("example.test") { @font-face { font-family: Demo; } .card { color: red; } @document regexp("nested") { .inside { color: blue; } } } @media print { @document url("print") { .print { color: black; } } } .host { @document domain("nested.test") { .child { color: green; } } }');

    expect(root).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'AtRuleBlock', name: '@-MOZ-DOCUMENT', prelude: { type: 'Any', src: 'url-prefix("https://example.test/"), domain("example.test")' }, body: [
          { type: 'AtRuleBlock', name: '@font-face', body: [{ type: 'Declaration', name: 'font-family' }] },
          { type: 'Rule', selector: { selectors: [{ head: { simples: [{ text: '.card' }] } }] } },
          { type: 'AtRuleBlock', name: '@document', prelude: { type: 'Any', src: 'regexp("nested")' }, body: [{ type: 'Rule' }] }
        ] },
        { type: 'AtRuleBlock', name: '@media', body: [{ type: 'AtRuleBlock', name: '@document', body: [{ type: 'Rule' }] }] },
        { type: 'Rule', body: [{ type: 'AtRuleBlock', name: '@document', body: [{ type: 'Rule' }] }] }
      ]
    });
    expect(serialize(root, { evaluator: buildEvaluator(makeBuiltinRegistry()) }).css).toBe(
      '@-MOZ-DOCUMENT url-prefix("https://example.test/"), domain("example.test") {\n'
      + '  @font-face {\n'
      + '    font-family: Demo;\n'
      + '  }\n'
      + '  .card {\n'
      + '    color: red;\n'
      + '  }\n'
      + '  @document regexp("nested") {\n'
      + '    .inside {\n'
      + '      color: blue;\n'
      + '    }\n'
      + '  }\n'
      + '}\n'
      + '@media print {\n'
      + '  @document url("print") {\n'
      + '    .print {\n'
      + '      color: black;\n'
      + '    }\n'
      + '  }\n'
      + '}\n'
      + '@document domain("nested.test") {\n'
      + '  .host .child {\n'
      + '    color: green;\n'
      + '  }\n'
      + '}\n'
    );
  });

  it('rejects dynamic and non-stylesheet @document forms instead of flattening them', () => {
    for (const source of [
      '@document #{$target} { .card { color: red; } }',
      '@document url-prefix("#{$target}") { .card { color: red; } }',
      '@document url("screen") { color: red; }',
      '@document url("screen") { $tone: red; .card { color: $tone; } }',
      '@document url("screen") { @import "nested.css"; }',
      '@page { @document url("screen") { .card { color: red; } } }',
      '@keyframes fade { @document url("screen") { .card { color: red; } } }'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
    expect(parse('@documenté { .card { color: red; } }')).toMatchObject({
      children: [{ type: 'AtRuleBlock', name: '@document', prelude: { type: 'Any', src: 'é' } }]
    });
  });

  /**
   * The `@document` name boundary must not swallow a longer name — but a name it
   * does not own is an UNKNOWN at-rule, not a syntax error. Which at-rules exist
   * is a language-service fact, so these keep their full authored name and reach
   * the opaque capture instead of failing the stylesheet.
   */
  it('keeps a longer at-rule name off @document and captures it opaquely', () => {
    for (const name of ['@documentary', '@-moz-documentary']) {
      expect(parse(`${name} url("screen") { .card { color: red; } }`), name).toMatchObject({
        children: [{ type: 'OpaqueAtRuleBlock', name, prelude: 'url("screen")' }]
      });
    }
  });

  it('parses descriptor-only @property through the public Stylesheet route', () => {
    expect(parse('@property --accent { syntax: "<color>"; inherits: false; initial-value: red; }')).toEqual({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock', name: '@property', prelude: { type: 'Keyword', src: '--accent' }, body: [
          { type: 'Declaration', name: 'syntax', value: { type: 'Quoted', src: '"<color>"', value: '<color>', quote: '"', escaped: false }, merge: null, important: false },
          { type: 'Declaration', name: 'inherits', value: { type: 'Keyword', src: 'false' }, merge: null, important: false },
          { type: 'Declaration', name: 'initial-value', value: { type: 'Keyword', src: 'red' }, merge: null, important: false }
        ]
      }]
    });
  });

  it('parses and renders static keyframes through the public Stylesheet route', () => {
    const root = parse('@keyframes fade { from, 25% { opacity: 0; } to { opacity: 1; } }');

    expect(root).toMatchObject({
      type: 'Stylesheet', children: [{
        type: 'AtRuleBlock', name: '@keyframes', prelude: { type: 'Keyword', src: 'fade' }, body: [
          { type: 'Rule', selector: { selectors: [{ head: { simples: [{ text: 'from' }] } }, { head: { simples: [{ text: '25%' }] } }] }, body: [{ type: 'Declaration', name: 'opacity' }] },
          { type: 'Rule', selector: { selectors: [{ head: { simples: [{ text: 'to' }] } }] }, body: [{ type: 'Declaration', name: 'opacity' }] }
        ]
      }]
    });
    expect(serialize(root)).toEqual({ css: '@keyframes fade {\n  from,\n  25% {\n    opacity: 0;\n  }\n  to {\n    opacity: 1;\n  }\n}\n' });
  });

  it('keeps a static quoted keyframes name as the existing typed prelude', () => {
    const root = parse('@keyframes "fade" { from { opacity: 0; } }');
    expect(root).toMatchObject({
      type: 'Stylesheet', children: [{
        type: 'AtRuleBlock', name: '@keyframes', prelude: { type: 'Quoted', value: 'fade' }
      }]
    });
    expect(serialize(root)).toEqual({ css: '@keyframes "fade" {\n  from {\n    opacity: 0;\n  }\n}\n' });
  });

  it('keeps escapes in a static quoted keyframes name without admitting interpolation', () => {
    const root = parse('@keyframes "fade\\20name" { to { opacity: 1; } }');
    expect(root).toMatchObject({
      type: 'Stylesheet', children: [{
        type: 'AtRuleBlock', name: '@keyframes',
        prelude: { type: 'Quoted', src: '"fade\\20name"', value: 'fade\\20name', quote: '"', escaped: false }
      }]
    });
    expect(serialize(root)).toEqual({ css: '@keyframes "fade\\20name" {\n  to {\n    opacity: 1;\n  }\n}\n' });
  });

  it('accepts comments around static keyframe selector delimiters without turning them into selector text', () => {
    expect(parse('@keyframes fade { from /* after-from */, /* before-half */ 50% /* before-block */ { opacity: 0; } }')).toMatchObject({
      type: 'Stylesheet', children: [{
        type: 'AtRuleBlock', body: [{
          type: 'Rule', selector: { selectors: [
            { head: { simples: [{ text: 'from' }] } },
            { head: { simples: [{ text: '50%' }] } }
          ] }
        }]
      }]
    });
  });

  it('keeps static keyframes structured inside a public conditional group', () => {
    expect(parse('@media screen { @-webkit-keyframes fade { 50% { opacity: .5; } } }')).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'AtRuleBlock', name: '@media', body: [
        { type: 'AtRuleBlock', name: '@-webkit-keyframes', prelude: { src: 'fade' }, body: [
          { type: 'Rule', selector: { selectors: [{ head: { simples: [{ text: '50%' }] } }] } }
        ] }
      ] }]
    });
  });

  it('keeps the direct keyframe selector shape aligned with CSS', () => {
    expect(parse('@-moz-keyframes fade { +50%, -0.5%, 100.% { opacity: 1; } }')).toMatchObject({
      type: 'Stylesheet', children: [{
        type: 'AtRuleBlock', name: '@-moz-keyframes', body: [{
          type: 'Rule', selector: { selectors: [
            { head: { simples: [{ text: '+50%' }] } },
            { head: { simples: [{ text: '-0.5%' }] } },
            { head: { simples: [{ text: '100.%' }] } }
          ] }
        }]
      }]
    });
  });

  it('constructs and renders static CSS @starting-style and @layer blocks through the public Stylesheet route', () => {
    const root = parse('@starting-style { .enter { opacity: 0; } } @layer base.utilities, components /* keep */ { .card { color: red; } }');

    expect(root).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'AtRuleBlock', name: '@starting-style', prelude: null, body: [{ type: 'Rule', selector: { type: 'SelectorList' } }] },
        { type: 'AtRuleBlock', name: '@layer', prelude: { type: 'Any', src: 'base.utilities, components /* keep */' }, body: [{ type: 'Rule', selector: { type: 'SelectorList' } }] }
      ]
    });
    expect(serialize(root)).toEqual({ css: '@starting-style {\n  .enter {\n    opacity: 0;\n  }\n}\n@layer base.utilities, components /* keep */ {\n  .card {\n    color: red;\n  }\n}\n' });
  });

  it('returns static CSS statement at-rules through the public Stylesheet route', () => {
    const root = parse('@charset "UTF-8"; @namespace svg url("https://example.test/svg"); @layer theme;');

    expect(root).toMatchObject({ type: 'Stylesheet', children: [
      { type: 'AtRuleStatement', name: '@charset', prelude: { src: '"UTF-8"' } },
      { type: 'AtRuleStatement', name: '@namespace', prelude: { src: 'svg url("https://example.test/svg")' } },
      { type: 'AtRuleStatement', name: '@layer', prelude: { src: 'theme' } }
    ] });
    expect(serialize(root)).toEqual({
      css: '@charset "UTF-8";\n@namespace svg url("https://example.test/svg");\n@layer theme;\n'
    });
    expect(serialize(parse('@layer theme // local note\n;'))).toEqual({ css: '@layer theme;\n' });
  });

  it('admits the same static CSS block facts in nested SCSS bodies', () => {
    const root = parse('.host { @starting-style { opacity: 0; } @layer utilities { color: blue; } }');

    expect(root).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [
        { type: 'AtRuleBlock', name: '@starting-style', prelude: null, body: [{ type: 'Declaration', name: 'opacity' }] },
        { type: 'AtRuleBlock', name: '@layer', prelude: { type: 'Any', src: 'utilities' }, body: [{ type: 'Declaration', name: 'color' }] }
      ] }]
    });
    expect(serialize(root)).toEqual({ css: '.host {\n  @starting-style {\n    opacity: 0;\n  }\n}\n@layer utilities {\n  .host {\n    color: blue;\n  }\n}\n' });
  });

  it('constructs static CSS @scope blocks through the public Stylesheet route', () => {
    const root = parse('@scope (.card) to (.card > .title) { .item { color: red; } }');
    expect(root).toMatchObject({ type: 'Stylesheet', children: [{
      type: 'AtRuleBlock', name: '@scope', prelude: { type: 'Any', src: '(.card) to (.card > .title)' },
      body: [{ type: 'Rule' }]
    }] });
    expect(serialize(root)).toEqual({ css: '@scope (.card) to (.card > .title) {\n  .item {\n    color: red;\n  }\n}\n' });

    expect(serialize(parse('@media screen { @scope (.card) { .item { color: red; } } }'))).toEqual({
      css: '@media screen {\n  @scope (.card) {\n    .item {\n      color: red;\n    }\n  }\n}\n'
    });
    expect(serialize(parse('.host { @scope (.card) { color: red; } }'))).toEqual({
      css: '@scope (.card) {\n  .host {\n    color: red;\n  }\n}\n'
    });
    expect(serialize(parse('.host { @layer utilities { @scope (.card) { color: red; } } }'))).toEqual({
      css: '@layer utilities {\n  @scope (.card) {\n    .host {\n      color: red;\n    }\n  }\n}\n'
    });
    expect(serialize(parse('@mixin scoped { @scope (.card) { color: red; } }'))).toEqual({ css: '' });
  });

  it('rejects dynamic CSS passthrough headers', () => {
    for (const source of [
      '@layer #{$name} { .a { color: red; } }',
      '@starting-style #{name} { .a { color: red; } }',
      '@layer "#{name}" { .a { color: red; } }',
      '@layer feature(#{name}) { .a { color: red; } }',
      '@scope #{scope} { .a { color: red; } }'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('rejects malformed or non-static direct keyframe structure', () => {
    for (const source of [
      '@keyframes { from { opacity: 0; } }',
      '@keyframes #{$name} { from { opacity: 0; } }',
      '@keyframes "#{$name}" { from { opacity: 0; } }',
      '@keyframes fade { from, { opacity: 0; } }',
      '@keyframes fade { 50 { opacity: 0; } }',
      '@keyframes fade { .from { opacity: 0; } }',
      '@keyframes fade { 50% { .nested { opacity: 0; } } }',
      '.host { @keyframes fade { from { opacity: 0; } } }'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });
});
