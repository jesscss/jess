import { describe, expect, it } from 'vitest';
import { guardUsesDefault } from '../guard.js';
import { funcCall, keyword, list } from '../nodes.js';

describe('guardUsesDefault', () => {
  it('finds default() inside a nested value-slot array', () => {
    expect(guardUsesDefault({
      g: 'cmp',
      op: '=',
      left: list([[keyword('left'), funcCall('default', [])]], ','),
      right: keyword('right')
    })).toBe(true);
  });

  it('rejects nested value-slot arrays without default()', () => {
    expect(guardUsesDefault({
      g: 'cmp',
      op: '=',
      left: list([[keyword('left'), funcCall('other', [])]], ','),
      right: keyword('right')
    })).toBe(false);
  });
});
