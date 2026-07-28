import { describe, expect, it } from 'vitest';
import { emitValue, isValueGroupArray, makeDimension } from '@jesscss/core/value';
import type { ValueGroup } from '@jesscss/core/value';
import { range } from '../range.js';

function group(result: ValueGroup | Promise<ValueGroup>): readonly ValueGroup[] {
  if (result instanceof Promise) {
    throw new TypeError('Expected range() to be synchronous.');
  }
  if (!isValueGroupArray(result)) {
    throw new TypeError('Expected range() to return a raw value group.');
  }
  return result;
}

describe('default-spaced value groups', () => {
  it('returns a raw group from the AST-v2 range entrypoint', () => {
    const end = makeDimension(3, 'px');

    for (const result of [range(end)]) {
      const values = group(result);
      expect(values).toHaveLength(3);
      expect(emitValue(values)).toBe('1px 2px 3px');
    }
  });
});
