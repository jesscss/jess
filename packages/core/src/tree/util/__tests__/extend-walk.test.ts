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
import {
  walkAndExtend,
  canUseWalkAndConsume,
  wouldExtendChange,
  classifyExtendTargetPresence
} from '../extend-walk.js';
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

  it('returns true for ComplexSelector find', () => {
    expect(canUseWalkAndConsume(el('.a'), sel([el('.a'), co(' '), el('.b')]))).toBe(true);
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
    const target = sellist([el('.a'), el('.b')]);
    const result = walkAndExtend(target, el('.a'), el('.c'), false);
    const val = result.valueOf();
    expect(val).toContain('.a');
    expect(val).toContain('.b');
    expect(val).toContain('.c');
  });

  it('keeps unchanged selector-list source items parented to the source list', () => {
    const target = sellist([el('.a'), el('.b')]);
    const unchanged = target.value[1]!;

    const result = walkAndExtend(target, el('.a'), el('.c'), false);

    expect(result.valueOf()).toBe('.a,.b,.c');
    expect(target.value[1]).toBe(unchanged);
    expect(unchanged.parent).toBe(target);
  });

  it('inside CompoundSelector → does NOT extend (full mode rejects component matches)', () => {
    const target = compound([el('.a'), el('.b')]);
    const result = walkAndExtend(target, el('.a'), el('.c'), false);
    // Full mode: component match inside compound = partial match → rejected
    expect(result.valueOf()).toBe(target.valueOf());
  });

  it('root string-backed single-component compound matches exact simple target', () => {
    const result = walkAndExtend(compound(['.a']), el('.a'), el('.c'), false);
    expect(result.valueOf()).toBe('.a,.c');
  });

  it('inside ComplexSelector → does NOT extend (full mode rejects component matches)', () => {
    const target = sel([el('.a'), co(' '), el('.b')]);
    const result = walkAndExtend(target, el('.a'), el('.c'), false);
    // Full mode: component match inside complex = partial match → rejected
    expect(result.valueOf()).toBe(target.valueOf());
  });

  it('single-component ComplexSelector matches as a whole selector in full mode', () => {
    const result = walkAndExtend(sel([el('.a')]), el('.a'), el('.c'), false);
    expect(result.valueOf()).toBe('.a,.c');
  });

  it('single-component ComplexSelector inside SelectorList extends as one list item', () => {
    const result = walkAndExtend(sellist([sel([el('.a')])]), el('.a'), el('.c'), false);
    expect(result.valueOf()).toBe('.a,.c');
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
    const target = is(sellist([el('.a'), el('.b')]));
    const result = walkAndExtend(target, el('.a'), el('.c'), false);
    const val = result.valueOf();
    expect(val).toContain('.a');
    expect(val).toContain('.b');
    expect(val).toContain('.c');
  });

  it('keeps unchanged :is() selector-list alternatives parented to the source argument list', () => {
    const arg = sellist([el('.a'), el('.b')]);
    const unchanged = arg.value[1]!;
    const target = is(arg);

    const result = walkAndExtend(target, el('.a'), el('.c'), false);

    expect(result.valueOf()).toBe(':is(.a,.b,.c)');
    expect(arg.value[1]).toBe(unchanged);
    expect(unchanged.parent).toBe(arg);
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

  it('string-backed compound component wraps in :is() for partial simple target', () => {
    const result = walkAndExtend(compound(['.a', '.b']), el('.a'), el('.c'), true);
    expect(result.valueOf()).toBe(':is(.a,.c).b');
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
    const target = sellist([el('.a'), el('.b')]);
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

  it('partial: string-backed compound subset behaves like node-backed components', () => {
    const target = compound(['.a', '.b', '.c']);
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
    ]);
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
      target: () => sellist([el('.a'), el('.b')]),
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
    const target = sellist([el('.a'), el('.b')]);
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

  it('full mode: returns true for single-component ComplexSelector whole-item match', () => {
    expect(wouldExtendChange(sel([el('.a')]), el('.a'), el('.c'), false)).toBe(true);
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

describe('classifyExtendTargetPresence', () => {
  it('reports self-extend target presence without treating it as an output change', () => {
    expect(classifyExtendTargetPresence(el('.a'), el('.a'), false)).toBe('local');
    expect(wouldExtendChange(el('.a'), el('.a'), el('.a'), false)).toBe(false);
  });

  it('reports selector-list item target presence through the walk path', () => {
    expect(classifyExtendTargetPresence(sellist([el('.a'), el('.b')]), el('.b'), false)).toBe('local');
  });

  it('reports single-component complex target presence through the walk path', () => {
    expect(classifyExtendTargetPresence(sel([el('.a')]), el('.a'), false)).toBe('local');
  });
});

// ─────────────────────────────────────────────────
// Phase 3: ComplexSelector find
// ─────────────────────────────────────────────────
describe('walkAndExtend: ComplexSelector find', () => {
  describe('full mode (partial: false)', () => {
    it('matches exact complex selector', () => {
      const target = sel([el('.a'), co(' '), el('.b')]);
      const find = sel([el('.a'), co(' '), el('.b')]);
      const result = walkAndExtend(target, find, el('.z'), false);
      expect(result.valueOf()).toBe('.a .b,.z');
    });

    it('does not match subsequence in full mode', () => {
      const target = sel([el('.a'), co(' '), el('.b'), co(' '), el('.c')]);
      const find = sel([el('.a'), co(' '), el('.b')]);
      const result = walkAndExtend(target, find, el('.z'), false);
      expect(result).toBe(target); // unchanged
    });

    it('does not match with different combinator', () => {
      const target = sel([el('.a'), co(' '), el('.b')]);
      const find = sel([el('.a'), co('>'), el('.b')]);
      const result = walkAndExtend(target, find, el('.z'), false);
      expect(result).toBe(target); // unchanged
    });

    it('matches when target has :is() at each position', () => {
      const target = sel([
        is(sellist([el('.a'), el('.x')])),
        co(' '),
        is(sellist([el('.b'), el('.y')]))
      ]);
      const find = sel([el('.a'), co(' '), el('.b')]);
      const result = walkAndExtend(target, find, el('.z'), false);
      expect(result.valueOf()).toBe(':is(.a,.x) :is(.b,.y),.z');
    });
  });

  describe('partial mode (partial: true)', () => {
    it('matches subsequence and wraps in :is()', () => {
      const target = sel([el('.a'), co(' '), el('.b'), co(' '), el('.c')]);
      const find = sel([el('.a'), co(' '), el('.b')]);
      const result = walkAndExtend(target, find, el('.z'), true);
      expect(result.valueOf()).toBe(':is(.a .b,.z) .c');
    });

    it('matches suffix subsequence', () => {
      const target = sel([el('.a'), co(' '), el('.b'), co('>'), el('.c')]);
      const find = sel([el('.b'), co('>'), el('.c')]);
      const result = walkAndExtend(target, find, el('.z'), true);
      expect(result.valueOf()).toBe('.a :is(.b>.c,.z)');
    });

    it('matches entire target in partial mode', () => {
      const target = sel([el('.a'), co(' '), el('.b')]);
      const find = sel([el('.a'), co(' '), el('.b')]);
      const result = walkAndExtend(target, find, el('.z'), true);
      expect(result.valueOf()).toBe('.a .b,.z');
    });

    it('does not match with mismatched combinator', () => {
      const target = sel([el('.a'), co('+'), el('.b'), co(' '), el('.c')]);
      const find = sel([el('.a'), co(' '), el('.b')]);
      const result = walkAndExtend(target, find, el('.z'), true);
      expect(result).toBe(target); // unchanged
    });

    it('matches through :is() alternatives at each position', () => {
      const target = sel([
        is(sellist([el('.a'), el('.x')])),
        co('>'),
        is(sellist([el('.b'), el('.y')])),
        co(' '),
        el('.c')
      ]);
      const find = sel([el('.a'), co('>'), el('.b')]);
      const result = walkAndExtend(target, find, el('.z'), true);
      expect(result.valueOf()).toBe(':is(:is(.a,.x)>:is(.b,.y),.z) .c');
    });

    it('matches compound selectors within complex find', () => {
      const target = sel([compound([el('.a'), el('.b')]), co(' '), el('.c')]);
      const find = sel([compound([el('.a'), el('.b')]), co(' '), el('.c')]);
      const result = walkAndExtend(target, find, el('.z'), true);
      expect(result.valueOf()).toBe('.a.b .c,.z');
    });
  });
});

describe('wouldExtendChange: ComplexSelector find', () => {
  it('returns true for exact complex match', () => {
    const target = sel([el('.a'), co(' '), el('.b')]);
    const find = sel([el('.a'), co(' '), el('.b')]);
    expect(wouldExtendChange(target, find, el('.z'), false)).toBe(true);
  });

  it('returns false for subsequence in full mode', () => {
    const target = sel([el('.a'), co(' '), el('.b'), co(' '), el('.c')]);
    const find = sel([el('.a'), co(' '), el('.b')]);
    expect(wouldExtendChange(target, find, el('.z'), false)).toBe(false);
  });

  it('returns true for subsequence in partial mode', () => {
    const target = sel([el('.a'), co(' '), el('.b'), co(' '), el('.c')]);
    const find = sel([el('.a'), co(' '), el('.b')]);
    expect(wouldExtendChange(target, find, el('.z'), true)).toBe(true);
  });

  it('returns false for mismatched combinator', () => {
    const target = sel([el('.a'), co(' '), el('.b')]);
    const find = sel([el('.a'), co('>'), el('.b')]);
    expect(wouldExtendChange(target, find, el('.z'), true)).toBe(false);
  });

  it('returns true when matching through :is() alternatives', () => {
    const target = sel([
      is(sellist([el('.a'), el('.x')])),
      co(' '),
      el('.b')
    ]);
    const find = sel([el('.a'), co(' '), el('.b')]);
    expect(wouldExtendChange(target, find, el('.z'), true)).toBe(true);
  });

  it('returns false for self-extend', () => {
    const target = sel([el('.a'), co(' '), el('.b')]);
    const find = sel([el('.a'), co(' '), el('.b')]);
    expect(wouldExtendChange(target, find, target, false)).toBe(false);
  });
});

// ─────────────────────────────────────────────────
// :is() AND branch — tail-aware position matching
// ─────────────────────────────────────────────────
describe('tail-aware :is() matching', () => {
  describe('walkAndExtend', () => {
    it('matches simple find against tail of :is(complex) in compound', () => {
      // .a:is(.x > .y).b — find .y should match the tail of :is(.x > .y)
      const target = compound([el('.a'), is(sel([el('.x'), co('>'), el('.y')])), el('.b')]);
      const find = el('.y');
      const result = walkAndExtend(target, find, el('.z'), true);
      // .y matched inside :is(.x > .y), extendWith added as alternative
      expect(result.valueOf()).not.toBe(target.valueOf());
      expect(result.valueOf()).toContain('.z');
    });

    it('does not match ancestral prefix of :is(complex)', () => {
      // .a:is(.x > .y).b — find .x should NOT match (it's in the prefix)
      const target = compound([el('.a'), is(sel([el('.x'), co('>'), el('.y')])), el('.b')]);
      const find = el('.x');
      const result = walkAndExtend(target, find, el('.z'), true);
      expect(result).toBe(target); // unchanged
    });

    it('matches compound find consuming tail of :is(complex)', () => {
      // .a:is(.x > .y).b — find .a.y should consume .a and tail of :is(.x > .y)
      const target = compound([el('.a'), is(sel([el('.x'), co('>'), el('.y')])), el('.b')]);
      const find = compound([el('.a'), el('.y')]);
      const result = walkAndExtend(target, find, el('.z'), true);
      expect(result.valueOf()).not.toBe(target.valueOf());
      expect(result.valueOf()).toContain('.z');
    });

    it('handles :is() with SelectorList — OR of tails', () => {
      // :is(.p > .q, .r).s — find .q should match tail of first alternative
      const target = compound([
        is(sellist([sel([el('.p'), co('>'), el('.q')]), el('.r')])),
        el('.s')
      ]);
      const find = el('.q');
      const result = walkAndExtend(target, find, el('.z'), true);
      expect(result.valueOf()).not.toBe(target.valueOf());
      expect(result.valueOf()).toContain('.z');
    });

    it('handles :is() with simple alternative (no tail extraction needed)', () => {
      // :is(.a, .b).c — find .a should still match directly
      const target = compound([is(sellist([el('.a'), el('.b')])), el('.c')]);
      const find = el('.a');
      const result = walkAndExtend(target, find, el('.z'), true);
      expect(result.valueOf()).toContain('.z');
    });
  });

  describe('wouldExtendChange', () => {
    it('returns true when find matches tail of :is(complex)', () => {
      const target = compound([el('.a'), is(sel([el('.x'), co('>'), el('.y')])), el('.b')]);
      expect(wouldExtendChange(target, el('.y'), el('.z'), true)).toBe(true);
    });

    it('returns false when find matches only prefix of :is(complex)', () => {
      const target = compound([el('.a'), is(sel([el('.x'), co('>'), el('.y')])), el('.b')]);
      expect(wouldExtendChange(target, el('.x'), el('.z'), true)).toBe(false);
    });
  });
});
