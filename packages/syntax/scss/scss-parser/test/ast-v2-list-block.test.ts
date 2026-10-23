import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { bare } from '../../../../../test/provenance-free.js';

describe('SCSS AST-v2 separator and delimiter facts', () => {
  it('reduces top-level slash lists without a slash keyword sentinel', () => {
    const root = parse('.card { ratio: 1 / 2; grid: 1 2 / 3 4; }');
    const body = root.rules[0];
    if (body?.type !== 'Ruleset') {
      throw new Error('expected rule');
    }
    const ratio = body.rules[0];
    const grid = body.rules[1];
    if (ratio?.type !== 'Declaration' || grid?.type !== 'Declaration') {
      throw new Error('expected declarations');
    }
    expect(ratio.value).toEqual({
      type: 'List',
      value: [
        { type: 'Dimension', number: 1, unit: '', src: '1' },
        { type: 'Dimension', number: 2, unit: '', src: '2' }
      ],
      sep: '/'
    });

    /* The slash groups only its direct neighbours (P33 as amended 2026-09-24). */
    expect(grid.value).toMatchObject([
      { src: '1' },
      { type: 'List', sep: '/', value: [{ src: '2' }, { src: '3' }] },
      { src: '4' }
    ]);
    expect(JSON.stringify(ratio.value)).not.toContain('"src":"/"');
  });

  it('retains Sass square bracketedness in the Block wrapper', () => {
    const root = parse('.card { tracks: [1, 2]; }');
    const body = root.rules[0];
    if (body?.type !== 'Ruleset') {
      throw new Error('expected rule');
    }
    const declaration = body.rules[0];
    if (declaration?.type !== 'Declaration') {
      throw new Error('expected declaration');
    }
    expect(bare(declaration.value)).toEqual({
      type: 'Block',
      delimiter: 'square',
      value: {
        type: 'List',
        sep: ',',
        value: [
          { type: 'Dimension', number: 1, unit: '', src: '1' },
          { type: 'Dimension', number: 2, unit: '', src: '2' }
        ]
      }
    });
    /*
     * The bracketedness is a PARSE fact and survives to emission: a balanced
     * `[ … ]` is a valid CSS simple block in any declaration value, so it prints
     * verbatim, matching dart-sass. Grid `<line-names>` validity — the one
     * property-value grammar that gives `[ … ]` meaning — is a property-specific
     * concern for the lint layer, not the emitter (§12.6c, ledger P24).
     */
    expect(serialize(root)).toEqual({ css: '.card {\n  tracks: [1, 2];\n}\n' });
  });

  it('prints a square Block whose interior IS line names', () => {
    const root = parse('.card { grid-template-columns: [full-start] 1fr [full-end]; }');
    expect(serialize(root)).toEqual({
      css: '.card {\n  grid-template-columns: [full-start] 1fr [full-end];\n}\n'
    });
  });

  /* Parens around a list are list syntax, as Dart Sass reads them (J16, SCSS paren lists, owner 2026-10-22). */
  it('parses a paren space list as the escaped list group, written without its parens', () => {
    const root = parse('.card { tracks: (1 2); }');
    const body = root.rules[0];
    if (body?.type !== 'Ruleset') {
      throw new Error('expected rule');
    }
    const declaration = body.rules[0];
    if (declaration?.type !== 'Declaration') {
      throw new Error('expected declaration');
    }
    expect(bare(declaration.value)).toEqual({
      type: 'Block',
      delimiter: 'curly',
      escaped: true,
      value: [
        { type: 'Dimension', number: 1, unit: '', src: '1' },
        { type: 'Dimension', number: 2, unit: '', src: '2' }
      ]
    });
    expect(serialize(root)).toEqual({ css: '.card {\n  tracks: 1 2;\n}\n' });
  });
});

describe('SCSS paren values', () => {
  const valueOf = (source: string): unknown => {
    const body = parse(source).rules[0];
    const declaration = body?.type === 'Ruleset' ? body.rules[0] : undefined;
    if (declaration?.type !== 'Declaration') {
      throw new Error('expected a declaration');
    }
    return bare(declaration.value);
  };

  /* Parens around a list are list syntax (J16, SCSS paren lists, owner 2026-10-22): the escaped group `~( … )` builds. */
  it('builds the escaped group around a comma list, a trailing-comma list and parens around a list', () => {
    const commaList = { type: 'List', sep: ',', value: [{ type: 'Keyword', src: 'c' }, { type: 'Keyword', src: 'd' }] };
    expect(valueOf('a {b: (c, d)}')).toMatchObject({ type: 'Block', delimiter: 'curly', escaped: true, value: commaList });
    expect(valueOf('a {b: (c,)}')).toMatchObject({ type: 'Block', delimiter: 'curly', escaped: true, value: { type: 'List', sep: ',', value: [{ type: 'Keyword', src: 'c' }] } });
    expect(valueOf('a {b: ((c, d))}')).toMatchObject({ type: 'Block', delimiter: 'curly', escaped: true, value: commaList });
  });

  /*
   * Around one value the group is escaped where Dart Sass drops its parens
   * (owner 2026-10-22), and J16's paren group around math, and around one value
   * in a Sass calculation or a CSS `if()` condition, where Dart Sass writes them.
   */
  it('escapes a group around one value outside a calculation and an if() condition', () => {
    expect(valueOf('a {b: ($c)}')).toMatchObject({ type: 'Block', delimiter: 'curly', escaped: true, value: { type: 'Lookup' } });
    expect(valueOf('a {b: (10px)}')).toMatchObject({ type: 'Block', delimiter: 'curly', escaped: true, value: { type: 'Dimension' } });
  });

  it('keeps the plain group around math, and around one value in calc() and an if() condition', () => {
    expect(valueOf('a {b: (1 + 2)}')).toMatchObject({ type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: '+' } });
    expect(valueOf('a {b: (1 + 2)}')).not.toHaveProperty('escaped');
    const calc = valueOf('a {b: calc(2 * ($c))}');
    expect(calc).toMatchObject({ type: 'FunctionCall', name: 'calc', args: [{ value: { type: 'Operation', right: { type: 'Block', value: { type: 'Lookup' } } } }] });
    expect(calc).not.toMatchObject({ args: [{ value: { right: { escaped: true } } }] });
    expect(valueOf('a {b: if(css(1) and (css(2)): c)}')).toMatchObject({ branches: [{ guard: { right: { parens: 1, value: { type: 'FunctionCall' } } } }] });
  });

  /* A call that is not a math function, inside one, reads its arguments as plain values again. */
  it('escapes a group around one value in a call inside calc()', () => {
    expect(valueOf('a {b: calc(1px + foo((10px)))}')).toMatchObject({
      args: [{ value: { right: { type: 'FunctionCall', name: 'foo', args: [{ value: { type: 'Block', escaped: true } }] } } }]
    });
  });
});
