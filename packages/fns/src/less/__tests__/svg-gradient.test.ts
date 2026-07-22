import { describe, expect, it } from 'vitest';
import { emitValue, makeColorRgb, makeKeyword, makeList, HEX } from '@jesscss/core/value';
import type { FnCtx, ValueObj } from '@jesscss/core/value';
import svgGradient from '../svg-gradient.js';

const context: FnCtx = {
  modes: { unitMode: 'preserve' },
  stringify: emitValue
};

function call(...args: ValueObj[]): ValueObj {
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

  it('rejects an invalid direction at the shared call boundary', () => {
    expect(() => call(makeKeyword('diagonal'), makeColorRgb([255, 0, 0], 1, HEX), makeColorRgb([0, 0, 255], 1, HEX)))
      .toThrow('svg-gradient direction');
  });
});
