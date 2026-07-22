import { describe, expect, it } from 'vitest';
import { emitValue, isValueGroupArray, makeDimension } from '@jesscss/core/value';
import type { ValueGroup } from '@jesscss/core/value';
import { range } from '../range.js';
import lessRange from '../../less/range.js';

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
  it('returns raw groups from both AST-v2 range entrypoints', () => {
    const end = makeDimension(3, 'px');

    for (const result of [range(end), lessRange(end)]) {
      const values = group(result);
      expect(values).toHaveLength(3);
      expect(emitValue(values)).toBe('1px 2px 3px');
    }
  });
});
