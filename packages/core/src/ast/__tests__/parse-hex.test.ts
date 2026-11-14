import { describe, expect, it } from 'vitest';
import { parseHex } from '../literal-tag.js';

/** A hex colour's rgb and alpha, for each length the grammar's colour token takes. */
describe('parseHex', () => {
  it.each([
    ['#c00', [204, 0, 0], 1],
    ['#C00A', [204, 0, 0], 170 / 255],
    ['#cc0000', [204, 0, 0], 1],
    ['#1200ab', [18, 0, 171], 1],
    ['#CC0000AA', [204, 0, 0], 170 / 255],
    ['#00000000', [0, 0, 0], 0]
  ] as const)('reads %s', (hex, rgb, alpha) => {
    expect(parseHex(hex)).toEqual({ rgb, alpha });
  });

  it('reads a short digit as the byte that doubles it', () => {
    for (const d of '0123456789abcdef') {
      expect(parseHex(`#${d}${d}${d}${d}`)).toEqual(parseHex(`#${d}${d}${d}${d}${d}${d}${d}${d}`));
    }
  });
});
