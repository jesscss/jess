import { describe, expect, it } from 'vitest';
import { invoke } from '../../__tests__/harness.js';
import { emitValue, isValueGroup, isValueGroupArray, makeDimension } from '@jesscss/core';
import type { ValueGroup } from '@jesscss/core';
import { range } from '../range.js';

function group(result: unknown): readonly ValueGroup[] {
  if (result instanceof Promise) {
    throw new TypeError('Expected range() to be synchronous.');
  }
  if (!isValueGroup(result) || !isValueGroupArray(result)) {
    throw new TypeError('Expected range() to return a raw value group.');
  }
  return result;
}

describe('default-spaced value groups', () => {
  it('returns a raw group from the AST-v2 range entrypoint', () => {
    const end = makeDimension(3, 'px');

    for (const result of [invoke(range, end)]) {
      const values = group(result);
      expect(values).toHaveLength(3);
      expect(emitValue(values)).toBe('1px 2px 3px');
    }
  });
});
