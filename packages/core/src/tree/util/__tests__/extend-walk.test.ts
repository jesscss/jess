/**
 * Unit tests for walk-and-consume extend algorithm.
 *
 * Tests verify that walkAndExtend produces identical results
 * to the legacy extendSelector for supported cases.
 */
import { describe, it, expect } from 'vitest';
import {
  el, sel, sellist, compound, is, co
} from '../../../index.js';
import type { Selector } from '../../../index.js';
import { walkAndExtend, canUseWalkAndConsume, wouldExtendChange } from '../extend-walk.js';
import { extendSelector } from '../extend.js';

// ─────────────────────────────────────────────────
// canUseWalkAndConsume
// ─────────────────────────────────────────────────
describe('canUseWalkAndConsume', () => {
  it('returns true for SimpleSelector find', () => {
    expect(canUseWalkAndConsume(el('.a'), el('.b'))).toBe(true);
  });

  it('returns true for CompoundSelector find', () => {
    expect(canUseWalkAndConsume(el('.a'), compound([el('.a'), el('.b')]))).toBe(true);
  });

  it('returns false for ComplexSelector find', () => {
    expect(canUseWalkAndConsume(el('.a'), sel([el('.a'), co(' '), el('.b')]))).toBe(false);
  });
});

// ─────────────────────────────────────────────────
// walkAndExtend: full mode (partial: false)
// ─────────────────────────────────────────────────
describe('walkAndExtend full mode', () => {
  it('root SimpleSelector match → SelectorList', () => {
    const result = walkAndExtend(el('.a'), el('.a'), el('.b'), false);
    const val = result.valueOf();
    expect(val).toContain('.a');
    expect(val).toContain('.b');
  });

  it('no match → returns original unchanged', () => {
    const target = el('.x');
    const result = walkAndExtend(target, el('.z'), el('.b'), false);
    expect(result).toBe(target);
  });

  it('self-extend → returns original unchanged', () => {
    const target = el('.a');
    const result = walkAndExtend(target, el('.a'), el('.a'), false);
    expect(result).toBe(target);
  });

  it('inside SelectorList → extends matching items', () => {
    const target = sellist([el('.a'), el('.b')]) as unknown as Selector;
    const result = walkAndExtend(target, el('.a'), el('.c'), false);
    const val = result.valueOf();
    expect(val).toContain('.a');
    expect(val).toContain('.b');
    expect(val).toContain('.c');
  });

  it('inside CompoundSelector → does NOT extend (full mode rejects component matches)', () => {
    const target = compound([el('.a'), el('.b')]);
    const result = walkAndExtend(target, el('.a'), el('.c'), false);
    // Full mode: component match inside compound = partial match → rejected
    expect(result.valueOf()).toBe(target.valueOf());
  });

  it('inside ComplexSelector → does NOT extend (full mode rejects component matches)', () => {
    const target = sel([el('.a'), co(' '), el('.b')]);
    const result = walkAndExtend(target, el('.a'), el('.c'), false);
    // Full mode: component match inside complex = partial match → rejected
    expect(result.valueOf()).toBe(target.valueOf());
  });

  it('inside :is() arg (sole pseudo) → extends', () => {
    const target = is(el('.a'));
    const result = walkAndExtend(target, el('.a'), el('.b'), false);
    const val = result.valueOf();
    expect(val).toContain('.a');
    expect(val).toContain('.b');
  });

  it('inside :is() with siblings → does NOT extend (partial match of outer compound)', () => {
    // :is(.a).x — matching .a inside :is() when .x is after → partial match
    const target = compound([is(el('.a')), el('.x')]);
    const result = walkAndExtend(target, el('.a'), el('.b'), false);
    expect(result.valueOf()).toBe(target.valueOf());
  });

  it('matches within SelectorList :is() arg → extends the matching item', () => {
    const target = is(sellist([el('.a'), el('.b')]) as unknown as Selector);
    const result = walkAndExtend(target, el('.a'), el('.c'), false);
    const val = result.valueOf();
    expect(val).toContain('.a');
    expect(val).toContain('.b');
    expect(val).toContain('.c');
  });
});

