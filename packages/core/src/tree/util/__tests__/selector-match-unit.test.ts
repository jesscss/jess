/**
 * Unit tests for every exported function in selector-match-core.ts.
 *
 * These tests pin the CURRENT behaviour so we can safely replace
 * internals with a walk-and-consume algorithm. If any test breaks
 * after a refactor, the refactor changed observable semantics.
 */
import { describe, it, expect } from 'vitest';
import {
  el, sel, sellist, compound, is, co, pseudo, amp
} from '../../../index.js';
import { Context } from '../../../context.js';
import {
  selectorMatch
} from '../selector-match-core.js';

let context: Context;
beforeEach(() => {
  context = new Context();
});

describe('basic selectors', () => {
  it('matches identical simple selectors', () => {
    let sel1 = el('.a');
    let sel2 = el('.a');
    sel1.eval(context);
    sel2.eval(context);
    let result = selectorMatch(sel1, sel2);
    expect(result.fullMatch).toBe(true);
    expect(result.crossesAmpersand).toBe(false);
    expect(result.matches[0]!.consumedTarget).toBe(true);
  });

  it('rejects different simple selectors', async () => {
    let sel1 = el('.a');
    let sel2 = el('.b');
    sel1.eval(context);
    sel2.eval(context);
    expect(selectorMatch(sel1, sel2).fullMatch).toBe(false);
  });
});

describe('compound selectors', () => {
  it('matches identical compound selectors', async () => {
    let sel1 = compound([el('.a'), el('.b')]);
    let sel2 = compound([el('.a'), el('.b')]);
    await sel1.eval(context);
    await sel2.eval(context);
    expect(selectorMatch(sel1, sel2).fullMatch).toBe(true);
  });

  it('matches rearranged compound selectors', async () => {
    let sel1 = compound([el('.a'), el('.b')]);
    let sel2 = compound([el('.b'), el('.a')]);
    await sel1.eval(context);
    await sel2.eval(context);
    expect(selectorMatch(sel1, sel2).fullMatch).toBe(true);
  });

  it('returns a partial match when a compound has extra members inside the matched span', async () => {
    let sel1 = compound([el('.b'), el('.a'), pseudo({ name: ':hover' })]);
    let sel2 = compound([el('.b'), pseudo({ name: ':hover' })]);
    await sel1.eval(context);
    await sel2.eval(context);
    let result = selectorMatch(sel2, sel1);
    expect(result.fullMatch).toBe(false);
    expect(result.partialMatch).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.startIndex).toBe(0);
    expect(result.matches[0]!.endIndex).toBe(2);
    expect(result.matches[0]!.matchedIndices).toEqual([0, 2]);
    expect(result.matches[0]!.consumedTarget).toBe(false);
  });

  it('returns a partial match for .b:hover within .b.a:hover', async () => {
    let sel1 = compound([el('.b'), el('.a'), pseudo({ name: ':hover' })]);
    let sel2 = compound([el('.b'), pseudo({ name: ':hover' })]);
    await sel1.eval(context);
    await sel2.eval(context);
    let result = selectorMatch(sel2, sel1);
    expect(result.fullMatch).toBe(false);
    expect(result.partialMatch).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.startIndex).toBe(0);
    expect(result.matches[0]!.endIndex).toBe(2);
    expect(result.matches[0]!.matchedIndices).toEqual([0, 2]);
  });

  it('returns a partial match for .b.x within .b.a.x', async () => {
    let sel1 = compound([el('.b'), el('.a'), el('.x')]);
    let sel2 = compound([el('.b'), el('.x')]);
    await sel1.eval(context);
    await sel2.eval(context);
    let result = selectorMatch(sel2, sel1);
    expect(result.fullMatch).toBe(false);
    expect(result.partialMatch).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.startIndex).toBe(0);
    expect(result.matches[0]!.endIndex).toBe(2);
    expect(result.matches[0]!.matchedIndices).toEqual([0, 2]);
  });
});

