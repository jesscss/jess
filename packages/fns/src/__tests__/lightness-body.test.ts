import { describe, expect, it } from 'vitest';
import { HEX, HSL, makeColorHsl, makeColorRgb, type Color } from '@jesscss/core';
import { emitValue } from '@jesscss/core/value';
import * as less from '../less/index.js';
import * as bodies from '../less/bodies.js';
import { call } from './harness.js';

/** Checked colours, as the hex reader and a literal colour make them, with channels out of range and a carried HSL too. */
const colors: Color[] = [
  makeColorRgb([204, 0, 0], 1, HEX),
  makeColorRgb([0, 136, 255], 1, HEX),
  makeColorRgb([18, 0, 171], 0.5, HEX),
  makeColorRgb([-20, 300, 12.5], 1, HEX),
  makeColorHsl([120, 0.5, 0.4], 1, HSL),
  makeColorHsl([0, 0, 1.2], 1, HSL)
];

/** A body a generated runtime module calls directly gives what the defined function gives, on the same checked colour (DESIGN-DECISIONS-NOTES.md, "Direct body calls"). */
describe('lightness body', () => {
  it('equals the defined function on each checked colour', () => {
    for (const c of colors) {
      expect(bodies.lightnessOf(c)).toEqual(call(less.lightness, c));
    }
  });

  it('is named where the defined function says its body is exported', () => {
    expect(less.lightness.bodyExport).toEqual({ module: '@jesscss/fns/less/bodies', name: 'lightnessOf', bytes: true });
  });

  it('writes, for each body whose result is marked as its bytes, what the value writer writes', () => {
    const marked = new Set(Object.values(less).flatMap(fn => typeof fn === 'function' && 'bodyExport' in fn && fn.bodyExport?.bytes === true ? [fn.bodyExport.name] : []));
    expect(marked.size).toBeGreaterThan(0);
    expect(Object.keys(bodies)).toEqual(expect.arrayContaining([...marked]));
    for (const [name, body] of Object.entries(bodies).filter(([name]) => marked.has(name))) {
      for (const c of colors) {
        const result = body(c);
        expect(result.bytes, `${name}(${c.bytes})`).toBe(emitValue(result));
      }
    }
  });
});
