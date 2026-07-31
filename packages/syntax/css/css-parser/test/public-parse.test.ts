import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/css-parser';
import { parseCssCst } from '@jesscss/css-parser/cst';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const simpleSelector = (text: string | null, extra: object = {}) => ({
  type: 'SimpleSelector',
  text,
  interp: null,
  ...extra
});
const simpleComplex = (text: string) => simpleSelector(text);

function containsNode(value: unknown, predicate: (value: Record<string, unknown>) => boolean): boolean {
  if (Array.isArray(value)) {
    return value.some(child => containsNode(child, predicate));
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return predicate(record)
    || Object.values(record).some(child => containsNode(child, predicate));
}

function containsFunctionCall(value: unknown, name: string): boolean {
  return containsNode(value, record => record.type === 'FunctionCall' && record.name === name);
}

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
      expect(Number(!cst.ok) + cst.errors.length + Number(cst.unconsumedFrom !== null), filename).toBeGreaterThan(0);
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
      rules: [{
        type: 'AtRuleBlock',
        name: '@media',
        rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: 'color' }] }]
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
      rules: [{
        type: 'AtRuleBlock',
        name: '@property',
        prelude: { type: 'Any', src: '--accent' },
        rules: [
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
      rules: [{
        type: 'AtRuleBlock', name: '@scope', rules: [{
          type: 'AtRuleBlock', name: '@scope', rules: [{ type: 'Declaration', name: 'color' }]
        }]
      }]
    });
  });

  it('does not expose a CST-to-AST compatibility route through parse()', () => {
    expect(() => parse('.card { color: red;')).toThrow(SyntaxError);
  });

  it('requires a semicolon between declarations and following nested body items', () => {
    expect(parse('.card { color: red }')).toMatchObject({
      rules: [{ rules: [{ type: 'Declaration', name: 'color' }] }]
    });
    expect(() => parse('.card { color: red @media (width: 1px) { color: blue; } }')).toThrow(SyntaxError);
    expect(() => parse('.card { color: red .child { color: blue; } }')).toThrow(SyntaxError);
  });

  it('returns general-enclosed supports facts directly while preserving the explicit CST API', () => {
    const source = '@supports selector(.grid /* keep */ :is(.a, .b)) { .grid { display: grid; } }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'AtRuleBlock', name: '@supports', prelude: {
          type: 'GeneralEnclosed', form: 'function', name: 'selector',
          content: { type: 'Interpolation', parts: [{ lit: '.grid /* keep */ :is(.a, .b)' }] }
        }
      }]
    });
  });

  it('requires supports function tokens to glue the function name to the opening paren', () => {
    const source = '@supports selector (.grid) { .grid { display: grid; } }';
    const cst = parseCssCst(source);
    expect(Number(!cst.ok) + cst.errors.length + Number(cst.unconsumedFrom !== null)).toBeGreaterThan(0);
    expect(() => parse(source)).toThrow(SyntaxError);
  });

  it('accepts negative An+B pseudo arguments through the public direct-AST route', () => {
    expect(parse(':nth-child(-n+2 of .item) { color: red; }')).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'Ruleset',
        selector: { selectors: [simpleComplex(':nth-child(-n+2 of .item)')] }
      }]
    });
  });

  it('accepts a comment at the qualified-selector to block boundary', () => {
    expect(parse('a/**/{ color: red; }')).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'Ruleset',
        selector: { selectors: [simpleComplex('a')] },
        rules: [{ type: 'Declaration', name: 'color' }]
      }]
    });
  });

  it('does not lower comment-delimited url identifiers to Url or FunctionCall values', () => {
    const document = parse('.asset { background: url/* name-open */(icon.svg); }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'Ruleset', rules: [{
        type: 'Declaration', name: 'background'
      }] }]
    });
    expect(containsNode(document, value => value.type === 'Url')).toBe(false);
    expect(containsFunctionCall(document, 'url')).toBe(false);
  });

  it('does not lower whitespace-separated identifiers to function calls', () => {
    const glued = parse('.asset { filter: alpha(opacity=50); }');
    const spaced = parse('.asset { filter: alpha (opacity=50); }');

    expect(glued).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'Ruleset', rules: [{
        type: 'Declaration',
        name: 'filter',
        value: { type: 'FunctionCall', name: 'alpha' }
      }] }]
    });
    expect(spaced).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'Ruleset', rules: [{
        type: 'Declaration',
        name: 'filter'
      }] }]
    });
    expect(containsFunctionCall(spaced, 'alpha')).toBe(false);
  });

  it('does not lower spaced known function names to dedicated function values', () => {
    for (const [source, name] of [
      ['.asset { background: url (x); }', 'url'],
      ['.asset { width: calc (1px + 2px); }', 'calc'],
      ['.asset { color: var (--x); }', 'var']
    ] as const) {
      const document = parse(source);

      expect(document).toMatchObject({
        type: 'Stylesheet',
        rules: [{ type: 'Ruleset', rules: [{
          type: 'Declaration',
          value: [
            { type: 'Keyword', src: name },
            { type: 'Block', delimiter: 'paren' }
          ]
        }] }]
      });
      expect(containsNode(document, value => value.type === 'Url')).toBe(false);
      expect(containsFunctionCall(document, name)).toBe(false);
    }
  });

  it('does not unglue spaced query function names into FunctionCall preludes', () => {
    expect(() => parse('@container style (--theme: dark) { .card { color: red; } }')).toThrow(SyntaxError);

    const document = parse('@container scroll-state (stuck: block-start) { .card { color: red; } }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'AtRuleBlock',
        name: '@container',
        prelude: {
          type: 'SpacedValue',
          parts: [
            { type: 'Keyword', src: 'scroll-state' },
            { type: 'Block', delimiter: 'paren' }
          ]
        }
      }]
    });
    expect(containsFunctionCall(document, 'scroll-state')).toBe(false);
  });

  it('lowers CST-permitted static escaped quotes to canonical escaped Quoted values', () => {
    const source = '.asset { double: ~"theme"; single: ~\'tone\'; }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'Ruleset', rules: [
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
      rules: [{ type: 'Ruleset', rules: [{
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
      rules: [{ type: 'Ruleset', rules: [{
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
  });

  it('accepts every authored unicode-range spelling as one token', () => {
    for (const token of ['U+26', 'U+0-7F', 'U+0025-00FF', 'U+4??', 'U+??????', 'u+0-7f']) {
      expect(parse(`@font-face { unicode-range: ${token}; }`), token).toMatchObject({
        rules: [{ rules: [{ type: 'Declaration', value: { type: 'Any', src: token } }] }]
      });
    }
  });
});