describe('pseudo-selectors', () => {
  describe(':is()', () => {
    it('matches identical :is() pseudo-selectors', async () => {
      let sel1 = pseudo({ name: ':is', arg: el('.a') });
      let sel2 = pseudo({ name: ':is', arg: el('.a') });
      await sel1.eval(context);
      await sel2.eval(context);
      expect(selectorMatch(sel1, sel2).fullMatch).toBe(true);
    });

    it('normalizes simple selector in :is()', async () => {
      let sel1 = pseudo({ name: ':is', arg: el('.a') });
      let sel2 = el('.a');
      await sel1.eval(context);
      await sel2.eval(context);
      expect(selectorMatch(sel1, sel2).fullMatch).toBe(true);
    });

    it('normalizes compound selector in :is()', async () => {
      let sel1 = pseudo({ name: ':is', arg: compound([el('.a'), el('.b')]) });
      let sel2 = compound([el('.b'), el('.a')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(true);
    });

    it('matches a selector in :is()', async () => {
      let sel1 = sel([el('foo'), co('>'), pseudo({ name: ':is', arg: compound([el('.a'), el('.b')]) })]);
      let sel2 = compound([el('.b'), el('.a')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
    });

    it('matches an :is() as a full match #1', async () => {
      let sel1 = sel([el('foo'), co('>'), pseudo({ name: ':is', arg: compound([el('.a'), el('.b')]) })]);
      let sel2 = sel([el('foo'), co('>'), compound([el('.a'), is(el('.b'))])]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(true);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
    });

    it('matches an :is() as a full match #2', async () => {
      let sel1 = sel([el('foo'), co('>'), pseudo({ name: ':is', arg: sel([compound([el('.a'), el('.b')]), co('>'), el('.b')]) })]);
      let sel2 = sel([el('foo'), co('>'), pseudo({ name: ':is', arg: sel([compound([el('.b'), el('.a')]), co('>'), el('.b')]) })]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(true);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
    });

    it('matches an :is() as a full match #3', async () => {
      let sel1 = sel([el('foo'), co('>'), pseudo({ name: ':is', arg: sellist([sel([el('q'), co('>'), el('x')]), sel([compound([el('.a'), el('.b')]), co('>'), el('.b')])]) })]);
      let sel2 = sel([el('foo'), co('>'), pseudo({ name: ':is', arg: sel([compound([el('.b'), el('.a')]), co('>'), el('.b')]) })]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(true);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
    });

    it('matches an :is() as a full match #4', async () => {
      let sel1 = sel([el('foo'), co('>'), pseudo({ name: ':is', arg: sellist([sel([el('q'), co('>'), el('x')]), sel([compound([el('.a'), el('.b')]), co('>'), el('.b')])]) })]);
      let sel2 = sel([el('foo'), co('>'), pseudo({ name: ':is', arg: sel([el('q'), co('>'), el('x')]) })]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(true);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
    });

    it('matches through deeply nested :is() alternates', async () => {
      let sel1 = pseudo({
        name: ':is',
        arg: sellist([
          pseudo({ name: ':is', arg: sellist([el('.a'), el('.b')]) }),
          el('.c')
        ])
      });
      let sel2 = el('.b');
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(result.fullMatch).toBe(true);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
    });

    it('doesn\'t match branched :is() as full match #1', async () => {
      let sel1 = sel([el('.a'), co('>'), pseudo({ name: ':is', arg: sel([el('.b'), co('>'), el('.b')]) })]);
      let sel2 = sel([el('.a'), co('>'), el('.b')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(result.crossesAmpersand).toBe(false);
      expect(result.matches).toHaveLength(0);
    });

    it('doesn\'t match branched :is() as full match #2', async () => {
      let sel1 = sel([el('.a'), co('>'), pseudo({ name: ':is', arg: sel([el('.b'), co('>'), el('.c')]) })]);
      let sel2 = sel([el('.a'), co('>'), el('.b')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(false);
      expect(result.crossesAmpersand).toBe(false);
      expect(result.matches).toHaveLength(0);
    });

    it('doesn\'t match branched :is() as full match #3', async () => {
      let sel1 = sel([el('.a'), co('>'), pseudo({ name: ':is', arg: sel([el('.b'), co('>'), el('.c')]) })]);
      let sel2 = sel([el('.a'), co('>'), el('.b'), co('>'), el('.c')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(false);
      expect(result.crossesAmpersand).toBe(false);
      expect(result.matches).toHaveLength(0);
    });

    it('does match branched :is() as partial match #1', async () => {
      let sel1 = sel([el('.a'), co('>'), pseudo({ name: ':is', arg: sel([el('.b'), co('>'), el('.c')]) })]);
      let sel2 = sel([el('.a'), co('>'), el('.c')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
    });

    it('does match branched :is() as partial match #2', async () => {
      let sel1 = sel([el('.a'), co('>'), compound([el('.x'), pseudo({ name: ':is', arg: sel([el('.b'), co('>'), el('.c')]) })])]);
      let sel2 = sel([el('.a'), co('>'), compound([el('.c'), el('.x')])]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
    });

    it('does match branched :is() as partial match #3', async () => {
      let sel1 = sel([el('.a'), co('>'), compound([pseudo({ name: ':is', arg: sel([el('.b'), co('>'), el('.c')]) }), el('.x')])]);
      let sel2 = sel([el('.a'), co('>'), compound([el('.c'), el('.x')])]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
    });

    it('does match branched :is() as partial match #4', async () => {
      let sel1 = sel([el('.a'), co('>'), pseudo({ name: ':is', arg: sel([el('.b'), co('>'), el('.c')]) })]);
      let sel2 = sel([el('.b'), co('>'), el('.c')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
    });
  });

  describe('other pseudos', () => {
    it('returns a partial match when only the inner selector matches', async () => {
      let sel0 = compound([el('.a'), el('.b')]);
      let sel1 = pseudo({ name: ':where', arg: sel0 });
      let sel2 = compound([el('.b'), el('.a')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(result.matches[0]!.exact).toBe(false);
      expect(result.matches[0]!.containingNode).toBe(sel0);
    });

    it('does not continue a match across a nested pseudo boundary', async () => {
      let sel1 = compound([el('.a'), pseudo({ name: ':where', arg: el('.b') })]);
      let sel2 = compound([el('.a'), el('.b')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(false);
    });

    it('does not continue a match across a leading pseudo boundary', async () => {
      let sel1 = compound([pseudo({ name: ':where', arg: el('.a') }), el('.b')]);
      let sel2 = compound([el('.a'), el('.b')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(false);
    });

    it('does not match non-matching pseudo names', async () => {
      let sel1 = pseudo({ name: ':where', arg: el('.a') });
      let sel2 = pseudo({ name: ':not', arg: el('.a') });
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(false);
    });

    it('matches equivalent pseudo selectors', async () => {
      let sel1 = pseudo({ name: ':not', arg: compound([el('.a'), el('.b')]) });
      let sel2 = pseudo({ name: ':not', arg: compound([el('.b'), el('.a')]) });
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(true);
      expect(result.partialMatch).toBe(true);
    });

    it('matches equivalent pseudo selectors with selector-list alternates', async () => {
      let sel1 = pseudo({ name: ':not', arg: compound([el('.a'), is(sellist([el('.b'), el('.x')]))]) });
      let sel2 = pseudo({ name: ':not', arg: compound([el('.b'), el('.a')]) });
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(true);
      expect(result.partialMatch).toBe(true);
    });

    it('matches equivalent pseudo selectors with complex selector args', async () => {
      let sel1 = compound([
        pseudo({ name: ':where', arg: sel([el('.a'), co('>'), el('.b')]) }),
        el('.c')
      ]);
      let sel2 = compound([
        el('.c'),
        pseudo({ name: ':where', arg: sel([el('.a'), co('>'), el('.b')]) })
      ]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(true);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
    });

    it('matches equivalent mixed nested pseudo selectors', async () => {
      let sel1 = pseudo({
        name: ':not',
        arg: compound([
          pseudo({ name: ':is', arg: sellist([el('.a'), el('.c')]) }),
          el('.d')
        ])
      });
      let sel2 = pseudo({
        name: ':not',
        arg: compound([
          el('.d'),
          pseudo({ name: ':is', arg: sellist([el('.c'), el('.a')]) })
        ])
      });
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel1, sel2);
      expect(result.fullMatch).toBe(true);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
    });

    it('recursively searches through multiple nested pseudo boundaries', async () => {
      let sel1 = pseudo({
        name: ':not',
        arg: pseudo({
          name: ':where',
          arg: pseudo({
            name: ':is',
            arg: compound([el('.a'), el('.b')])
          })
        })
      });
      let sel2 = el('.a');
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches.every(match => !match.exact)).toBe(true);
    });
  });
});

describe('selector lists and branching', () => {
  describe('direct matches', () => {
    it('finds a selector in a selector list #1', async () => {
      let sel1 = sellist([el('.a'), el('.b')]);
      let sel2 = el('.b');
      await sel1.eval(context);
      await sel2.eval(context);
      expect(selectorMatch(sel2, sel1).fullMatch).toBe(true);
    });

    it('finds a selector in a selector list #2', async () => {
      let sel1 = sellist([el('.b'), el('.x'), el('.y')]);
      let sel2 = el('.b');
      await sel1.eval(context);
      await sel2.eval(context);
      expect(selectorMatch(sel2, sel1).fullMatch).toBe(true);
    });

    it('finds a compound selector in a selector list', async () => {
      let sel1 = sellist([compound([el('.b'), el('.x')]), el('.y')]);
      let sel2 = compound([el('.x'), el('.b')]);
      await sel1.eval(context);
      await sel2.eval(context);
      expect(selectorMatch(sel2, sel1).fullMatch).toBe(true);
    });

    it('matches a compound to a compound with an :is() in it', async () => {
      let sel1 = compound([el('.a'), is(sellist([el('.x'), el('.c')])), el('.d')]);
      let sel2 = compound([el('.d'), el('.a'), el('.c')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(result.fullMatch).toBe(true);
      expect(result.partialMatch).toBe(true);
    });

    it('reports a single selector-list item match against the list container', async () => {
      let sel1 = sellist([el('a'), el('b'), el('c')]);
      let sel2 = el('a');
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(result.fullMatch).toBe(true);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]!.containingNode).toBe(sel1);
      expect(result.matches[0]!.startIndex).toBe(0);
      expect(result.matches[0]!.endIndex).toBe(0);
      expect(result.matches[0]!.matchedIndices).toEqual([0]);
      expect(result.matches[0]!.consumedTarget).toBe(false);
    });

    it('reports a complex selector-list item match against the list container', async () => {
      let sel1 = sellist([sel([el('.a'), co('>'), el('.b')]), el('.c')]);
      let sel2 = sel([el('.a'), co('>'), el('.b')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(result.fullMatch).toBe(true);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]!.containingNode).toBe(sel1);
      expect(result.matches[0]!.startIndex).toBe(0);
      expect(result.matches[0]!.endIndex).toBe(0);
      expect(result.matches[0]!.matchedIndices).toEqual([0]);
      expect(result.matches[0]!.consumedTarget).toBe(false);
    });

    it('reports a pseudo-wrapped selector-list item match against the list container', async () => {
      let sel1 = sellist([pseudo({ name: ':where', arg: compound([el('.a'), el('.b')]) }), el('.c')]);
      let sel2 = compound([el('.b'), el('.a')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]!.containingNode).toBe(sel1);
      expect(result.matches[0]!.startIndex).toBe(0);
      expect(result.matches[0]!.endIndex).toBe(0);
      expect(result.matches[0]!.matchedIndices).toEqual([0]);
    });

    it('treats a find-side selector list as alternates', async () => {
      let sel1 = el('a');
      let sel2 = sellist([el('a'), el('b'), el('c')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(result.fullMatch).toBe(true);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]!.containingNode).toBe(sel1);
    });
  });

  describe('partial matches', () => {
    it('finds (partially) a compound selector in a selector list', async () => {
      let sel1 = sellist([sel([compound([el('.b'), el('.x')]), co('>'), el('.y')]), el('.z')]);
      let sel2 = compound([el('.x'), el('.b')]);
      await sel1.eval(context);
      await sel2.eval(context);
      expect(selectorMatch(sel2, sel1).fullMatch).toBe(false);
      expect(selectorMatch(sel2, sel1).partialMatch).toBe(true);
    });

    it('returns a partial match for partial match in a compound selector', async () => {
      let sel1 = compound([el('.a'), is(sellist([el('.x'), el('.c')])), el('.d')]);
      let sel2 = compound([el('.d'), el('.c')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
    });

    it('returns a partial match for partial match in a complex selector', async () => {
      let sel1 = sel([el('.a'), co('>'), el('.b'), co('>'), el('.c')]);
      let sel2 = sel([el('.a'), co('>'), el('.b')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
    });

    it('returns a partial match for partial compound match in a complex selector', async () => {
      let sel1 = sel([el('.a'), co('>'), compound([el('.b'), el('.x')]), co('>'), el('.c')]);
      let sel2 = sel([el('.a'), co('>'), el('.b')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
    });

    it('does not give up finding a match too soon', async () => {
      let sel1 = sel([el('.a'), co('>'), el('.c'), co('>'), el('.a'), co('>'), el('.b'), co('>'), el('.c')]);
      let sel2 = sel([el('.a'), co('>'), el('.c')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
    });
  });

  describe('misses', () => {
    it('does not find a match #1', async () => {
      let sel1 = sel([el('.a'), co('>'), compound([el('.b'), el('.x')]), co('>'), el('.c')]);
      let sel2 = sel([el('.a'), co('>'), el('.c')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(false);
    });

    it('does not find a match #2', async () => {
      let sel1 = sel([el('.a'), co('>'), compound([el('.b'), el('.x')]), co('>'), el('.c')]);
      let sel2 = sel([el('.q'), co('>'), el('.r')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(false);
    });

    it('does not find a match #3', async () => {
      let sel1 = sel([el('.a'), co('>'), el('.b'), co('>'), el('.c')]);
      let sel2 = sel([el('.a'), co('>'), el('.c')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(false);
    });
  });

  describe('multiple matches', () => {
    it('can find multiple matches #1', async () => {
      let sel1 = sel([el('.a'), co('>'), el('.c'), co('>'), el('.a'), co('>'), el('.c')]);
      let sel2 = sel([el('.a'), co('>'), el('.c')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      let fullMatches = result.matches.filter(match => match.exact);
      let partialMatches = result.matches.filter(match => !match.exact);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(fullMatches).toHaveLength(0);
      expect(partialMatches).toHaveLength(2);
      expect(partialMatches[0]!.startIndex).toBe(0);
      expect(partialMatches[0]!.endIndex).toBe(2);
      expect(partialMatches[0]!.containingNode).toBe(sel1);
      expect(partialMatches[1]!.startIndex).toBe(4);
      expect(partialMatches[1]!.endIndex).toBe(6);
      expect(partialMatches[1]!.containingNode).toBe(sel1);
    });

    it('can find multiple matches #2', async () => {
      let sel1 = compound([el('.a'), el('.b'), el('.c'), el('.a'), el('.b')]);
      let sel2 = compound([el('.a'), el('.b')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      let fullMatches = result.matches.filter(match => match.exact);
      let partialMatches = result.matches.filter(match => !match.exact);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(fullMatches).toHaveLength(0);
      expect(partialMatches).toHaveLength(2);
      expect(partialMatches[0]!.startIndex).toBe(0);
      expect(partialMatches[0]!.endIndex).toBe(1);
      expect(partialMatches[0]!.containingNode).toBe(sel1);
      expect(partialMatches[1]!.startIndex).toBe(3);
      expect(partialMatches[1]!.endIndex).toBe(4);
      expect(partialMatches[1]!.containingNode).toBe(sel1);
    });

    it('can find multiple matches #3', async () => {
      let sel1 = compound([el('.a'), el('.b'), el('.c'), el('.a'), el('.b')]);
      let sel2 = el('.a');
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      let fullMatches = result.matches.filter(match => match.exact);
      let partialMatches = result.matches.filter(match => !match.exact);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(fullMatches).toHaveLength(0);
      expect(partialMatches).toHaveLength(2);
      expect(partialMatches[0]!.startIndex).toBe(0);
      expect(partialMatches[0]!.endIndex).toBe(0);
      expect(partialMatches[0]!.containingNode).toBe(sel1);
      expect(partialMatches[1]!.startIndex).toBe(3);
      expect(partialMatches[1]!.endIndex).toBe(3);
      expect(partialMatches[1]!.containingNode).toBe(sel1);
    });

    it('can find multiple matches #4', async () => {
      let sel0 = compound([el('.a'), el('.b'), el('.c'), el('.a'), el('.b')]);
      let sel1 = sel([sel0, co('>'), el('.d')]);
      let sel2 = el('.a');
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      let fullMatches = result.matches.filter(match => match.exact);
      let partialMatches = result.matches.filter(match => !match.exact);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(fullMatches).toHaveLength(0);
      expect(partialMatches).toHaveLength(2);
      expect(partialMatches[0]!.startIndex).toBe(0);
      expect(partialMatches[0]!.endIndex).toBe(0);
      expect(partialMatches[0]!.containingNode).toBe(sel0);
      expect(partialMatches[1]!.startIndex).toBe(3);
      expect(partialMatches[1]!.endIndex).toBe(3);
      expect(partialMatches[1]!.containingNode).toBe(sel0);
    });

    it('can find multiple matches #5', async () => {
      let sel0 = compound([el('.a'), el('.b'), el('.c'), el('.a'), el('.b')]);
      let sel1 = sel([sel0, co('>'), el('.d')]);
      let sel2 = compound([el('.b'), el('.a')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      let fullMatches = result.matches.filter(match => match.exact);
      let partialMatches = result.matches.filter(match => !match.exact);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(fullMatches).toHaveLength(0);
      expect(partialMatches).toHaveLength(2);
      expect(partialMatches[0]!.startIndex).toBe(0);
      expect(partialMatches[0]!.endIndex).toBe(1);
      expect(partialMatches[0]!.containingNode).toBe(sel0);
      expect(partialMatches[1]!.startIndex).toBe(3);
      expect(partialMatches[1]!.endIndex).toBe(4);
      expect(partialMatches[1]!.containingNode).toBe(sel0);
    });
  });

  describe('miscellaneous', () => {
    it('can continue the search into an ampersand', async () => {
      let sel1 = compound([amp({ selectorContainer: { selector: el('a') } }), pseudo({ name: ':hover' })]);
      let sel2 = compound([el('a'), pseudo({ name: ':hover' })]);
      let evald1 = await sel1.eval(context);
      let evald2 = await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(`${evald1}`).toBe('&:hover');
      expect(`${evald2}`).toBe('a:hover');
      expect(result.fullMatch).toBe(true);
      expect(result.partialMatch).toBe(true);
      expect(result.crossesAmpersand).toBe(true);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]!.ampersandCrossings).toHaveLength(1);
      expect(result.matches[0]!.ampersandCrossings![0]!.ampersandNode).toBe(sel1.data[0]);
      expect(result.matches[0]!.ampersandCrossings![0]!.targetSegment.containingNode).toBe(sel1);
      expect(result.matches[0]!.ampersandCrossings![0]!.parentSegment!.containingNode.valueOf()).toBe('a');
    });

    it('matches near an ampersand but doesn\'t cross it #1', async () => {
      let inner = el('a').eval(context);
      let sel1 = compound([amp({ selectorContainer: { selector: inner } }), el('.b'), pseudo({ name: ':hover' })]);
      let sel2 = compound([el('.b'), pseudo({ name: ':hover' })]);
      let evald1 = await sel1.eval(context);
      let evald2 = await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(`${evald1}`).toBe('&.b:hover');
      expect(`${evald2}`).toBe('.b:hover');
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
      expect(result.crossesAmpersand).toBe(false);
    });

    it('matches near an ampersand but doesn\'t cross it #2', async () => {
      let inner = el('.c').eval(context);
      let sel1 = compound([el('.b'), pseudo({ name: ':hover' }), amp({ selectorContainer: { selector: inner } }), el('.b')]);
      let sel2 = compound([el('.b'), pseudo({ name: ':hover' })]);
      let evald1 = await sel1.eval(context);
      let evald2 = await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(`${evald1}`).toBe('.b:hover&.b');
      expect(`${evald2}`).toBe('.b:hover');
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(result.matches).toHaveLength(1);
      expect(result.crossesAmpersand).toBe(false);
      expect(result.matches[0]!.ampersandCrossings).toBeUndefined();
    });

    it('matches repeated ampersand compounds in one complex selector', async () => {
      let parentSelector = compound([el('.a'), el('.b')]).eval(context);
      let sel1 = sel([
        compound([amp({ selectorContainer: { selector: parentSelector } }), el('.x')]),
        co(' '),
        compound([amp({ selectorContainer: { selector: parentSelector } }), el('.x')])
      ]);
      let sel2 = compound([el('.b'), el('.x')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(result.crossesAmpersand).toBe(true);
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0]!.ampersandCrossings).toHaveLength(1);
      expect(result.matches[1]!.ampersandCrossings).toHaveLength(1);
    });

    it('matches one repeated ampersand compound against a fully resolved compound find', async () => {
      let parentSelector = compound([el('.a'), el('.b')]).eval(context);
      let sel1 = sel([
        compound([amp({ selectorContainer: { selector: parentSelector } }), el('.x')]),
        co(' '),
        compound([amp({ selectorContainer: { selector: parentSelector } }), el('.x')])
      ]);
      let sel2 = compound([el('.a'), el('.b'), el('.x')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1, parentSelector);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(result.crossesAmpersand).toBe(true);
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0]!.ampersandCrossings).toHaveLength(1);
      expect(result.matches[1]!.ampersandCrossings).toHaveLength(1);
    });

    it('matches repeated :is() compounds in one complex selector', async () => {
      let sel1 = sel([
        compound([is(compound([el('.a'), el('.b')])), el('.x')]),
        co(' '),
        compound([is(compound([el('.a'), el('.b')])), el('.x')])
      ]);
      let sel2 = compound([el('.b'), el('.x')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(result.crossesAmpersand).toBe(false);
      expect(result.matches).toHaveLength(2);
    });

    it('can continue through a non-leading ampersand with a complex resolved parent', async () => {
      let parentSelector = sel([el('.grand'), co('>'), el('.parent')]).eval(context);
      let sel1 = sel([
        amp({ selectorContainer: { selector: parentSelector } }),
        co(' '),
        el('.prefix'),
        co(' '),
        amp({ selectorContainer: { selector: parentSelector } }),
        co(' '),
        el('.child')
      ]);
      let sel2 = sel([el('.grand'), co('>'), el('.parent'), co(' '), el('.child')]);
      await sel1.eval(context);
      await sel2.eval(context);
      let result = selectorMatch(sel2, sel1, parentSelector);
      expect(result.fullMatch).toBe(false);
      expect(result.partialMatch).toBe(true);
      expect(result.crossesAmpersand).toBe(true);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]!.startIndex).toBe(4);
      expect(result.matches[0]!.endIndex).toBe(6);
      expect(result.matches[0]!.ampersandCrossings).toHaveLength(1);
      expect(result.matches[0]!.ampersandCrossings![0]!.ampersandNode).toBe(sel1.data[4]);
      expect(result.matches[0]!.ampersandCrossings![0]!.targetSegment.containingNode).toBe(sel1);
      expect(result.matches[0]!.ampersandCrossings![0]!.parentSegment!.containingNode).toBe(parentSelector);
    });

    describe('parent selector context', () => {
      it('uses the parent context for a plain target selector', async () => {
        let parent = sellist([el('div'), el('span')]);
        let sel1 = el('.a');
        let sel2 = sel([el('span'), co(' '), el('.a')]);
        await parent.eval(context);
        await sel1.eval(context);
        await sel2.eval(context);
        let result = selectorMatch(sel2, sel1, parent as any);
        expect(result.fullMatch).toBe(true);
        expect(result.partialMatch).toBe(true);
        expect(result.crossesAmpersand).toBe(true);
        expect(result.matches).toHaveLength(1);
        expect(result.matches[0]!.ampersandCrossings).toHaveLength(1);
        expect(result.matches[0]!.ampersandCrossings![0]!.targetSegment.containingNode).toBe(sel1);
        expect(result.matches[0]!.ampersandCrossings![0]!.parentSegment!.containingNode.valueOf()).toBe('span');
      });

      it('uses a parent selector list as alternates across a leading ampersand', async () => {
        let parent = sellist([el('div'), el('span')]);
        let sel1 = sel([amp(), co(' '), el('.a')]);
        let sel2 = sel([el('span'), co(' '), el('.a')]);
        await parent.eval(context);
        await sel1.eval(context);
        await sel2.eval(context);
        let result = selectorMatch(sel2, sel1, parent as any);
        expect(result.fullMatch).toBe(true);
        expect(result.partialMatch).toBe(true);
        expect(result.crossesAmpersand).toBe(true);
        expect(result.matches).toHaveLength(1);
      });

      it('does not search the parent when the target already fully matched before the leading ampersand', async () => {
        let parent = sellist([el('div'), el('span')]);
        let sel1 = sel([amp(), co(' '), el('.a')]);
        let sel2 = el('.a');
        await parent.eval(context);
        await sel1.eval(context);
        await sel2.eval(context);
        let result = selectorMatch(sel2, sel1, parent as any);
        expect(result.fullMatch).toBe(false);
        expect(result.partialMatch).toBe(true);
        expect(result.crossesAmpersand).toBe(false);
        expect(result.matches).toHaveLength(1);
      });

      it('does not search the parent when nothing matched before the leading ampersand', async () => {
        let parent = sellist([el('div'), el('span')]);
        let sel1 = sel([amp(), co(' '), el('.a')]);
        let sel2 = el('span');
        await parent.eval(context);
        await sel1.eval(context);
        await sel2.eval(context);
        let result = selectorMatch(sel2, sel1, parent as any);
        expect(result.fullMatch).toBe(false);
        expect(result.partialMatch).toBe(false);
        expect(result.crossesAmpersand).toBe(false);
        expect(result.matches).toHaveLength(0);
      });

      it('does not add matches that exist only inside an explicit ampersand selector', async () => {
        let inner = el('a').eval(context);
        let sel1 = compound([amp({ selectorContainer: { selector: inner } }), pseudo({ name: ':hover' })]);
        let sel2 = el('a');
        await sel1.eval(context);
        await sel2.eval(context);
        let result = selectorMatch(sel2, sel1);
        expect(result.fullMatch).toBe(false);
        expect(result.partialMatch).toBe(false);
        expect(result.crossesAmpersand).toBe(false);
        expect(result.matches).toHaveLength(0);
      });

      it('does not match an implicit space combinator #1', async () => {
        let parent = sellist([el('div'), el('span')]);
        let sel1 = el('.a');
        let sel2 = compound([el('span'), el('.a')]);
        await parent.eval(context);
        await sel1.eval(context);
        await sel2.eval(context);
        let result = selectorMatch(sel2, sel1, parent as any);
        expect(result.fullMatch).toBe(false);
        expect(result.partialMatch).toBe(false);
        expect(result.crossesAmpersand).toBe(false);
        expect(result.matches).toHaveLength(0);
      });

      it('does not match an implicit space combinator #2', async () => {
        let parent = el('a');
        let sel1 = el(':hover');
        let sel2 = compound([el('a'), el(':hover')]);
        await parent.eval(context);
        await sel1.eval(context);
        await sel2.eval(context);
        let result = selectorMatch(sel2, sel1, parent as any);
        expect(result.fullMatch).toBe(false);
        expect(result.partialMatch).toBe(false);
        expect(result.crossesAmpersand).toBe(false);
        expect(result.matches).toHaveLength(0);
      });

      it('does match an implicit space combinator #1', async () => {
        let parent = el('a');
        let sel1 = el(':hover');
        let sel2 = sel([el('a'), co(' '), el(':hover')]);
        await parent.eval(context);
        await sel1.eval(context);
        await sel2.eval(context);
        let result = selectorMatch(sel2, sel1, parent as any);
        expect(result.fullMatch).toBe(true);
        expect(result.partialMatch).toBe(true);
        expect(result.crossesAmpersand).toBe(true);
        expect(result.matches).toHaveLength(1);
      });

      it('does match an implicit space combinator #2', async () => {
        let parent = sellist([el('div'), el('span')]);
        let sel1 = el(':hover');
        let sel2 = sel([el('div'), co(' '), el(':hover')]);
        await parent.eval(context);
        await sel1.eval(context);
        await sel2.eval(context);
        let result = selectorMatch(sel2, sel1, parent as any);
        expect(result.fullMatch).toBe(true);
        expect(result.partialMatch).toBe(true);
        expect(result.crossesAmpersand).toBe(true);
        expect(result.matches).toHaveLength(1);
      });

      it('does full-match a local nested selector against a simple parent context', async () => {
        const parent = el('.aa');
        const target = el('.dd');
        const find = el('.dd');
        await parent.eval(context);
        await target.eval(context);
        await find.eval(context);
        const result = selectorMatch(find, target, parent as any);
        expect(result.fullMatch).toBe(true);
        expect(result.partialMatch).toBe(true);
        expect(result.crossesAmpersand).toBe(false);
      });

      it('does full-match a nested selector across a parent selector list for an exact route', async () => {
        const parent = sellist([
          compound([el('.replace'), el('.replace')]),
          sel([compound([el('.c'), el('.replace')]), co('+'), el('.replace')])
        ]);
        const target = sellist([el('.replace'), el('.c')]);
        const find = sel([compound([el('.replace'), el('.replace')]), co(' '), el('.replace')]);
        await parent.eval(context);
        await target.eval(context);
        await find.eval(context);
        const result = selectorMatch(find, target, parent as any);
        expect(result.fullMatch).toBe(true);
        expect(result.partialMatch).toBe(true);
        expect(result.crossesAmpersand).toBe(true);
      });

      it('does full-match a repeated implicit ampersand compound against a simple parent', async () => {
        const parent = el('.e');
        const target = compound([amp(), amp()]);
        const find = compound([el('.e'), el('.e')]);
        await parent.eval(context);
        await target.eval(context);
        await find.eval(context);
        const result = selectorMatch(find, target, parent as any);
        expect(result.fullMatch).toBe(true);
        expect(result.partialMatch).toBe(true);
        expect(result.crossesAmpersand).toBe(true);
      });

      it('does not continue parent matching through a non-:is() pseudo boundary', async () => {
        let parent = el('div');
        let sel1 = sel([amp(), co(' '), pseudo({ name: ':where', arg: el('.a') })]);
        let sel2 = sel([el('div'), co(' '), el('.a')]);
        await parent.eval(context);
        await sel1.eval(context);
        await sel2.eval(context);
        let result = selectorMatch(sel2, sel1, parent as any);
        expect(result.fullMatch).toBe(false);
        expect(result.partialMatch).toBe(false);
        expect(result.crossesAmpersand).toBe(false);
        expect(result.matches).toHaveLength(0);
      });

      it('does continue parent matching through an :is() boundary', async () => {
        let parent = el('div');
        let sel1 = sel([amp(), co(' '), pseudo({ name: ':is', arg: el('.a') })]);
        let sel2 = sel([el('div'), co(' '), el('.a')]);
        await parent.eval(context);
        await sel1.eval(context);
        await sel2.eval(context);
        let result = selectorMatch(sel2, sel1, parent as any);
        expect(result.fullMatch).toBe(true);
        expect(result.partialMatch).toBe(true);
        expect(result.crossesAmpersand).toBe(true);
        expect(result.matches).toHaveLength(1);
      });
    });
  });
});

// // ─────────────────────────────────────────────────
// // arePseudoSelectorsEquivalent
// // ─────────────────────────────────────────────────
// describe('arePseudoSelectorsEquivalent', () => {
//   it('returns false for non-pseudo-selectors', () => {
//     expect(arePseudoSelectorsEquivalent(el('.a'), el('.a'))).toBe(false);
//   });

//   it('matches pseudo-selectors with same name and no args', () => {
//     const a = pseudo({ name: ':hover' });
//     const b = pseudo({ name: ':hover' });
//     expect(arePseudoSelectorsEquivalent(a, b)).toBe(true);
//   });

//   it('rejects pseudo-selectors with different names', () => {
//     const a = pseudo({ name: ':hover' });
//     const b = pseudo({ name: ':focus' });
//     expect(arePseudoSelectorsEquivalent(a, b)).toBe(false);
//   });

//   it('matches :where() with same args', () => {
//     const a = pseudo({ name: ':where', arg: el('.x') });
//     const b = pseudo({ name: ':where', arg: el('.x') });
//     expect(arePseudoSelectorsEquivalent(a, b)).toBe(true);
//   });

//   it('rejects when one has arg and other does not', () => {
//     const a = pseudo({ name: ':where', arg: el('.x') });
//     const b = pseudo({ name: ':where' });
//     expect(arePseudoSelectorsEquivalent(a, b)).toBe(false);
//   });

//   it('matches :not() with equivalent compound args in any order', () => {
//     const a = pseudo({ name: ':not', arg: compound([el('.x'), el('.y')]) });
//     const b = pseudo({ name: ':not', arg: compound([el('.y'), el('.x')]) });
//     expect(arePseudoSelectorsEquivalent(a, b)).toBe(true);
//   });
// });

// // ─────────────────────────────────────────────────
// // areSelectorArgumentsEquivalent
// // ─────────────────────────────────────────────────
// describe('areSelectorArgumentsEquivalent', () => {
//   it('matches identical simple selectors', () => {
//     expect(areSelectorArgumentsEquivalent(el('.a'), el('.a'))).toBe(true);
//   });

//   it('matches selector lists in any order', () => {
//     const a = sellist([el('.x'), el('.y')]) as unknown as Selector;
//     const b = sellist([el('.y'), el('.x')]) as unknown as Selector;
//     expect(areSelectorArgumentsEquivalent(a, b)).toBe(true);
//   });

//   it('rejects selector lists of different length', () => {
//     const a = sellist([el('.x'), el('.y')]) as unknown as Selector;
//     const b = sellist([el('.x')]) as unknown as Selector;
//     expect(areSelectorArgumentsEquivalent(a, b)).toBe(false);
//   });

//   it('matches compound selectors', () => {
//     const a = compound([el('.a'), el('.b')]);
//     const b = compound([el('.b'), el('.a')]);
//     expect(areSelectorArgumentsEquivalent(a, b)).toBe(true);
//   });
// });

// // ─────────────────────────────────────────────────
// // areCompoundSelectorsEquivalent
// // ─────────────────────────────────────────────────
// describe('areCompoundSelectorsEquivalent', () => {
//   it('matches identical compounds', () => {
//     const a = compound([el('.a'), el('.b')]);
//     const b = compound([el('.a'), el('.b')]);
//     expect(areCompoundSelectorsEquivalent(a, b)).toBe(true);
//   });

//   it('matches compounds in different order', () => {
//     const a = compound([el('.a'), el('.b')]);
//     const b = compound([el('.b'), el('.a')]);
//     expect(areCompoundSelectorsEquivalent(a, b)).toBe(true);
//   });

//   it('rejects compounds of different length', () => {
//     const a = compound([el('.a'), el('.b')]);
//     const b = compound([el('.a')]);
//     expect(areCompoundSelectorsEquivalent(a, b)).toBe(false);
//   });

//   it('matches compounds with :is() components via compoundComponentMatches', () => {
//     // :is(.a).b should match .a.b
//     const a = compound([is(sellist([el('.a')])), el('.b')]);
//     const b = compound([el('.a'), el('.b')]);
//     expect(areCompoundSelectorsEquivalent(a, b)).toBe(true);
//   });
// });

// // ─────────────────────────────────────────────────
// // expandCompoundWithPseudoSelectors
// // ─────────────────────────────────────────────────
// describe('expandCompoundWithPseudoSelectors', () => {
//   it('returns original for compound without :is()', () => {
//     const c = compound([el('.a'), el('.b')]);
//     const result = expandCompoundWithPseudoSelectors(c);
//     expect(result).toHaveLength(1);
//   });

//   it('expands compound with one :is(2 alts) into 3 compounds', () => {
//     // .a:is(.x,.y) → [.a:is(.x,.y), .a.x, .a.y]
//     const c = compound([el('.a'), is(sellist([el('.x'), el('.y')]))]);
//     const result = expandCompoundWithPseudoSelectors(c);
//     // Original + 2 expanded = at least 3
//     expect(result.length).toBeGreaterThanOrEqual(3);
//   });

//   it('expansion is combinatorial for multiple :is()', () => {
//     // .a:is(.x,.y):is(.p,.q) → (1+2)*(1+2) = 9
//     const c = compound([
//       el('.a'),
//       is(sellist([el('.x'), el('.y')])),
//       is(sellist([el('.p'), el('.q')]))
//     ]);
//     const result = expandCompoundWithPseudoSelectors(c);
//     expect(result.length).toBe(9);
//   });
// });

// // ─────────────────────────────────────────────────
// // expandComplexSelectorWithIs
// // ─────────────────────────────────────────────────
// describe('expandComplexSelectorWithIs', () => {
//   it('returns original for complex without :is()', () => {
//     const s = sel([el('.a'), co('>'), el('.b')]) as ComplexSelector;
//     const result = expandComplexSelectorWithIs(s);
//     expect(result).toHaveLength(1);
//   });

//   it('expands :is(.x,.y) .a into [.x .a, .y .a]', () => {
//     const s = sel([is(sellist([el('.x'), el('.y')])), co(' '), el('.a')]) as ComplexSelector;
//     const result = expandComplexSelectorWithIs(s);
//     expect(result).toHaveLength(2);
//     const values = result.map(r => r.valueOf());
//     expect(values).toContain('.x .a');
//     expect(values).toContain('.y .a');
//   });
// });

// // ─────────────────────────────────────────────────
// // expandSelectorWithIs
// // ─────────────────────────────────────────────────
// describe('expandSelectorWithIs', () => {
//   it('passes through simple selectors unchanged', () => {
//     const s = el('.a');
//     expect(expandSelectorWithIs(s)).toHaveLength(1);
//   });

//   it('delegates to expandComplexSelectorWithIs for complex selectors', () => {
//     const s = sel([is(sellist([el('.x'), el('.y')])), co(' '), el('.a')]) as ComplexSelector;
//     const result = expandSelectorWithIs(s as any);
//     expect(result).toHaveLength(2);
//   });

//   it('delegates to expandCompoundWithPseudoSelectors for compound selectors', () => {
//     const c = compound([el('.a'), is(sellist([el('.x'), el('.y')]))]);
//     const result = expandSelectorWithIs(c);
//     expect(result.length).toBeGreaterThanOrEqual(3);
//   });
// });

// // ─────────────────────────────────────────────────
// // areComplexSelectorsEquivalent
// // ─────────────────────────────────────────────────
// describe('areComplexSelectorsEquivalent', () => {
//   it('matches identical complex selectors', () => {
//     const a = sel([el('.a'), co('>'), el('.b')]) as ComplexSelector;
//     const b = sel([el('.a'), co('>'), el('.b')]) as ComplexSelector;
//     expect(areComplexSelectorsEquivalent(a, b)).toBe(true);
//   });

//   it('rejects complex selectors of different length', () => {
//     const a = sel([el('.a'), co('>'), el('.b')]) as ComplexSelector;
//     const b = sel([el('.a')]) as ComplexSelector;
//     expect(areComplexSelectorsEquivalent(a, b)).toBe(false);
//   });

//   it('rejects complex selectors with different combinators', () => {
//     const a = sel([el('.a'), co('>'), el('.b')]) as ComplexSelector;
//     const b = sel([el('.a'), co('+'), el('.b')]) as ComplexSelector;
//     expect(areComplexSelectorsEquivalent(a, b)).toBe(false);
//   });

//   it('matches complex selectors with compound components in any order', () => {
//     const a = sel([compound([el('.x'), el('.y')]), co('>'), el('.b')]) as ComplexSelector;
//     const b = sel([compound([el('.y'), el('.x')]), co('>'), el('.b')]) as ComplexSelector;
//     expect(areComplexSelectorsEquivalent(a, b)).toBe(true);
//   });

//   it('matches when one component is :is(.a) and other is .a', () => {
//     const a = sel([is(el('.a')), co(' '), el('.b')]) as ComplexSelector;
//     const b = sel([el('.a'), co(' '), el('.b')]) as ComplexSelector;
//     expect(areComplexSelectorsEquivalent(a, b)).toBe(true);
//   });

//   it('matches :is(.a,.b) against .a (picks one alternative)', () => {
//     const a = sel([is(sellist([el('.a'), el('.b')])), co(' '), el('.c')]) as ComplexSelector;
//     const b = sel([el('.a'), co(' '), el('.c')]) as ComplexSelector;
//     expect(areComplexSelectorsEquivalent(a, b)).toBe(true);
//   });

//   it('rejects :is(.a,.b) against .c (no alternative matches)', () => {
//     const a = sel([is(sellist([el('.a'), el('.b')])), co(' '), el('.c')]) as ComplexSelector;
//     const b = sel([el('.c'), co(' '), el('.c')]) as ComplexSelector;
//     expect(areComplexSelectorsEquivalent(a, b)).toBe(false);
//   });
// });

// // ─────────────────────────────────────────────────
// // isStructurallyEqual
// // ─────────────────────────────────────────────────
// describe('isStructurallyEqual', () => {
//   it('matches identical simple selectors', () => {
//     expect(isStructurallyEqual(el('.a'), el('.a'))).toBe(true);
//   });

//   it('rejects different simple selectors', () => {
//     expect(isStructurallyEqual(el('.a'), el('.b'))).toBe(false);
//   });

//   it('matches equivalent pseudo-selectors', () => {
//     const a = pseudo({ name: ':hover' });
//     const b = pseudo({ name: ':hover' });
//     expect(isStructurallyEqual(a, b)).toBe(true);
//   });

//   it('rejects pseudo-selectors with different names', () => {
//     const a = pseudo({ name: ':hover' });
//     const b = pseudo({ name: ':focus' });
//     expect(isStructurallyEqual(a, b)).toBe(false);
//   });

//   it('matches complex selectors component-by-component', () => {
//     const a = sel([el('.a'), co('>'), el('.b')]);
//     const b = sel([el('.a'), co('>'), el('.b')]);
//     expect(isStructurallyEqual(a as any, b as any)).toBe(true);
//   });

//   it('rejects complex selectors with different components', () => {
//     const a = sel([el('.a'), co('>'), el('.b')]);
//     const b = sel([el('.a'), co('>'), el('.c')]);
//     expect(isStructurallyEqual(a as any, b as any)).toBe(false);
//   });

//   it('matches compound selectors with same components in same order', () => {
//     const a = compound([el('.x'), el('.y')]);
//     const b = compound([el('.x'), el('.y')]);
//     expect(isStructurallyEqual(a, b)).toBe(true);
//   });
// });

// // ─────────────────────────────────────────────────
// // selectorMatchesExtendTarget
// // ─────────────────────────────────────────────────
// describe('selectorMatchesExtendTarget', () => {
//   it('matches identical simple selectors (non-partial)', () => {
//     expect(selectorMatchesExtendTarget(el('.a'), el('.a'), false)).toBe(true);
//   });

//   it('rejects different simple selectors (non-partial)', () => {
//     expect(selectorMatchesExtendTarget(el('.a'), el('.b'), false)).toBe(false);
//   });

//   it('matches when target is inside a SelectorList (non-partial)', () => {
//     const target = sellist([el('.a'), el('.b')]) as unknown as Selector;
//     expect(selectorMatchesExtendTarget(target, el('.a'), false)).toBe(true);
//   });

//   it('matches complex selectors (non-partial)', () => {
//     const a = sel([el('.a'), co('>'), el('.b')]);
//     const b = sel([el('.a'), co('>'), el('.b')]);
//     expect(selectorMatchesExtendTarget(a as any, b as any, false)).toBe(true);
//   });

//   it('rejects when find is not in target (non-partial)', () => {
//     const target = sellist([el('.a'), el('.b')]) as unknown as Selector;
//     expect(selectorMatchesExtendTarget(target, el('.c'), false)).toBe(false);
//   });
// });

// // ─────────────────────────────────────────────────
// // normalizeSelectorForExtend
// // ─────────────────────────────────────────────────
// describe('normalizeSelectorForExtend', () => {
//   it('passes through simple selectors unchanged', () => {
//     const s = el('.a');
//     const result = normalizeSelectorForExtend(s);
//     expect(result.valueOf()).toBe('.a');
//   });

//   it('normalizes selector for extend matching', () => {
//     // Basic sanity — should not crash and should return a selector
//     const s = sel([el('.a'), co(' '), el('.b')]);
//     const result = normalizeSelectorForExtend(s as any);
//     expect(result).toBeTruthy();
//     expect(typeof result.valueOf()).toBe('string');
//   });
// });

// // ─────────────────────────────────────────────────
// // selectorCompare — additional edge cases
// // ─────────────────────────────────────────────────
// describe('selectorCompare edge cases', () => {
//   it('reports whole match for identical simple selectors', () => {
//     const result = selectorCompare(el('.a'), el('.a'));
//     expect(result.isEquivalent).toBe(true);
//     expect(result.hasWholeMatch).toBe(true);
//   });

//   it('reports no match for different simple selectors', () => {
//     const result = selectorCompare(el('.a'), el('.b'));
//     expect(result.isEquivalent).toBe(false);
//     expect(result.hasWholeMatch).toBe(false);
//   });

//   it('reports match for SelectorList containing the find', () => {
//     const target = sellist([el('.a'), el('.b')]) as unknown as Selector;
//     const result = selectorCompare(target, el('.a'));
//     // selectorCompare uses findExtendableLocations which detects presence
//     expect(result.hasWholeMatch || result.hasPartialMatch).toBe(true);
//   });

//   it('uses Set-based O(N) comparison for two SelectorLists', () => {
//     const a = sellist([el('.x'), el('.y'), el('.z')]) as unknown as Selector;
//     const b = sellist([el('.z'), el('.x'), el('.y')]) as unknown as Selector;
//     const result = selectorCompare(a, b);
//     expect(result.isEquivalent).toBe(true);
//   });

//   it('rejects SelectorLists with different items', () => {
//     const a = sellist([el('.x'), el('.y')]) as unknown as Selector;
//     const b = sellist([el('.x'), el('.z')]) as unknown as Selector;
//     const result = selectorCompare(a, b);
//     expect(result.isEquivalent).toBe(false);
//   });
// });

// // ─────────────────────────────────────────────────
// // findExtendableLocations — additional unit tests
// // ─────────────────────────────────────────────────
// describe('findExtendableLocations unit tests', () => {
//   it('finds simple selector in SelectorList', () => {
//     const target = sellist([el('.a'), el('.b'), el('.c')]) as unknown as Selector;
//     const result = findExtendableLocations(target, el('.b'));
//     expect(result.hasMatches).toBe(true);
//   });

//   it('returns no match when target does not contain find', () => {
//     const target = sellist([el('.a'), el('.b')]) as unknown as Selector;
//     const result = findExtendableLocations(target, el('.z'));
//     expect(result.hasMatches).toBe(false);
//   });

//   it('finds selector inside :is() argument', () => {
//     const target = is(sellist([el('.a'), el('.b')]));
//     const result = findExtendableLocations(target, el('.a'));
//     expect(result.hasMatches).toBe(true);
//   });

//   it('finds compound subsequence as partial match', () => {
//     // .a.b.c target, .a.c find → partial match
//     const target = compound([el('.a'), el('.b'), el('.c')]);
//     const result = findExtendableLocations(target, compound([el('.a'), el('.c')]));
//     expect(result.hasMatches).toBe(true);
//   });

//   it('caches results for identical selector+find pairs', () => {
//     const target = el('.cached');
//     const find = el('.cached');
//     const r1 = findExtendableLocations(target, find);
//     const r2 = findExtendableLocations(target, find);
//     // Should return the same cached object
//     expect(r1).toBe(r2);
//   });
// });
