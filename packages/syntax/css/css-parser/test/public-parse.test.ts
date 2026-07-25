import { describe, expect, it } from 'vitest';
import { parse, parseCssCst } from '@jesscss/css-parser';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('public CSS parse()', () => {
  it('accepts every positive public-CST fixture through the direct Stylesheet route', () => {
    const fixtureRoot = join(import.meta.dirname, 'css');
    for (const filename of readdirSync(fixtureRoot).filter(name => name.endsWith('.css'))) {
      const source = readFileSync(join(fixtureRoot, filename), 'utf8');
      const cst = parseCssCst(source);
      expect(cst.errors, filename).toHaveLength(0);
      expect(cst.unconsumedFrom, filename).toBeNull();
      expect(() => parse(source), filename).not.toThrow();
    }
  });

  it('rejects every public-CST error fixture through the direct Stylesheet route', () => {
    const fixtureRoot = join(import.meta.dirname, 'css/errors');
    for (const filename of readdirSync(fixtureRoot).filter(name => name.endsWith('.css'))) {
      const source = readFileSync(join(fixtureRoot, filename), 'utf8');
      const cst = parseCssCst(source);
      expect(cst.errors.length + Number(cst.unconsumedFrom !== null), filename).toBeGreaterThan(0);
      expect(() => parse(source), filename).toThrow(SyntaxError);
    }
  });

  it('returns the canonical Stylesheet directly while the explicit CST API remains available', () => {
    const source = '@media screen { .card { color: red; } }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock',
        name: '@media',
        body: [{ type: 'Rule', body: [{ type: 'Declaration', name: 'color' }] }]
      }]
    });
  });

  it('keeps CSS @property as a typed declaration-bodied at-rule', () => {
    const source = '@property --accent { syntax: "<color>"; inherits: false; initial-value: red; }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock',
        name: '@property',
        prelude: { type: 'Any', src: '--accent' },
        body: [
          { type: 'Declaration', name: 'syntax' },
          { type: 'Declaration', name: 'inherits' },
          { type: 'Declaration', name: 'initial-value' }
        ]
      }]
    });
  });

  it('keeps nested scope blocks on the public direct-AST route', () => {
    const source = '@scope (.outer) { @scope (.inner) { color: red; } }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock', name: '@scope', body: [{
          type: 'AtRuleBlock', name: '@scope', body: [{ type: 'Declaration', name: 'color' }]
        }]
      }]
    });
  });

  it('does not expose a CST-to-AST compatibility route through parse()', () => {
    expect(() => parse('.card { color: red;')).toThrow(SyntaxError);
  });

  it('returns general-enclosed supports facts directly while preserving the explicit CST API', () => {
    const source = '@supports selector(.grid /* keep */ :is(.a, .b)) { .grid { display: grid; } }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock', name: '@supports', prelude: {
          type: 'GeneralEnclosed', form: 'function', name: 'selector',
          content: { type: 'Interpolation', parts: [{ lit: '.grid /* keep */ :is(.a, .b)' }] }
        }
      }]
    });
  });

  it('accepts negative An+B pseudo arguments through the public direct-AST route', () => {
    expect(parse(':nth-child(-n+2 of .item) { color: red; }')).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: { selectors: [{ head: { simples: [{ text: ':nth-child(-n+2 of .item)' }] } }] }
      }]
    });
  });

  it('accepts a comment at the qualified-selector to block boundary', () => {
    expect(parse('a/**/{ color: red; }')).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: { selectors: [{ head: { simples: [{ text: 'a' }] } }] },
        body: [{ type: 'Declaration', name: 'color' }]
      }]
    });
  });

  it('accepts ordinary declaration url-name delimiter comments through the public direct-AST route', () => {
    expect(parse('.asset { background: url/* name-open */(icon.svg); }')).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule', body: [{
        type: 'Declaration', name: 'background', value: { type: 'Url', value: { type: 'Any', src: 'icon.svg' } }
      }] }]
    });
  });

  it('lowers CST-permitted static escaped quotes to canonical escaped Quoted values', () => {
    const source = '.asset { double: ~"theme"; single: ~\'tone\'; }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'double', value: { type: 'Quoted', src: '~"theme"', value: 'theme', quote: '"', escaped: true } },
        { type: 'Declaration', name: 'single', value: { type: 'Quoted', src: '~\'tone\'', value: 'tone', quote: '\'', escaped: true } }
      ] }]
    });

    // CSS treats `$` as literal text here; only malformed escaped strings reject.
    for (const invalid of ['.asset { value: ~"theme; }', '.asset { value: ~\'tone; }']) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('keeps var() fallback delimiters balanced through the public direct-AST route', () => {
    for (const fallback of ['([a])', '({a})', '[(a)]', '[{a}]', '{(a)}', '{[a]}', '[a(b)]', '{a[b]}']) {
      expect(() => parse(`.a { x: calc(var(--x, ${fallback}) + 2px); }`), fallback).not.toThrow();
    }
    for (const fallback of ['([a)]', '({a)}', '[(a])', '[{a]}', '{(a})', '{[a}]', '([a]', '[(a)', '{[a]']) {
      expect(() => parse(`.a { x: calc(var(--x, ${fallback}) + 2px); }`), fallback).toThrow(SyntaxError);
    }
  });

  it('keeps an ordinary declaration var() fallback as one structured value', () => {
    expect(parse('.a { color: var(--theme,); }')).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule', body: [{
        type: 'Declaration', name: 'color', value: {
          type: 'FunctionCall', name: 'var', args: [
            { type: 'Keyword', src: '--theme' },
            { type: 'Any', src: '' }
          ]
        }
      }] }]
    });

    expect(parse('.a { color: var(--theme, red, blue); }')).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule', body: [{
        type: 'Declaration', name: 'color', value: {
          type: 'FunctionCall', name: 'var', args: [
            { type: 'Keyword', src: '--theme' },
            { type: 'List', value: [{ type: 'Keyword', src: 'red' }, { type: 'Keyword', src: 'blue' }], sep: ',' }
          ]
        }
      }] }]
    });
  });

  /**
   * A `<urange>` is one lexical token — css-syntax-3 §4.4 consumes it before any
   * numeric token, so its `+`/`-` are never signs or operators. Splitting it left
   * `+0`/`-7F` to be re-read as signed numbers, and the retained `src` came back
   * out as `U +0 -7F`: valid CSS silently turned into different CSS, with nothing
   * to signal it. Each range keeps its authored bytes as one opaque `Any`.
   */
  it('keeps CSS unicode-range tokens opaque instead of splitting them into signed numbers', () => {
    expect(parse('@font-face { unicode-range: U+??????, U+0???, U+0-7F, U+A5; } .range { values: U+0-7F 1, U+A5; }')).toMatchObject({
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
  });

  it('accepts every authored unicode-range spelling as one token', () => {
    for (const token of ['U+26', 'U+0-7F', 'U+0025-00FF', 'U+4??', 'U+??????', 'u+0-7f']) {
      expect(parse(`@font-face { unicode-range: ${token}; }`), token).toMatchObject({
        children: [{ body: [{ type: 'Declaration', value: { type: 'Any', src: token } }] }]
      });
    }
  });
});
