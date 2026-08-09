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
    expect(grid.value).toMatchObject({
      type: 'List',
      sep: '/',
      value: [
        [{ src: '1' }, { src: '2' }],
        [{ src: '3' }, { src: '4' }]
      ]
    });
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
     * The bracketedness is a PARSE fact and survives regardless; PRINTING it is
     * what CSS constrains. `[ … ]` in a value is grid `<line-names>`
     * (`'[' <custom-ident>* ']'`), so `[1, 2]` is data that has no CSS spelling
     * and says so at the point of emission. dart-sass prints it; Sass+ rejects
     * invalid CSS (ledger P4).
     */
    expect(() => serialize(root)).toThrow(/not printable CSS/u);
  });

  it('prints a square Block whose interior IS line names', () => {
    const root = parse('.card { grid-template-columns: [full-start] 1fr [full-end]; }');
    expect(serialize(root)).toEqual({
      css: '.card {\n  grid-template-columns: [full-start] 1fr [full-end];\n}\n'
    });
  });

  it('allows a paren Block to contain an authored space-value slot', () => {
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
      delimiter: 'paren',
      value: [
        { type: 'Dimension', number: 1, unit: '', src: '1' },
        { type: 'Dimension', number: 2, unit: '', src: '2' }
      ]
    });
    expect(serialize(root)).toEqual({ css: '.card {\n  tracks: (1 2);\n}\n' });
  });
});