// ─────────────────────────────────────────────────
// walkAndExtend: partial mode (partial: true)
// ─────────────────────────────────────────────────
describe('walkAndExtend partial mode', () => {
  it('root SimpleSelector match → SelectorList', () => {
    const result = walkAndExtend(el('.a'), el('.a'), el('.b'), true);
    const val = result.valueOf();
    expect(val).toContain('.a');
    expect(val).toContain('.b');
  });

  it('inside CompoundSelector → wraps in :is()', () => {
    const target = compound([el('.a'), el('.b')]);
    const result = walkAndExtend(target, el('.a'), el('.c'), true);
    const val = result.valueOf();
    expect(val).toContain(':is');
    expect(val).toContain('.c');
    expect(val).toContain('.b');
  });

  it('inside ComplexSelector → wraps in :is()', () => {
    const target = sel([el('.a'), co(' '), el('.b')]);
    const result = walkAndExtend(target, el('.b'), el('.c'), true);
    const val = result.valueOf();
    expect(val).toContain(':is');
    expect(val).toContain('.c');
  });

  it('multiple matches in CompoundSelector → wraps each', () => {
    // .a.a → each .a should be wrapped independently
    const target = compound([el('.a'), el('.a')]);
    const result = walkAndExtend(target, el('.a'), el('.b'), true);
    const val = result.valueOf();
    expect(val).toContain(':is');
    expect(val).toContain('.b');
  });

  it('inside SelectorList → extends each matching item', () => {
    const target = sellist([el('.a'), el('.b')]) as unknown as Selector;
    const result = walkAndExtend(target, el('.a'), el('.c'), true);
    const val = result.valueOf();
    expect(val).toContain('.a');
    expect(val).toContain('.b');
    expect(val).toContain('.c');
  });

  it('inside :is() arg → extends', () => {
    const target = is(el('.a'));
    const result = walkAndExtend(target, el('.a'), el('.b'), true);
    const val = result.valueOf();
    expect(val).toContain('.a');
    expect(val).toContain('.b');
  });
});

// ─────────────────────────────────────────────────
// Phase 2: CompoundSelector find
// ─────────────────────────────────────────────────
describe('walkAndExtend compound find (Phase 2)', () => {
  it('full: whole compound match at root → SelectorList', () => {
    const target = compound([el('.a'), el('.b')]);
    const find = compound([el('.a'), el('.b')]);
    const result = walkAndExtend(target, find, el('.c'), false);
    const val = result.valueOf();
    expect(val).toContain('.a.b');
    expect(val).toContain('.c');
  });

  it('full: whole compound match order-independent', () => {
    const target = compound([el('.b'), el('.a')]);
    const find = compound([el('.a'), el('.b')]);
    const result = walkAndExtend(target, find, el('.c'), false);
    const val = result.valueOf();
    expect(val).toContain('.c');
  });

  it('full: compound subset → no match (non-partial rejects subsets)', () => {
    const target = compound([el('.a'), el('.b'), el('.c')]);
    const find = compound([el('.a'), el('.b')]);
    const result = walkAndExtend(target, find, el('.q'), false);
    expect(result).toBe(target);
  });

  it('partial: compound subset match → :is(find, extendWith) + remainder', () => {
    const target = compound([el('.a'), el('.b'), el('.c')]);
    const find = compound([el('.a'), el('.b')]);
    const result = walkAndExtend(target, find, el('.q'), true);
    const val = result.valueOf();
    expect(val).toContain(':is');
    expect(val).toContain('.q');
    expect(val).toContain('.c');
  });

  it('partial: non-contiguous subset → still matches', () => {
    const target = compound([el('.a'), el('.c'), el('.b')]);
    const find = compound([el('.a'), el('.b')]);
    const result = walkAndExtend(target, find, el('.q'), true);
    const val = result.valueOf();
    expect(val).toContain(':is');
    expect(val).toContain('.q');
    expect(val).toContain('.c');
  });

  it('partial: no subset → no match', () => {
    const target = compound([el('.a'), el('.c')]);
    const find = compound([el('.a'), el('.b')]);
    const result = walkAndExtend(target, find, el('.q'), true);
    expect(result).toBe(target);
  });

  it('compound find in SelectorList → extends matching items', () => {
    const target = sellist([
      compound([el('.a'), el('.b')]),
      el('.x')
    ]) as unknown as Selector;
    const find = compound([el('.a'), el('.b')]);
    const result = walkAndExtend(target, find, el('.c'), false);
    const val = result.valueOf();
    expect(val).toContain('.a.b');
    expect(val).toContain('.c');
    expect(val).toContain('.x');
  });
});

describe('wouldExtendChange compound find (Phase 2)', () => {
  it('full: returns true for whole compound match', () => {
    const target = compound([el('.a'), el('.b')]);
    const find = compound([el('.a'), el('.b')]);
    expect(wouldExtendChange(target, find, el('.c'), false)).toBe(true);
  });

  it('full: returns false for compound subset', () => {
    const target = compound([el('.a'), el('.b'), el('.c')]);
    const find = compound([el('.a'), el('.b')]);
    expect(wouldExtendChange(target, find, el('.q'), false)).toBe(false);
  });

  it('partial: returns true for compound subset', () => {
    const target = compound([el('.a'), el('.b'), el('.c')]);
    const find = compound([el('.a'), el('.b')]);
    expect(wouldExtendChange(target, find, el('.q'), true)).toBe(true);
  });

  it('partial: returns false when no subset match', () => {
    const target = compound([el('.a'), el('.c')]);
    const find = compound([el('.a'), el('.b')]);
    expect(wouldExtendChange(target, find, el('.q'), true)).toBe(false);
  });
});

