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
    const fixtures = readdirSync(fixtureRoot).filter(name => name.endsWith('.css'));

    /*
     * A directory-driven loop over an empty directory passes while asserting
     * nothing, and reads exactly like a pass. Assert the count so the fixture
     * set cannot shrink — or fail to resolve — in silence.
     */
    expect(fixtures.length).toBe(34);
    for (const filename of fixtures) {
      const source = readFileSync(join(fixtureRoot, filename), 'utf8');
      const cst = parseCssCst(source);
      expect(cst.errors, filename).toHaveLength(0);
      expect(cst.unconsumedFrom, filename).toBeNull();
      expect(() => parse(source), filename).not.toThrow();
    }
  });

  it('rejects every public-CST error fixture through the direct Stylesheet route', () => {
    const fixtureRoot = join(import.meta.dirname, 'css/errors');
    const fixtures = readdirSync(fixtureRoot).filter(name => name.endsWith('.css'));
    expect(fixtures.length).toBe(53);
    for (const filename of fixtures) {
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
          type: 'FunctionCall', name: 'selector',
          args: [{ type: 'Interpolation', parts: [{ lit: '.grid /* keep */ :is(.a, .b)' }] }]
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

  it('accepts non-ASCII idents that merely share an nth prefix', () => {
    /*
     * The nth-name boundary must span the FULL ident-continue set of
     * css-syntax-3 §4.3.11, which admits every code point >= U+0080. A boundary
     * narrower than that succeeds on `:nth-childé`, reclassifying a plain
     * identifier as an nth name and excluding it from the keyword-pseudo arm —
     * turning valid CSS into a parse error.
     */
    for (const source of [
      ':nth-childé { color: red; }',
      ':nth-child中 { color: red; }',
      ':nth-of-typeé { color: red; }',
      ':nth-last-childé { color: red; }',
      ':nth-childé(2n) { color: red; }'
    ]) {
      expect(() => parse(source), source).not.toThrow();
    }

    /* A paren-less REAL nth name is still rejected. */
    for (const source of [
      ':nth-child { color: red; }',
      ':nth-of-type { color: red; }',
      ':nth-last-child { color: red; }',
      ':nth-last-of-type { color: red; }'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
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

  /*
   * The value ladder runs under `ValueSequence`'s `noTrivia`, and parseman clears
   * trivia for every rule reached through a `g.` reference, not only for the terms
   * spelled inside the wrapper. So each of these interiors has to spell its own
   * padding, and it has to spell the comment-bearing `cssValueTrivia`: the ones
   * that spelled a bare `[ \t\n\r\f]` run rejected comments, and the ones that
   * spelled nothing rejected whitespace too. Both columns are asserted together
   * because a fix that restores only the comment column would leave `( c )` — the
   * same defect, one character apart — still rejected.
   */
  it('admits authored whitespace and comments at every value-interior boundary', () => {
    const templates = [
      '(Tc)', '(cT)', '(TcT)', '(cTd)', '(cT,d)', '(c,Td)',
      'f(Tc)', 'f(cT)', 'f(cT,d)', 'f(c,Td)',
      'min(1pxT,2px)', 'min(1px,T2px)',
      'var(T--x,e)', 'var(--xT,e)', 'var(--x,Te)', 'var(--x,eT)',
      'calc(T1px + 2px)', 'calc(1px + 2pxT)', 'calc(1pxT*T2)', 'calc(1px T+T 2px)'
    ];
    for (const template of templates) {
      for (const fill of [' ', '/* c */', '/* ) */']) {
        const source = `a { b: ${template.replaceAll('T', fill)} }`;
        expect(() => parse(source), source).not.toThrow();
      }
    }
  });

  /*
   * css-values-4 §10.1 requires real whitespace on both sides of `+` and `-`, and
   * a comment does not supply it. Widening the padding to admit comments must not
   * quietly drop that, so the one-sided spellings stay rejected.
   */
  it('still requires whitespace, not a comment, on both sides of a calc sum operator', () => {
    for (const source of [
      'a { b: calc(1px+2px) }',
      'a { b: calc(1px/* c */+ 2px) }',
      'a { b: calc(1px +/* c */2px) }'
    ]) {
      expect(() => parse(source), source).toThrow();
    }
  });
});
