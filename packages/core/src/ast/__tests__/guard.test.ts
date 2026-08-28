import { describe, expect, it } from 'vitest';
import { evalGuard, guardUsesDefault } from '../guard.js';
import { funcCall, keyword, list } from '../nodes.js';
import { typeCheck } from '../value-guards.js';

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

describe('evalGuard', () => {
  it('resolves a recursive value slot as one truth operand', () => {
    const value = [keyword('true')];
    expect(evalGuard({ g: 'truth', value }, {
      resolveTyped(slot) {
        expect(slot).toBe(value);
        return { type: 'Keyword', text: 'true', bytes: 'true' };
      },
      ev: null,
      modes: {},
      isDefault: () => false
    })).toBe(true);
  });
});

describe('typeCheck', () => {
  it('recognizes only the structural URL value in guard position', () => {
    expect(typeCheck('isurl', [{ type: 'Url', bytes: 'url("x")' }])).toBe(true);
    expect(typeCheck('isurl', [{ type: 'Keyword', text: 'url("x")', bytes: 'url("x")' }])).toBe(false);
  });
});
