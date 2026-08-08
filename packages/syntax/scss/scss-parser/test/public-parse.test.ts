import { describe, expect, it } from 'vitest';
import { parse, ScssImportPostludeError } from '@jesscss/scss-parser';
import { parseScssCst, parseScssDoc } from '@jesscss/scss-parser/cst';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { sourceSpanOf, triviaMapOf } from '../../../../core/src/ast/provenance.js';
import { serialize as serializeMaybeAsync, type SerializeResult } from '../../../../core/src/ast/serialize.js';
import { bare } from '../../../../../test/provenance-free.js';

/*
 * `serialize` lifts to `Promise<SerializeResult>` only when an async built-in
 * forces a leaf onto the async branch — never for these all-sync SCSS fixtures.
 * Asserting that here is what lets every case below read `.css` directly, and it
 * fails loudly rather than silently comparing against a pending Promise.
 */
function serialize(...args: Parameters<typeof serializeMaybeAsync>): SerializeResult {
  const result = serializeMaybeAsync(...args);
  if (result instanceof Promise) {
    throw new TypeError('This SCSS test expects a synchronous serialize result.');
  }
  return result;
}

const simpleSelector = (text: string | null, extra: object = {}) => ({
  type: 'SimpleSelector',
  text,
  interp: null,
  ...extra
});
const compoundSelector = (...value: object[]) => ({
  type: 'CompoundSelector',
  value
});
const simpleComplex = (text: string) => simpleSelector(text);
const compoundComplex = (...value: object[]) => compoundSelector(...value);