// ─────────────────────────────────────────────────
// Equivalence with legacy extendSelector
// ─────────────────────────────────────────────────
describe('walkAndExtend vs extendSelector equivalence', () => {
  const cases: Array<{
    name: string;
    target: () => Selector;
    find: () => Selector;
    extendWith: () => Selector;
    partial: boolean;
  }> = [
    {
      name: 'full: .a extending .a with .b',
      target: () => el('.a'),
      find: () => el('.a'),
      extendWith: () => el('.b'),
      partial: false
    },
    {
      name: 'full: SelectorList(.a, .b) extending .a with .c',
      target: () => sellist([el('.a'), el('.b')]) as unknown as Selector,
      find: () => el('.a'),
      extendWith: () => el('.c'),
      partial: false
    },
    {
      name: 'full: compound .a.b extending .a with .c (no match)',
      target: () => compound([el('.a'), el('.b')]),
      find: () => el('.a'),
      extendWith: () => el('.c'),
      partial: false
    },
    {
      name: 'partial: .a extending .a with .b',
      target: () => el('.a'),
      find: () => el('.a'),
      extendWith: () => el('.b'),
      partial: true
    },
    {
      name: 'partial: .a .b extending .b with .c',
      target: () => sel([el('.a'), co(' '), el('.b')]),
      find: () => el('.b'),
      extendWith: () => el('.c'),
      partial: true
    },
    {
      name: 'full: .a.b extending .a.b with .c',
      target: () => compound([el('.a'), el('.b')]),
      find: () => compound([el('.a'), el('.b')]),
      extendWith: () => el('.c'),
      partial: false
    },
    {
      name: 'partial: .a.b.c extending .a.b with .q',
      target: () => compound([el('.a'), el('.b'), el('.c')]),
      find: () => compound([el('.a'), el('.b')]),
      extendWith: () => el('.q'),
      partial: true
    }
  ];

  for (const c of cases) {
    it(c.name, () => {
      const walkResult = walkAndExtend(c.target(), c.find(), c.extendWith(), c.partial);
      const legacyResult = extendSelector(c.target(), c.find(), c.extendWith(), c.partial);
      expect(walkResult.valueOf()).toBe(legacyResult.valueOf());
    });
  }
});

// ─────────────────────────────────────────────────
// wouldExtendChange
// ─────────────────────────────────────────────────
describe('wouldExtendChange', () => {
  it('returns false when find === extendWith (self-extend)', () => {
    expect(wouldExtendChange(el('.a'), el('.a'), el('.a'), false)).toBe(false);
  });

  it('returns true when target matches find', () => {
    expect(wouldExtendChange(el('.a'), el('.a'), el('.b'), false)).toBe(true);
  });

  it('returns false when no match', () => {
    expect(wouldExtendChange(el('.x'), el('.z'), el('.b'), false)).toBe(false);
  });

  it('returns true for match inside SelectorList', () => {
    const target = sellist([el('.a'), el('.b')]) as unknown as Selector;
    expect(wouldExtendChange(target, el('.a'), el('.c'), false)).toBe(true);
  });

  it('full mode: returns false for component match inside CompoundSelector', () => {
    const target = compound([el('.a'), el('.b')]);
    expect(wouldExtendChange(target, el('.a'), el('.c'), false)).toBe(false);
  });

  it('partial mode: returns true for component match inside CompoundSelector', () => {
    const target = compound([el('.a'), el('.b')]);
    expect(wouldExtendChange(target, el('.a'), el('.c'), true)).toBe(true);
  });

  it('full mode: returns false for component match inside ComplexSelector', () => {
    const target = sel([el('.a'), co(' '), el('.b')]);
    expect(wouldExtendChange(target, el('.a'), el('.c'), false)).toBe(false);
  });

  it('partial mode: returns true for component match inside ComplexSelector', () => {
    const target = sel([el('.a'), co(' '), el('.b')]);
    expect(wouldExtendChange(target, el('.b'), el('.c'), true)).toBe(true);
  });

  it('full mode: :is() with siblings → false', () => {
    const target = compound([is(el('.a')), el('.x')]);
    expect(wouldExtendChange(target, el('.a'), el('.b'), false)).toBe(false);
  });
});
