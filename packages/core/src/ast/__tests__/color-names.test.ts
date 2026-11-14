import colors from 'color-name';
import { describe, expect, it } from 'vitest';
import { namedColor, shortestColorName } from '../color-names.js';

describe('the named-color table', () => {
  it('holds every css-color-4 keyword in color-name, with its rgb', () => {
    for (const [name, rgb] of Object.entries(colors)) {
      expect(namedColor(name.toUpperCase())).toEqual({ rgb, alpha: 1 });
    }
    expect(namedColor('transparent')).toEqual({ rgb: [0, 0, 0], alpha: 0 });
    expect(namedColor('constructor')).toBeUndefined();
  });

  it('names an rgb by its shortest keyword', () => {
    expect(shortestColorName(255, 0, 0, 1)).toBe('red');
    expect(shortestColorName(0, 255, 255, 1)).toBe('aqua');
    expect(shortestColorName(128, 128, 128, 1)).toBe('gray');
    expect(shortestColorName(255, 0, 0, 0.5)).toBeUndefined();
  });
});