describe('@jesscss/scss-parser public parse API', () => {
  it('exposes @supports general-enclosed facts without evaluating their contents', () => {
    const source = '@supports selector(.card-#{$tone}:has([data-x="#{$state}"])) { .card { color: blue; } }';
    const root = parse(source);

    expect(parseScssCst(source).errors).toHaveLength(0);
    expect(root).toMatchObject({
      type: 'Stylesheet', rules: [{
        type: 'AtRuleBlock', name: '@supports', prelude: {
          type: 'FunctionCall', name: 'selector', args: [{
            type: 'Interpolation', parts: [
              { lit: '.card-' }, { ref: { type: 'Lookup', kind: 'var', name: 'tone', raw: '@tone' }, unquote: true },
              { lit: ':has([data-x="' }, { ref: { type: 'Lookup', kind: 'var', name: 'state', raw: '@state' }, unquote: true }, { lit: '"])' }
            ]
          }]
        }
      }]
    });
    expect(() => parse('@supports selector(#{}) { .card { color: blue; } }')).toThrow(SyntaxError);
  });

  it('returns a direct Stylesheet while retaining named CST/document APIs', () => {
    const source = '$tone: blue; .card { color: $tone; }';

    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'tone', value: { type: 'Keyword', src: 'blue' } },
        { type: 'Ruleset', rules: [{ type: 'Declaration', name: 'color', value: { type: 'Lookup', kind: 'var', name: 'tone', raw: '@tone' } }] }
      ]
    });
    expect(parseScssDoc(source).tree).not.toBeNull();
  });

  it('retains root span and public Stylesheet trivia after SCSS lowering', () => {
    const source = '/* before */ @function double($n) { @return $n * 2; } .card { width: double(2); } /* after */';
    const root = parse(source);
    const trivia = triviaMapOf(root);

    expect(sourceSpanOf(root)).toEqual({ start: 0, end: source.length });

    /* Root trivia capture is comment-selected: a whitespace-only gap has no
     * root entry, because the renderer reads comment runs and nothing else. */
    expect(trivia).toBeDefined();
    expect(trivia?.lookup(12, 'after')).toBeUndefined();

    /*
     * A call site is left exactly as authored: whether `double` names a user
     * `@function` or a builtin is a scope question, decided at eval, not here.
     */
    expect(root.rules.find(child => child.type === 'Ruleset')).toMatchObject({
      type: 'Ruleset',
      rules: [{ type: 'Declaration', value: { type: 'FunctionCall', name: 'double' } }]
    });
  });

  it('accepts a final SCSS variable declaration without a semicolon through public parse', () => {
    expect(bare(parse('$tone: blue'))).toEqual({
      type: 'Stylesheet',
      rules: [{ type: 'VariableDeclaration', name: 'tone', value: { type: 'Keyword', src: 'blue' }, write: { mode: 'declare' } }]
    });
    expect(() => parse('$one: red $two: blue;')).toThrow(SyntaxError);
  });

  it('keeps static CSS imports as existing facts at selected and nested executable placements', () => {
    const root = parse('@if true { @import "selected.css"; } .card { @import url("nested.css"); color: red; }');

    expect(root).toMatchObject({
      type: 'Stylesheet', rules: [
        { type: 'If', branches: [{ rules: [{ type: 'AtRuleStatement', name: '@import', prelude: { value: 'selected.css' } }] }] },
        { type: 'Ruleset', rules: [
          { type: 'AtRuleStatement', name: '@import', prelude: { type: 'Url', value: { value: 'nested.css' } } },
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
      type: 'Stylesheet', rules: [{ type: 'Ruleset', rules: [
        { type: 'Declaration', name: { type: 'Interpolation', parts: [{ ref: { type: 'Lookup', kind: 'var', name: 'property', raw: '@property' } }] } },
        { type: 'Declaration', name: { type: 'Interpolation', parts: [{ lit: 'margin-' }, { ref: { type: 'Lookup', kind: 'var', name: 'side', raw: '@side' } }] } }
      ] }]
    });
  });

  it('parses SCSS arithmetic and Sass slash-list boundaries through the public Stylesheet route', () => {
    expect(parse('$base: 2; .card { result: 1 + 2 * 3; neg: - $base; pos: + ($base); minus-list: 1 -2; ratio: 1 / 2; grouped: (1 / 2); values: 1 2 + 3; }')).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'VariableDeclaration' }, { type: 'Ruleset', rules: [
        { name: 'result', value: { type: 'Operation', operator: '+', right: { type: 'Operation', operator: '*' } } },
        { name: 'neg', value: { type: 'Operation', operator: '*', left: { src: '-1' }, right: { type: 'Lookup', kind: 'var', name: 'base', raw: '@base' } } },
        { name: 'pos', value: { type: 'Block', delimiter: 'paren', value: { type: 'Lookup', kind: 'var', name: 'base', raw: '@base' } } },
        { name: 'minus-list', value: [{ src: '1' }, { src: '-2' }] },
        { name: 'ratio', value: { type: 'List', sep: '/', value: [{ src: '1' }, { src: '2' }] } },
        { name: 'grouped', value: { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: '/' } } },
        { name: 'values', value: [{ src: '1' }, { type: 'Operation', operator: '+' }] }
      ] }]
    });
  });

  it('parses static custom-property tokens as value Keywords through calls, calc, and queries', () => {
    const root = parse('.card { direct: --theme; via-var: var(--theme, --fallback); via-env: env(--safe-area); via-calc: calc(--size + 1px); } @media (width: --viewport) { .media { color: red; } } @supports (display: --mode) { .support { color: blue; } }');
    expect(root).toMatchObject({
      rules: [
        { type: 'Ruleset', rules: [
          { name: 'direct', value: { type: 'Keyword', src: '--theme' } },
          { name: 'via-var', value: { type: 'FunctionCall', name: 'var', args: [{ src: '--theme' }, { src: '--fallback' }] } },
          { name: 'via-env', value: { type: 'FunctionCall', name: 'env', args: [{ src: '--safe-area' }] } },
          { name: 'via-calc', value: { type: 'FunctionCall', name: 'calc', args: [{ type: 'Operation', left: { src: '--size' } }] } }
        ] },
        { type: 'AtRuleBlock', name: '@media', prelude: { type: 'Block', delimiter: 'paren', value: { right: { src: '--viewport' } } } },
        { type: 'AtRuleBlock', name: '@supports', prelude: { type: 'Block', delimiter: 'paren', value: { right: { src: '--mode' } } } }
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
      rules: [{ type: 'Ruleset', selector: { selectors: [compoundComplex(
        simpleSelector('.card'),
        simpleSelector('[data-state="open"i]')
      )] } }]
    });
  });

  it('parses and renders interpolated attribute values through the universal quoted override', () => {
    const root = parse('$state: open; .card[data-state="#{$state}"] { color: blue; }');

    expect(root).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'VariableDeclaration' }, {
        type: 'Ruleset', selector: { selectors: [compoundComplex(
          simpleSelector('.card'),
          simpleSelector(null, { interp: { type: 'Interpolation', parts: [
            { lit: '[data-state="' },
            { ref: { type: 'Lookup', kind: 'var', name: 'state', raw: '@state', scope: 'live' }, unquote: true },
            { lit: '"]' }
          ] } })
        )] }
      }]
    });
    expect(serialize(root)).toEqual({ css: '.card[data-state="open"] {\n  color: blue;\n}\n' });
  });

  it('parses and renders ordinary SCSS interpolated simple selectors through the public Stylesheet route', () => {
    const root = parse('$kind: card; .#{$kind}-header, #main-#{$kind} { color: blue; }');

    expect(root).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'VariableDeclaration' }, {
        type: 'Ruleset', selector: { selectors: [
          simpleSelector(null, { interp: { type: 'Interpolation', parts: [
            { lit: '.' }, { ref: { type: 'Lookup', kind: 'var', name: 'kind', raw: '@kind', scope: 'live' }, unquote: true }, { lit: '-header' }
          ] } }),
          simpleSelector(null, { interp: { type: 'Interpolation', parts: [
            { lit: '#main-' }, { ref: { type: 'Lookup', kind: 'var', name: 'kind', raw: '@kind', scope: 'live' }, unquote: true }
          ] } })
        ] }
      }]
    });
    expect(serialize(root)).toEqual({ css: '.card-header,\n#main-card {\n  color: blue;\n}\n' });
  });

  it('parses static placeholder selectors through the public Stylesheet route', () => {
    expect(parse('%notice { color: blue; }')).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'Ruleset', selector: { selectors: [simpleComplex('%notice')] } }]
    });
  });

  it('keeps selector :extend() as an ordinary pseudo without Less extend semantics', () => {
    const source = '.a:extend(.b) { color: red; }';
    const cst = parseScssCst(source);
    const root = parse(source);
    const rule = root.rules[0];

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(rule).toMatchObject({
      type: 'Ruleset',
      selector: { selectors: [compoundComplex(simpleSelector('.a'), simpleSelector(':extend(.b)'))] },
      rules: [{ type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' } }]
    });
    expect(rule).not.toMatchObject({
      extendInstructions: expect.any(Array)
    });
  });

  it('rejects Less declaration merge modifiers through the public Stylesheet route', () => {
    for (const source of [
      '.card { font+: Arial; }',
      '.card { font+_: sans-serif; }'
    ]) {
      const cst = parseScssCst(source);
      expect(cst.errors.length > 0 || cst.unconsumedFrom !== null, source).toBe(true);
      expect(() => parse(source), source).toThrow();
    }
  });

  it('lowers static nested SCSS properties through the public Stylesheet route', () => {
    const root = parse('.card { font: { family: fantasy; weight: bold; } }');

    expect(root).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'Ruleset', rules: [
        { type: 'Declaration', name: 'font', value: { type: 'Collection', entries: [
          { type: 'CollectionEntry', key: { type: 'Keyword', src: 'family' }, value: { src: 'fantasy' } },
          { type: 'CollectionEntry', key: { type: 'Keyword', src: 'weight' }, value: { src: 'bold' } }
        ] } }
      ] }]
    });
    expect(serialize(root)).toEqual({
      css: '.card {\n  font-family: fantasy;\n  font-weight: bold;\n}\n'
    });

    const empty = parse('.empty { font: {}; }');
    expect(empty).toMatchObject({ type: 'Stylesheet', rules: [{ type: 'Ruleset', rules: [
      { type: 'Declaration', name: 'font', value: { type: 'Collection', entries: [] } }
    ] }] });
    expect(serialize(empty)).toEqual({ css: '' });

    const interpolated = '$prefix: font; $part: weight; .card { #{$prefix}: { color: red; } font: { #{$part}: bold; } #{$prefix}: { #{$part}: 700; } }';
    expect(parseScssCst(interpolated).errors).toHaveLength(0);
    const dynamic = parse(interpolated);
    expect(dynamic).toMatchObject({
      rules: [{ type: 'VariableDeclaration' }, { type: 'VariableDeclaration' }, { type: 'Ruleset', rules: [
        { name: { type: 'Interpolation', parts: [{ ref: { type: 'Lookup', kind: 'var', name: 'prefix', raw: '@prefix' } }] }, value: { type: 'Collection', entries: [
          { key: { type: 'Keyword', src: 'color' }, value: { src: 'red' } }
        ] } },
        { name: 'font', value: { type: 'Collection', entries: [
          { key: { type: 'Interpolation', parts: [{ ref: { type: 'Lookup', kind: 'var', name: 'part', raw: '@part' } }] }, value: { src: 'bold' } }
        ] } },
        { name: { type: 'Interpolation', parts: [{ ref: { type: 'Lookup', kind: 'var', name: 'prefix', raw: '@prefix' } }] }, value: { type: 'Collection', entries: [
          { key: { type: 'Interpolation', parts: [{ ref: { type: 'Lookup', kind: 'var', name: 'part', raw: '@part' } }] }, value: { src: '700' } }
        ] } }
      ] }]
    });
    expect(serialize(dynamic)).toEqual({
      css: '.card {\n  font-color: red;\n  font-weight: bold;\n  font-weight: 700;\n}\n'
    });

    const important = '.card { font: 20px { size: 1rem; } !important; }';
    expect(parseScssCst(important).errors).toHaveLength(0);
    expect(parse(important)).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [
        { type: 'Declaration', name: 'font', important: true, value: { type: 'Collection', entries: [
          { type: 'CollectionEntry', key: { type: 'Keyword', src: 'size' }, important: false }
        ] } }
      ] }]
    });
    expect(serialize(parse(important))).toEqual({
      css: '.card {\n  font: 20px !important;\n  font-size: 1rem;\n}\n'
    });
  });

  it('parses a static SCSS url import through the public Stylesheet route', () => {
    expect(parse('@import url("theme.css");')).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'AtRuleStatement', name: '@import', prelude: { type: 'Url', value: { type: 'Quoted', value: 'theme.css' } } }]
    });
  });

  it('parses and renders the public-CST-valid empty SCSS url import through the public route', () => {
    const root = parse('@import url();');

    // An empty target spells no `.css`, so it takes the compile-time branch.
    expect(bare(root)).toEqual({
      type: 'Stylesheet',
      rules: [{
        type: 'StyleImport', name: '@import', options: null,
        target: { type: 'Url', value: { type: 'Any', src: '' } },
        alias: null, mode: 'import', namespace: null, forward: false
      }]
    });
    expect(serialize(root)).toEqual({ css: '@import url();\n' });
  });

  it('parses interpolated SCSS import targets through the public Stylesheet route', () => {
    for (const source of ['@import "theme-#{$mode}.css";', '@import url("theme-#{$mode}.css");']) {
      expect(parse(source)).toMatchObject({
        type: 'Stylesheet',
        rules: [{ type: 'AtRuleStatement', name: '@import', prelude: source.includes('url(')
          ? { type: 'Url', value: { type: 'Interpolation' } }
          : { type: 'Interpolation' } }]
      });
    }
  });

  it('keeps unquoted SCSS url interpolation structural through public parse and render', () => {
    const root = parse('$asset: icon; .card { bare: url(#{$asset}); joined: url(images/#{$asset}.svg); }');

    expect(root).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'asset' },
        { type: 'Ruleset', rules: [
          { type: 'Declaration', name: 'bare', value: { type: 'Url', value: { type: 'Interpolation', parts: [{ ref: { type: 'Lookup', kind: 'var', name: 'asset', raw: '@asset' }, unquote: true }] } } },
          { type: 'Declaration', name: 'joined', value: { type: 'Url', value: { type: 'Interpolation', parts: [{ lit: 'images/' }, { ref: { type: 'Lookup', kind: 'var', name: 'asset', raw: '@asset' }, unquote: true }, { lit: '.svg' }] } } }
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

  it('rejects Less-style import options through the public Stylesheet route', () => {
    const source = '@import (css, once) "theme.css";';
    const cst = parseScssCst(source);

    expect(cst.errors.length > 0 || cst.unconsumedFrom !== null).toBe(true);
    expect(() => parse(source)).toThrow(SyntaxError);
  });

  it('rejects a media/supports/layer postlude on a compile-time SCSS import', () => {
    /*
     * A postlude describes a linked CSS resource. Once the target's spelling has
     * put the import on the compile-time branch, the partial's rules are spliced
     * into this document and there is nothing left for the query to describe.
     */
    for (const source of [
      '@import "partial" screen;',
      '@import "partial" layer(tokens);',
      '@import "partial" supports((display: grid));',
      '@import url(partial) screen;'
    ]) {
      expect(() => parse(source), source).toThrow(ScssImportPostludeError);
    }

    // The same postludes stay legal on the plain-CSS form.
    for (const source of ['@import "theme.css" screen;', '@import url("theme.css") screen;']) {
      expect(parse(source), source).toMatchObject({
        rules: [{ type: 'AtRuleStatement', name: '@import' }]
      });
    }
  });

  it('preserves the bounded static SCSS CSS-import tail in the AtRuleStatement prelude', () => {
    const media = parse('@import "print.css" print;');
    const layer = parse('@import "theme.css" layer(theme);');
    const layeredMedia = parse('@import "a.css" layer(foo) screen;');

    expect(media).toMatchObject({
      rules: [{ type: 'AtRuleStatement', name: '@import', prelude: { type: 'Sequence', parts: [
        { value: 'print.css' }, { type: 'Keyword', src: 'print' }
      ] } }]
    });
    expect(layer).toMatchObject({
      rules: [{ type: 'AtRuleStatement', name: '@import', prelude: { type: 'Sequence', parts: [
        { value: 'theme.css' }, { type: 'FunctionCall', name: 'layer', args: [{ type: 'Keyword', src: 'theme' }] }
      ] } }]
    });
    expect(bare(layeredMedia)).toEqual({
      type: 'Stylesheet',
      rules: [{
        type: 'AtRuleStatement', name: '@import',
        prelude: {
          type: 'Sequence',
          parts: [
            { type: 'Quoted', src: '"a.css"', value: 'a.css', quote: '"', escaped: false },
            {
              type: 'Sequence',
              parts: [
                { type: 'FunctionCall', name: 'layer', args: [{ type: 'Keyword', src: 'foo' }], modern: false },
                { type: 'Keyword', src: 'screen' }
              ]
            }
          ]
        }
      }]
    });
    expect(serialize(media).css).toBe('@import "print.css" print;\n');
    expect(serialize(layer).css).toBe('@import "theme.css" layer(theme);\n');
    expect(serialize(layeredMedia).css).toBe('@import "a.css" layer(foo) screen;\n');

    /*
     * `@import "theme.css" screen layer(theme);` left this list. It is wrong
     * order per css-cascade-5 §3.1 and dart-sass rejects it, but `layer(theme)`
     * in that position is a well-formed `<general-enclosed>` and the shared
     * `QueryFunction` arm matches any function token. Excluding a positionally
     * reserved opener from general-enclosed *inside* an import tail needs a
     * context-parameterized override, which parseman's parameterless-const rule
     * (GRAMMAR-REVIEW-STANDARD §3) cannot express — the leading-position guard
     * on `ImportTail` only covers a tail that STARTS with `supports(`.
     * Recorded as `blocked`, not accepted as correct. jess already accepted the
     * neighbouring sass-spec `error/wrong_order/*` cases before this change.
     */
    for (const unsupported of [
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

    expect(bare(supported)).toEqual({
      type: 'Stylesheet',
      rules: [{
        type: 'AtRuleStatement', name: '@import',
        prelude: {
          type: 'Sequence',
          parts: [
            { type: 'Quoted', src: '"theme.css"', value: 'theme.css', quote: '"', escaped: false },
            {
              type: 'FunctionCall', name: 'supports', modern: false,
              args: [{ type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: ':', left: { type: 'Keyword', src: 'display' }, right: { type: 'Keyword', src: 'grid' }, inMathFunction: false } }]
            }
          ]
        }
      }]
    });
    expect(bare(simple)).toEqual(bare(supported));
    expect(layered).toMatchObject({
      rules: [{
        type: 'AtRuleStatement', name: '@import',
        prelude: {
          type: 'Sequence', parts: [
            { type: 'Quoted', value: 'theme.css' },
            { type: 'Sequence', parts: [
              { type: 'FunctionCall', name: 'layer', args: [{ type: 'Keyword', src: 'tokens' }] },
              { type: 'FunctionCall', name: 'supports', args: [{ type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: ':' } }] },
              { type: 'Keyword', src: 'screen' }
            ] }
          ]
        }
      }]
    });

    /*
     * The canonical Operation renderer owns normal whitespace around the
     * declaration-condition colon. The typed tree, not source-byte replay, is
     * the public contract.
     */
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
      type: 'Stylesheet', rules: [{
        type: 'AtRuleStatement', name: '@import',
        prelude: {
          type: 'Sequence', parts: [
            { type: 'Quoted', value: 'theme.css' },
            { type: 'Sequence', parts: [
              { type: 'FunctionCall', name: 'layer' },
              { type: 'FunctionCall', name: 'supports' },
              {
                type: 'List', sep: ',', value: [
                  { type: 'Sequence', parts: [{ src: 'only' }, { src: 'screen' }, { src: 'and' }, { type: 'Block', delimiter: 'paren' }] },
                  { type: 'Block', delimiter: 'paren', value: { src: 'color' } },
                  { type: 'Sequence', parts: [{ src: 'not' }, { type: 'Block', delimiter: 'paren' }] }
                ]
              }
            ] }
          ]
        }
      }]
    });
    expect(serialize(root)).toEqual({
      css: '@import "theme.css" layer(tokens) supports((display : grid)) only screen and (min-width: 1px), (color), not (color: red);\n'
    });
    expect(parse('@import "theme.css" (color) or (monochrome);')).toMatchObject({
      rules: [{ type: 'AtRuleStatement', name: '@import', prelude: { type: 'Sequence', parts: [
        { type: 'Quoted', value: 'theme.css' },
        { type: 'Sequence', parts: [{ type: 'Block', delimiter: 'paren' }, { src: 'or' }, { type: 'Block', delimiter: 'paren' }] }
      ] } }]
    });

    /* See the matching note in ast-grammar.test.ts for why three entries left. */
    for (const source of [
      '@import "theme.css" #{$media};',
      '@import "theme.css" screen /* no raw/comment tail */ and (color);',
      '@import "theme.css" screen, #{$media};',
      '@import "a.css", "b.css" screen;'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('classifies static SCSS module directives through the public Stylesheet route', () => {
    expect(parse('@use "sass:math" as math; @use "./theme.scss" as theme; @forward "./public.scss";')).toMatchObject({
      type: 'Stylesheet', rules: [
        { type: 'ModuleImport', mode: 'use', path: { value: '#sass/math' }, namespace: 'math' },
        { type: 'StyleImport', name: '@-compose', mode: 'compose', target: { value: './theme.scss' }, namespace: 'theme', forward: false },
        { type: 'StyleImport', name: '@-export', mode: 'compose', target: { value: './public.scss' }, namespace: null, forward: true }
      ]
    });
  });

  it('requires static SCSS module directives to remain in the document prefix', () => {
    expect(parse('$theme: red; @forward "./public.scss"; @use "./theme.scss"; .card { color: $theme; }')).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'theme' },
        { type: 'StyleImport', forward: true },
        { type: 'StyleImport', forward: false },
        { type: 'Ruleset' }
      ]
    });
    expect(parse('@use "./theme.scss"; @forward "./public.scss"; .card { color: red; }')).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'StyleImport', forward: false }, { type: 'StyleImport', forward: true }, { type: 'Ruleset' }]
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

    // `// before use` is trivia and leaves no node; the `/* */` pair remain.
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet', rules: [
        { type: 'Comment' }, { type: 'VariableDeclaration', name: 'theme' },
        { type: 'StyleImport', target: { value: './theme.scss' }, forward: false },
        { type: 'Comment' }, { type: 'StyleImport', target: { value: './public.scss' }, forward: true },
        { type: 'AtRuleStatement', name: '@import' }
      ]
    });
  });

  it('parses and renders the restricted static @if route without a CST fallback', () => {
    const root = parse('@if false { .no { color: red; } } @else { .yes { color: green; } }');
    expect(root).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'If', branches: [
        { guard: { g: 'truth', value: { src: 'false' } } },
        { guard: null, rules: [{ type: 'Ruleset' }] }
      ] }]
    });
    expect(serialize(root)).toEqual({ css: '.yes {\n  color: green;\n}\n' });
  });

  it('parses restricted static @if blocks inside the public @media route', () => {
    const root = parse('@media screen { @if true { .inside { color: green; } } @else { .no { color: red; } } }');
    expect(root).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'AtRuleBlock', name: '@media', rules: [{ type: 'If', branches: [
        { guard: { g: 'truth', value: { src: 'true' } } }, { guard: null }
      ] }] }]
    });
    expect(serialize(root)).toEqual({ css: '@media screen {\n  .inside {\n    color: green;\n  }\n}\n' });
  });

  it('publishes a selected SCSS @if mixin for a later public sibling', () => {
    const document = parse('@if true { @mixin paint { color: blue; } } .after { @include paint; }');
    expect(document).toMatchObject({
      type: 'Stylesheet', rules: [
        { type: 'If', branches: [{ rules: [{ type: 'MixinDefinition', name: 'paint' }] }] },
        { type: 'Ruleset', rules: [{ type: 'MixinCall', name: 'paint' }] }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) })).toEqual({
      css: '.after {\n  color: blue;\n}\n'
    });
  });

  it('returns arithmetic SCSS @for bounds as canonical Range values through the public route', () => {
    expect(parse('@for $i from 1 + 1 through 4 - 1 { .n { width: $i; } }')).toMatchObject({
      type: 'Stylesheet',
      rules: [{
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
      rules: [
        { type: 'MixinDefinition', rules: [{ type: 'If', branches: [{ guard: { g: 'truth', value: { src: 'true' } } }] }] },
        { type: 'Ruleset', rules: [{ type: 'MixinCall' }] },
        { type: 'For', binding: { kind: 'single', name: 'tone' }, rules: [{ type: 'If' }] },
        { type: 'For', binding: { kind: 'single', name: 'i' }, rules: [{ type: 'If', branches: [{ guard: { g: 'cmp', op: '=' } }] }] }
      ]
    });
    expect(serialize(root, { evaluator: buildEvaluator(makeLessRegistry()) })).toEqual({
      css: '.card {\n  color: red;\n}\n.each {\n  color: blue;\n}\n.step {\n  width: 1px;\n}\n'
    });

    // A bare `@if $x` is now admitted everywhere a condition is (§4.4.2).
    expect(() => parse('@each $tone in blue { @if $enabled { .each { color: $tone; } } }')).not.toThrow();

    for (const notThisBatch of [
      '@mixin paint { @while true { color: red; } }'
    ]) {
      expect(() => parse(notThisBatch), notThisBatch).toThrow(SyntaxError);
    }
  });

  it('parses descriptor-only @font-face through the public Stylesheet route', () => {
    expect(parse('@font-face { font-family: $font; src: url("font.woff2"); }')).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'AtRuleBlock', name: '@font-face', rules: [
        { type: 'Declaration', value: { type: 'Lookup', kind: 'var', name: 'font', raw: '@font' } }, { type: 'Declaration', value: { type: 'Url' } }
      ] }]
    });
  });

  it('parses descriptor-only @counter-style through the public Stylesheet route', () => {
    expect(parse('@counter-style thumbs { system: cyclic; }')).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'AtRuleBlock', name: '@counter-style', prelude: { src: 'thumbs' }, rules: [{ type: 'Declaration', name: 'system' }] }]
    });
  });

  it('parses and renders static @page/margin blocks at root and inside SCSS nesting', () => {
    const root = parse('@page report:left { size: A4; @top-left { content: "head"; } } @media print { @page :right { margin: 1cm; @bottom-center { content: "folio"; } } } .host { @page appendix { size: letter; } }');

    expect(root).toMatchObject({
      type: 'Stylesheet', rules: [
        { type: 'AtRuleBlock', name: '@page', prelude: { type: 'Any', src: 'report:left' }, rules: [{ type: 'Declaration', name: 'size' }, { type: 'AtRuleBlock', name: '@top-left', prelude: null, rules: [{ type: 'Declaration', name: 'content' }] }] },
        { type: 'AtRuleBlock', name: '@media', rules: [{ type: 'AtRuleBlock', name: '@page', prelude: { type: 'Any', src: ':right' }, rules: [{ type: 'Declaration', name: 'margin' }, { type: 'AtRuleBlock', name: '@bottom-center', rules: [{ type: 'Declaration', name: 'content' }] }] }] },
        { type: 'Ruleset', rules: [{ type: 'AtRuleBlock', name: '@page', prelude: { type: 'Any', src: 'appendix' }, rules: [{ type: 'Declaration', name: 'size' }] }] }
      ]
    });
    expect(serialize(root, { evaluator: buildEvaluator(makeLessRegistry()) })).toEqual({
      css: '@page report:left {\n  size: A4;\n  @top-left {\n    content: "head";\n  }\n}\n@media print {\n  @page :right {\n    margin: 1cm;\n    @bottom-center {\n      content: "folio";\n    }\n  }\n}\n@page appendix {\n  size: letter;\n}\n'
    });
  });

  it('parses and renders finite static @font-feature-values blocks at root and inside SCSS nesting', () => {
    const root = parse('@font-feature-values "Fira Code", Demo { /* family */ @stylistic { salt: 1; } @styleset { nice: 2; } @character-variant { cv01: 3; } @swash { swsh: 4; } @ornaments { orn: 5; } @annotation { note: 6; } @historical-forms { hist: 7; } } @media print { @font-feature-values Print { @styleset { compact: 1; } } } .host { @font-feature-values Nested { @annotation { label: 1; } } }');

    expect(root).toMatchObject({
      type: 'Stylesheet', rules: [
        { type: 'AtRuleBlock', name: '@font-feature-values', prelude: { type: 'Any', src: '"Fira Code", Demo' }, rules: [
          { type: 'Comment', text: '/* family */' },
          ...['stylistic', 'styleset', 'character-variant', 'swash', 'ornaments', 'annotation', 'historical-forms'].map(name => ({ type: 'AtRuleBlock', name: `@${name}`, prelude: null, rules: [{ type: 'Declaration' }] }))
        ] },
        { type: 'AtRuleBlock', name: '@media', rules: [{ type: 'AtRuleBlock', name: '@font-feature-values', prelude: { src: 'Print' }, rules: [{ type: 'AtRuleBlock', name: '@styleset' }] }] },
        { type: 'Ruleset', rules: [{ type: 'AtRuleBlock', name: '@font-feature-values', prelude: { src: 'Nested' }, rules: [{ type: 'AtRuleBlock', name: '@annotation' }] }] }
      ]
    });
    expect(serialize(root, { evaluator: buildEvaluator(makeLessRegistry()) })).toEqual({
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
      type: 'Stylesheet', rules: [
        { type: 'AtRuleBlock', name: '@-MOZ-DOCUMENT', prelude: { type: 'Any', src: 'url-prefix("https://example.test/"), domain("example.test")' }, rules: [
          { type: 'AtRuleBlock', name: '@font-face', rules: [{ type: 'Declaration', name: 'font-family' }] },
          { type: 'Ruleset', selector: { selectors: [simpleComplex('.card')] } },
          { type: 'AtRuleBlock', name: '@document', prelude: { type: 'Any', src: 'regexp("nested")' }, rules: [{ type: 'Ruleset' }] }
        ] },
        { type: 'AtRuleBlock', name: '@media', rules: [{ type: 'AtRuleBlock', name: '@document', rules: [{ type: 'Ruleset' }] }] },
        { type: 'Ruleset', rules: [{ type: 'AtRuleBlock', name: '@document', rules: [{ type: 'Ruleset' }] }] }
      ]
    });
    expect(serialize(root, { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
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

    /*
     * DESIGN-DECISIONS.md P20: `é` is an ident code point (css-syntax-3
     * §4.3.11), so `@documenté` is ONE unknown at-keyword and keeps its full
     * authored name -- the same rule the sibling test below states.
     */
    expect(parse('@documenté { .card { color: red; } }')).toMatchObject({
      rules: [{ type: 'OpaqueAtRuleBlock', name: '@documenté', prelude: null }]
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
        rules: [{ type: 'OpaqueAtRuleBlock', name, prelude: 'url("screen")' }]
      });
    }

    /*
     * A non-ASCII ident character continues the name just like an ASCII one:
     * `@documenté` is one unknown at-keyword, not `@document` with an `é`
     * prelude. @see https://drafts.csswg.org/css-syntax/#ident-token-diagram
     */
    for (const name of ['@documenté', '@-moz-documenté']) {
      expect(parse(`${name} { .card { color: red; } }`), name).toMatchObject({
        rules: [{ type: 'OpaqueAtRuleBlock', name, prelude: null }]
      });
    }
  });

  it('parses descriptor-only @property through the public Stylesheet route', () => {
    expect(bare(parse('@property --accent { syntax: "<color>"; inherits: false; initial-value: red; }'))).toEqual({
      type: 'Stylesheet',
      rules: [{
        type: 'AtRuleBlock', name: '@property', prelude: { type: 'Keyword', src: '--accent' }, rules: [
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
      type: 'Stylesheet', rules: [{
        type: 'AtRuleBlock', name: '@keyframes', prelude: { type: 'Keyword', src: 'fade' }, rules: [
          { type: 'Ruleset', selector: { selectors: [simpleComplex('from'), simpleComplex('25%')] }, rules: [{ type: 'Declaration', name: 'opacity' }] },
          { type: 'Ruleset', selector: { selectors: [simpleComplex('to')] }, rules: [{ type: 'Declaration', name: 'opacity' }] }
        ]
      }]
    });
    expect(serialize(root)).toEqual({ css: '@keyframes fade {\n  from,\n  25% {\n    opacity: 0;\n  }\n  to {\n    opacity: 1;\n  }\n}\n' });
  });

  it('keeps a static quoted keyframes name as the existing typed prelude', () => {
    const root = parse('@keyframes "fade" { from { opacity: 0; } }');
    expect(root).toMatchObject({
      type: 'Stylesheet', rules: [{
        type: 'AtRuleBlock', name: '@keyframes', prelude: { type: 'Quoted', value: 'fade' }
      }]
    });
    expect(serialize(root)).toEqual({ css: '@keyframes "fade" {\n  from {\n    opacity: 0;\n  }\n}\n' });
  });

  it('keeps escapes in a static quoted keyframes name without admitting interpolation', () => {
    const root = parse('@keyframes "fade\\20name" { to { opacity: 1; } }');
    expect(root).toMatchObject({
      type: 'Stylesheet', rules: [{
        type: 'AtRuleBlock', name: '@keyframes',
        prelude: { type: 'Quoted', src: '"fade\\20name"', value: 'fade\\20name', quote: '"', escaped: false }
      }]
    });
    expect(serialize(root)).toEqual({ css: '@keyframes "fade\\20name" {\n  to {\n    opacity: 1;\n  }\n}\n' });
  });

  it('accepts comments around static keyframe selector delimiters without turning them into selector text', () => {
    expect(parse('@keyframes fade { from /* after-from */, /* before-half */ 50% /* before-block */ { opacity: 0; } }')).toMatchObject({
      type: 'Stylesheet', rules: [{
        type: 'AtRuleBlock', rules: [{
          type: 'Ruleset', selector: { selectors: [
            simpleComplex('from'),
            simpleComplex('50%')
          ] }
        }]
      }]
    });
  });

  it('keeps static keyframes structured inside a public conditional group', () => {
    expect(parse('@media screen { @-webkit-keyframes fade { 50% { opacity: .5; } } }')).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'AtRuleBlock', name: '@media', rules: [
        { type: 'AtRuleBlock', name: '@-webkit-keyframes', prelude: { src: 'fade' }, rules: [
          { type: 'Ruleset', selector: { selectors: [simpleComplex('50%')] } }
        ] }
      ] }]
    });
  });

  /*
   * `<keyframe-selector> = from | to | <percentage>` (css-animations-1 §4) and
   * `<percentage> = <number> %` (css-values-4 §8.2), so the sign, the
   * leading-dot decimal and the exponent are all in, because they are all part
   * of `<number>` (css-syntax-3 §4.3.12).
   *
   * `100.%` is NOT: consuming a number stops at the `.` unless a digit follows
   * it. SCSS used to accept it, from a hand-rolled `\d+\.?\d*` that the css
   * dialect never shared -- so this test asserted alignment with CSS while
   * pinning a divergence from it, in the one direction a dialect may not take
   * (a dialect may add to CSS, never accept invalid CSS). All four dialects now
   * answer identically here.
   */
  it('keeps the direct keyframe selector shape aligned with CSS', () => {
    expect(parse('@-moz-keyframes fade { +50%, -0.5%, .5%, 1e2% { opacity: 1; } }')).toMatchObject({
      type: 'Stylesheet', rules: [{
        type: 'AtRuleBlock', name: '@-moz-keyframes', rules: [{
          type: 'Ruleset', selector: { selectors: [
            simpleComplex('+50%'),
            simpleComplex('-0.5%'),
            simpleComplex('.5%'),
            simpleComplex('1e2%')
          ] }
        }]
      }]
    });
    expect(() => parse('@-moz-keyframes fade { 100.% { opacity: 1; } }')).toThrow(SyntaxError);
  });

  it('constructs and renders static CSS @starting-style and @layer blocks through the public Stylesheet route', () => {
    const root = parse('@starting-style { .enter { opacity: 0; } } @layer base.utilities, components /* keep */ { .card { color: red; } }');

    expect(root).toMatchObject({
      type: 'Stylesheet', rules: [
        { type: 'AtRuleBlock', name: '@starting-style', prelude: null, rules: [{ type: 'Ruleset', selector: { type: 'SelectorList' } }] },
        { type: 'AtRuleBlock', name: '@layer', prelude: { type: 'Any', src: 'base.utilities, components /* keep */' }, rules: [{ type: 'Ruleset', selector: { type: 'SelectorList' } }] }
      ]
    });
    expect(serialize(root)).toEqual({ css: '@starting-style {\n  .enter {\n    opacity: 0;\n  }\n}\n@layer base.utilities, components /* keep */ {\n  .card {\n    color: red;\n  }\n}\n' });
  });

  it('returns static CSS statement at-rules through the public Stylesheet route', () => {
    const root = parse('@charset "UTF-8"; @namespace svg url("https://example.test/svg"); @layer theme;');

    expect(root).toMatchObject({ type: 'Stylesheet', rules: [
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
      type: 'Stylesheet', rules: [{ type: 'Ruleset', rules: [
        { type: 'AtRuleBlock', name: '@starting-style', prelude: null, rules: [{ type: 'Declaration', name: 'opacity' }] },
        { type: 'AtRuleBlock', name: '@layer', prelude: { type: 'Any', src: 'utilities' }, rules: [{ type: 'Declaration', name: 'color' }] }
      ] }]
    });
    expect(serialize(root)).toEqual({ css: '.host {\n  @starting-style {\n    opacity: 0;\n  }\n}\n@layer utilities {\n  .host {\n    color: blue;\n  }\n}\n' });
  });

  it('constructs static CSS @scope blocks through the public Stylesheet route', () => {
    const root = parse('@scope (.card) to (.card > .title) { .item { color: red; } }');
    expect(root).toMatchObject({ type: 'Stylesheet', rules: [{
      type: 'AtRuleBlock', name: '@scope', prelude: { type: 'Any', src: '(.card) to (.card > .title)' },
      rules: [{ type: 'Ruleset' }]
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

  /**
   * A `<urange>` is one lexical token — css-syntax-3 §4.4 consumes it before any
   * numeric token, so its `+`/`-` are never SCSS operators. Splitting it folded
   * `U+0-7F` into `Operation('-', Operation('+', Keyword(U), 0), 7F)` and emitted
   * `U + 0 - 7F`: valid CSS silently turned into different CSS, with nothing to
   * signal it. Each range keeps its authored bytes as one opaque `Any`, and the
   * wildcard forms (`U+4??`) stop being a parse error.
   */
  it('keeps CSS unicode-range tokens opaque and outside SCSS arithmetic', () => {
    const source = '@font-face { unicode-range: U+??????, U+0???, U+0-7F, U+A5; } .range { values: U+0-7F 1, U+A5; }';
    const root = parse(source);

    expect(root).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock', name: '@font-face', rules: [{
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
          type: 'Ruleset', rules: [{
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
    expect(serialize(root)).toEqual({
      css: '@font-face {\n  unicode-range: U+??????, U+0???, U+0-7F, U+A5;\n}\n.range {\n  values: U+0-7F 1, U+A5;\n}\n'
    });
  });

  it('accepts every authored unicode-range spelling as one token', () => {
    for (const token of ['U+26', 'U+0-7F', 'U+0025-00FF', 'U+4??', 'U+??????', 'u+0-7f']) {
      expect(parse(`@font-face { unicode-range: ${token}; }`), token).toMatchObject({
        rules: [{ rules: [{ type: 'Declaration', value: { type: 'Any', src: token } }] }]
      });
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

  /*
   * The value ladder runs with trivia cleared, so each interior that admits
   * authored padding has to spell it, and it has to spell the comment-bearing
   * `valueTrivia`: the document trivia table names only whitespace and `//`, so
   * a block comment is never ambient inside a value. Both columns are asserted
   * together because a fix restoring only the comment column would leave
   * `( c )` — the same defect, one character apart — still rejected.
   */
  it('admits authored whitespace and comments at every value-interior boundary', () => {
    const templates = [
      '(Tc)', '(cT)', '(TcT)', '(cTd)', '(c,Td)',
      '[Tc]', '[cT]',
      'f(Tc)', 'f(cT)', 'f(cT,d)', 'f(c,Td)',
      'min(1pxT,2px)', 'min(1px,T2px)',
      'var(T--x,e)', 'var(--xT,e)', 'var(--x,Te)', 'var(--x,eT)',
      '(1pxT*T2)', '(1px T+T 2px)'
    ];
    for (const template of templates) {
      for (const fill of [' ', '/* c */', '/* ) */']) {
        const source = `a { b: ${template.replaceAll('T', fill)} }`;
        expect(() => parse(source), source).not.toThrow();
      }
    }
  });

  /*
   * Sass distinguishes arithmetic from a space list by the whitespace AROUND a
   * sign: `1 -2` is a two-item list whose second item is a signed dimension,
   * while `1 - 2` is a subtraction. That coupling is semantic, and widening the
   * operator padding to admit comments must not quietly dissolve it.
   */
  it('keeps the whitespace-coupled boundary between Sass arithmetic and a space list', () => {
    expect(bare(parse('a { b: 1 - 2 }'))).toMatchObject({
      rules: [{ rules: [{ value: { type: 'Operation', operator: '-' } }] }]
    });
    expect(bare(parse('a { b: 1 -2 }'))).toMatchObject({
      rules: [{ rules: [{ value: [{ type: 'Dimension' }, { type: 'Dimension', number: -2 }] }] }]
    });
    expect(bare(parse('a { b: (1 /* c */ - 2) }'))).toMatchObject({
      rules: [{ rules: [{ value: { type: 'Block', value: { type: 'Operation', operator: '-' } } }] }]
    });
  });
});
