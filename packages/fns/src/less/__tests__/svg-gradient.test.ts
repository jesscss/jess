import { describe, expect, it } from 'vitest';
import { emitValue, makeColorRgb, makeKeyword, makeList, HEX } from '@jesscss/core';
import type { FnCtx, Value } from '@jesscss/core';
import svgGradient from '../svg-gradient.js';

const context: FnCtx = {
  modes: { unitMode: 'preserve' },
  stringify: emitValue
};

function call(...args: Value[]): Value {
  const result = svgGradient(makeList(args, ','), context);
  if (result instanceof Promise || Array.isArray(result)) {
    throw new TypeError('Expected a synchronous scalar svg-gradient result.');
  }
  return result;
}

describe('svg-gradient()', () => {
  it('returns the value-domain data URI for structural color stops', () => {
    const result = call(
      makeKeyword('to right'),
      makeColorRgb([255, 0, 0], 1, HEX),
      makeColorRgb([0, 0, 255], 1, HEX)
    );

    expect(result.type).toBe('Keyword');
    expect(result.bytes.startsWith('url(\'data:image/svg+xml,')).toBe(true);
    const svg = decodeURIComponent(result.bytes.slice('url(\'data:image/svg+xml,'.length, -2));
    expect(svg).toContain('stop-color="#ff0000"');
    expect(svg).toContain('stop-color="#0000ff"');
  });

  it('accepts named-color keyword stops (black/white arrive as Keywords)', () => {
    const result = call(
      makeKeyword('to bottom'),
      makeKeyword('black'),
      makeKeyword('white')
    );

    expect(result.type).toBe('Keyword');
    const svg = decodeURIComponent(result.bytes.slice('url(\'data:image/svg+xml,'.length, -2));
    expect(svg).toContain('stop-color="#000000"');
    expect(svg).toContain('stop-color="#ffffff"');
  });

  it('rejects a keyword stop that is not a named color', () => {
    expect(() => call(makeKeyword('to bottom'), makeKeyword('notacolor'), makeKeyword('white')))
      .toThrow();
  });

  it('rejects an invalid direction at the shared call boundary', () => {
    expect(() => call(makeKeyword('diagonal'), makeColorRgb([255, 0, 0], 1, HEX), makeColorRgb([0, 0, 255], 1, HEX)))
      .toThrow('svg-gradient direction');
  });
});
