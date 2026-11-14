import { describe, expect, it } from 'vitest';
import { serializeColor, HEX } from '../color.js';
import { sniffLiteral } from '../literal-tag.js';
import { makeColorRgb } from '../value-factory.js';

const spellings = ['#c00', '#CC0000', '#c00a', '#cc0000aa', '#Cc0000AA', 'red', 'Red', 'REBECCAPURPLE', 'transparent'];

describe('a colour read from its spelling', () => {
  it.each(spellings)('%s keeps its spelling as its bytes, as the colour writer would write it', (src) => {
    const color = sniffLiteral(src);
    if (color.type !== 'Color') {
      throw new Error(`${src} read as ${color.type}`);
    }
    const written = makeColorRgb(color.rgb, color.alpha, HEX, { src });
    expect(color.bytes).toBe(src);
    expect(color.src).toBe(src);
    expect(serializeColor(color)).toBe(src);
    expect({ ...color }).toEqual({ ...written });
  });
});
