import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';
import { serialize } from '../../../../core/src/ast/serialize.js';

describe('SCSS AST-v2 separator and delimiter facts', () => {
  it('reduces top-level slash lists without a slash keyword sentinel', () => {
    const root = parse('.card { ratio: 1 / 2; grid: 1 2 / 3 4; }');
    const body = root.children[0];
    if (body?.type !== 'Rule') {
      throw new Error('expected rule');
    }
    const ratio = body.body[0];
    const grid = body.body[1];
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
    const body = root.children[0];
    if (body?.type !== 'Rule') {
      throw new Error('expected rule');
    }
    const declaration = body.body[0];
    if (declaration?.type !== 'Declaration') {
      throw new Error('expected declaration');
    }
    expect(declaration.value).toEqual({
      type: 'Block',
      delimiter: 'square',
      inner: {
        type: 'List',
        sep: ',',
        value: [
          { type: 'Dimension', number: 1, unit: '', src: '1' },
          { type: 'Dimension', number: 2, unit: '', src: '2' }
        ]
      }
    });
    expect(serialize(root)).toEqual({ css: '.card {\n  tracks: [1, 2];\n}\n' });
  });

  it('allows a paren Block to contain an authored space-value slot', () => {
    const root = parse('.card { tracks: (1 2); }');
    const body = root.children[0];
    if (body?.type !== 'Rule') {
      throw new Error('expected rule');
    }
    const declaration = body.body[0];
    if (declaration?.type !== 'Declaration') {
      throw new Error('expected declaration');
    }
    expect(declaration.value).toEqual({
      type: 'Block',
      delimiter: 'paren',
      inner: [
        { type: 'Dimension', number: 1, unit: '', src: '1' },
        { type: 'Dimension', number: 2, unit: '', src: '2' }
      ]
    });
    expect(serialize(root)).toEqual({ css: '.card {\n  tracks: (1 2);\n}\n' });
  });
});
