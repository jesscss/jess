/**
 * Unit tests for every exported function in selector-match-core.ts.
 *
 * These tests pin the CURRENT behaviour so we can safely replace
 * internals with a walk-and-consume algorithm. If any test breaks
 * after a refactor, the refactor changed observable semantics.
 */
import { describe, it, expect } from 'vitest';
import {
  el, sel, sellist, compound, is, co, pseudo
} from '../../../index.js';
import type { Selector, ComplexSelector } from '../../../index.js';
import {
  componentsMatch,
  compoundComponentMatches,
  arePseudoSelectorsEquivalent,
  areSelectorArgumentsEquivalent,
  areCompoundSelectorsEquivalent,
  expandCompoundWithPseudoSelectors,
  expandComplexSelectorWithIs,
  expandSelectorWithIs,
  areComplexSelectorsEquivalent,
  isStructurallyEqual,
  findExtendableLocations,
  selectorMatchesExtendTarget,
  normalizeSelectorForExtend,
  selectorCompare
} from '../selector-match-core.js';

// ─────────────────────────────────────────────────
// componentsMatch
// ─────────────────────────────────────────────────
describe('componentsMatch', () => {
  it('matches identical simple value', () => {
    expect(componentsMatch(el('.a'), el('.a'))).toBe(true);
  });

  it('rejects different simple value', () => {
    expect(componentsMatch(el('.a'), el('.b'))).toBe(false);
  });

  it('matches compound value in any order', () => {
    const a = compound([el('.x'), el('.y')]);
    const b = compound([el('.y'), el('.x')]);
    expect(componentsMatch(a, b)).toBe(true);
  });

  it('rejects compound value with different value', () => {
    const a = compound([el('.x'), el('.y')]);
    const b = compound([el('.x'), el('.z')]);
    expect(componentsMatch(a, b)).toBe(false);
  });

  it('matches compound vs simple when compound contains simple', () => {
    const a = compound([el('.x'), el('.y')]);
    const b = el('.x');
    expect(componentsMatch(a, b)).toBe(true);
  });

  it('matches simple vs compound when compound contains simple', () => {
    const a = el('.y');
    const b = compound([el('.x'), el('.y')]);
    expect(componentsMatch(a, b)).toBe(true);
  });

  it('matches string-backed compound components against simple selectors', () => {
    expect(componentsMatch(compound(['.x', '.y']), el('.x'))).toBe(true);
    expect(componentsMatch(el('.y'), compound(['.x', '.y']))).toBe(true);
  });

  it('rejects compound vs simple when compound does not contain simple', () => {
    const a = compound([el('.x'), el('.y')]);
    const b = el('.z');
    expect(componentsMatch(a, b)).toBe(false);
  });

  it('matches equivalent pseudo-value', () => {
    const a = pseudo({ name: ':where', arg: el('.a') });
    const b = pseudo({ name: ':where', arg: el('.a') });
    expect(componentsMatch(a, b)).toBe(true);
  });

  it('rejects pseudo-value with different names', () => {
    const a = pseudo({ name: ':where', arg: el('.a') });
    const b = pseudo({ name: ':not', arg: el('.a') });
    expect(componentsMatch(a, b)).toBe(false);
  });
});

// ─────────────────────────────────────────────────
// compoundComponentMatches
// ─────────────────────────────────────────────────
describe('compoundComponentMatches', () => {
  it('matches identical simple value', () => {
    expect(compoundComponentMatches(el('.a'), el('.a'))).toBe(true);
  });

  it('rejects different simple value', () => {
    expect(compoundComponentMatches(el('.a'), el('.b'))).toBe(false);
  });

  it('matches string-backed simple selector components without materializing leaves', () => {
    expect(compoundComponentMatches('.a', el('.a'))).toBe(true);
    expect(compoundComponentMatches(el('.a'), '.a')).toBe(true);
    expect(compoundComponentMatches('.a', '.b')).toBe(false);
  });

  it('matches when find is :is() containing target', () => {
    // :is(.a, .b) should match .a
    const find = is(sellist([el('.a'), el('.b')]));
    const target = el('.a');
    expect(compoundComponentMatches(find, target)).toBe(true);
  });

  it('rejects when find is :is() NOT containing target', () => {
    const find = is(sellist([el('.a'), el('.b')]));
    const target = el('.c');
    expect(compoundComponentMatches(find, target)).toBe(false);
  });

  it('matches when target is :is() containing find', () => {
    // .a should match :is(.a, .b) position
    const find = el('.a');
    const target = is(sellist([el('.a'), el('.b')]));
    expect(compoundComponentMatches(find, target)).toBe(true);
  });

  it('rejects when target is :is() NOT containing find', () => {
    const find = el('.c');
    const target = is(sellist([el('.a'), el('.b')]));
    expect(compoundComponentMatches(find, target)).toBe(false);
  });

  it('matches nested :is() — find is :is(:is(.a))', () => {
    const innerIs = is(el('.a'));
    const outerIs = is(innerIs);
    expect(compoundComponentMatches(outerIs, el('.a'))).toBe(true);
  });

  it('handles :is() with single arg (no SelectorList)', () => {
    const find = is(el('.x'));
    expect(compoundComponentMatches(find, el('.x'))).toBe(true);
    expect(compoundComponentMatches(find, el('.y'))).toBe(false);
  });

  it('matches non-:is() pseudo-value with equivalent args', () => {
    const find = pseudo({ name: ':where', arg: el('.a') });
    const target = pseudo({ name: ':where', arg: el('.a') });
    expect(compoundComponentMatches(find, target)).toBe(true);
  });
});

// ─────────────────────────────────────────────────
// arePseudoSelectorsEquivalent
// ─────────────────────────────────────────────────
describe('arePseudoSelectorsEquivalent', () => {
  it('returns false for non-pseudo-value', () => {
    expect(arePseudoSelectorsEquivalent(el('.a'), el('.a'))).toBe(false);
  });

  it('matches pseudo-value with same name and no args', () => {
    const a = pseudo({ name: ':hover' });
    const b = pseudo({ name: ':hover' });
    expect(arePseudoSelectorsEquivalent(a, b)).toBe(true);
  });

  it('rejects pseudo-value with different names', () => {
    const a = pseudo({ name: ':hover' });
    const b = pseudo({ name: ':focus' });
    expect(arePseudoSelectorsEquivalent(a, b)).toBe(false);
  });

  it('matches :where() with same args', () => {
    const a = pseudo({ name: ':where', arg: el('.x') });
    const b = pseudo({ name: ':where', arg: el('.x') });
    expect(arePseudoSelectorsEquivalent(a, b)).toBe(true);
  });

  it('rejects when one has arg and other does not', () => {
    const a = pseudo({ name: ':where', arg: el('.x') });
    const b = pseudo({ name: ':where' });
    expect(arePseudoSelectorsEquivalent(a, b)).toBe(false);
  });

  it('matches :not() with equivalent compound args in any order', () => {
    const a = pseudo({ name: ':not', arg: compound([el('.x'), el('.y')]) });
    const b = pseudo({ name: ':not', arg: compound([el('.y'), el('.x')]) });
    expect(arePseudoSelectorsEquivalent(a, b)).toBe(true);
  });
});

// ─────────────────────────────────────────────────
// areSelectorArgumentsEquivalent
// ─────────────────────────────────────────────────
describe('areSelectorArgumentsEquivalent', () => {
  it('matches identical simple value', () => {
    expect(areSelectorArgumentsEquivalent(el('.a'), el('.a'))).toBe(true);
  });

  it('matches selector lists in any order', () => {
    const a: Selector = sellist([el('.x'), el('.y')]);
    const b: Selector = sellist([el('.y'), el('.x')]);
    expect(areSelectorArgumentsEquivalent(a, b)).toBe(true);
  });

  it('rejects selector lists of different length', () => {
    const a: Selector = sellist([el('.x'), el('.y')]);
    const b: Selector = sellist([el('.x')]);
    expect(areSelectorArgumentsEquivalent(a, b)).toBe(false);
  });

  it('matches compound value', () => {
    const a = compound([el('.a'), el('.b')]);
    const b = compound([el('.b'), el('.a')]);
    expect(areSelectorArgumentsEquivalent(a, b)).toBe(true);
  });
});

// ─────────────────────────────────────────────────
// areCompoundSelectorsEquivalent
// ─────────────────────────────────────────────────
describe('areCompoundSelectorsEquivalent', () => {
  it('matches identical compounds', () => {
    const a = compound([el('.a'), el('.b')]);
    const b = compound([el('.a'), el('.b')]);
    expect(areCompoundSelectorsEquivalent(a, b)).toBe(true);
  });

  it('matches compounds in different order', () => {
    const a = compound([el('.a'), el('.b')]);
    const b = compound([el('.b'), el('.a')]);
    expect(areCompoundSelectorsEquivalent(a, b)).toBe(true);
  });

  it('matches string-backed compounds against node-backed compounds', () => {
    expect(areCompoundSelectorsEquivalent(
      compound(['.a', '.b']),
      compound([el('.b'), el('.a')])
    )).toBe(true);
  });

  it('rejects compounds of different length', () => {
    const a = compound([el('.a'), el('.b')]);
    const b = compound([el('.a')]);
    expect(areCompoundSelectorsEquivalent(a, b)).toBe(false);
  });

  it('matches compounds with :is() value via compoundComponentMatches', () => {
    // :is(.a).b should match .a.b
    const a = compound([is(sellist([el('.a')])), el('.b')]);
    const b = compound([el('.a'), el('.b')]);
    expect(areCompoundSelectorsEquivalent(a, b)).toBe(true);
  });
});

// ─────────────────────────────────────────────────
// expandCompoundWithPseudoSelectors
// ─────────────────────────────────────────────────
describe('expandCompoundWithPseudoSelectors', () => {
  it('returns original for compound without :is()', () => {
    const c = compound([el('.a'), el('.b')]);
    const result = expandCompoundWithPseudoSelectors(c);
    expect(result).toHaveLength(1);
  });

  it('expands compound with one :is(2 alts) into 3 compounds', () => {
    // .a:is(.x,.y) → [.a:is(.x,.y), .a.x, .a.y]
    const c = compound([el('.a'), is(sellist([el('.x'), el('.y')]))]);
    const result = expandCompoundWithPseudoSelectors(c);
    // Original + 2 expanded = at least 3
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it('expansion is combinatorial for multiple :is()', () => {
    // .a:is(.x,.y):is(.p,.q) → (1+2)*(1+2) = 9
    const c = compound([
      el('.a'),
      is(sellist([el('.x'), el('.y')])),
      is(sellist([el('.p'), el('.q')]))
    ]);
    const result = expandCompoundWithPseudoSelectors(c);
    expect(result.length).toBe(9);
  });
});

// ─────────────────────────────────────────────────
// expandComplexSelectorWithIs
// ─────────────────────────────────────────────────
describe('expandComplexSelectorWithIs', () => {
  it('returns original for complex without :is()', () => {
    const s = sel([el('.a'), co('>'), el('.b')]) as ComplexSelector;
    const result = expandComplexSelectorWithIs(s);
    expect(result).toHaveLength(1);
  });

  it('expands :is(.x,.y) .a into [.x .a, .y .a]', () => {
    const s = sel([is(sellist([el('.x'), el('.y')])), co(' '), el('.a')]) as ComplexSelector;
    const result = expandComplexSelectorWithIs(s);
    expect(result).toHaveLength(2);
    const values = result.map(r => r.valueOf());
    expect(values).toContain('.x .a');
    expect(values).toContain('.y .a');
  });
});

// ─────────────────────────────────────────────────
// expandSelectorWithIs
// ─────────────────────────────────────────────────
describe('expandSelectorWithIs', () => {
  it('passes through simple value unchanged', () => {
    const s = el('.a');
    expect(expandSelectorWithIs(s)).toHaveLength(1);
  });

  it('delegates to expandComplexSelectorWithIs for complex value', () => {
    const s = sel([is(sellist([el('.x'), el('.y')])), co(' '), el('.a')]) as ComplexSelector;
    const result = expandSelectorWithIs(s);
    expect(result).toHaveLength(2);
  });

  it('delegates to expandCompoundWithPseudoSelectors for compound value', () => {
    const c = compound([el('.a'), is(sellist([el('.x'), el('.y')]))]);
    const result = expandSelectorWithIs(c);
    expect(result.length).toBeGreaterThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────
// areComplexSelectorsEquivalent
// ─────────────────────────────────────────────────
describe('areComplexSelectorsEquivalent', () => {
  it('matches identical complex value', () => {
    const a = sel([el('.a'), co('>'), el('.b')]) as ComplexSelector;
    const b = sel([el('.a'), co('>'), el('.b')]) as ComplexSelector;
    expect(areComplexSelectorsEquivalent(a, b)).toBe(true);
  });

  it('rejects complex value of different length', () => {
    const a = sel([el('.a'), co('>'), el('.b')]) as ComplexSelector;
    const b = sel([el('.a')]) as ComplexSelector;
    expect(areComplexSelectorsEquivalent(a, b)).toBe(false);
  });

  it('rejects complex value with different combinators', () => {
    const a = sel([el('.a'), co('>'), el('.b')]) as ComplexSelector;
    const b = sel([el('.a'), co('+'), el('.b')]) as ComplexSelector;
    expect(areComplexSelectorsEquivalent(a, b)).toBe(false);
  });

  it('matches complex value with compound value in any order', () => {
    const a = sel([compound([el('.x'), el('.y')]), co('>'), el('.b')]) as ComplexSelector;
    const b = sel([compound([el('.y'), el('.x')]), co('>'), el('.b')]) as ComplexSelector;
    expect(areComplexSelectorsEquivalent(a, b)).toBe(true);
  });

  it('matches when one component is :is(.a) and other is .a', () => {
    const a = sel([is(el('.a')), co(' '), el('.b')]) as ComplexSelector;
    const b = sel([el('.a'), co(' '), el('.b')]) as ComplexSelector;
    expect(areComplexSelectorsEquivalent(a, b)).toBe(true);
  });

  it('matches :is(.a,.b) against .a (picks one alternative)', () => {
    const a = sel([is(sellist([el('.a'), el('.b')])), co(' '), el('.c')]) as ComplexSelector;
    const b = sel([el('.a'), co(' '), el('.c')]) as ComplexSelector;
    expect(areComplexSelectorsEquivalent(a, b)).toBe(true);
  });

  it('rejects :is(.a,.b) against .c (no alternative matches)', () => {
    const a = sel([is(sellist([el('.a'), el('.b')])), co(' '), el('.c')]) as ComplexSelector;
    const b = sel([el('.c'), co(' '), el('.c')]) as ComplexSelector;
    expect(areComplexSelectorsEquivalent(a, b)).toBe(false);
  });
});

// ─────────────────────────────────────────────────
// isStructurallyEqual
// ─────────────────────────────────────────────────
describe('isStructurallyEqual', () => {
  it('matches identical simple value', () => {
    expect(isStructurallyEqual(el('.a'), el('.a'))).toBe(true);
  });

  it('rejects different simple value', () => {
    expect(isStructurallyEqual(el('.a'), el('.b'))).toBe(false);
  });

  it('matches equivalent pseudo-value', () => {
    const a = pseudo({ name: ':hover' });
    const b = pseudo({ name: ':hover' });
    expect(isStructurallyEqual(a, b)).toBe(true);
  });

  it('rejects pseudo-value with different names', () => {
    const a = pseudo({ name: ':hover' });
    const b = pseudo({ name: ':focus' });
    expect(isStructurallyEqual(a, b)).toBe(false);
  });

  it('matches complex value component-by-component', () => {
    const a = sel([el('.a'), co('>'), el('.b')]);
    const b = sel([el('.a'), co('>'), el('.b')]);
    expect(isStructurallyEqual(a, b)).toBe(true);
  });

  it('rejects complex value with different value', () => {
    const a = sel([el('.a'), co('>'), el('.b')]);
    const b = sel([el('.a'), co('>'), el('.c')]);
    expect(isStructurallyEqual(a, b)).toBe(false);
  });

  it('matches compound value with same value in same order', () => {
    const a = compound([el('.x'), el('.y')]);
    const b = compound([el('.x'), el('.y')]);
    expect(isStructurallyEqual(a, b)).toBe(true);
  });
});

// ─────────────────────────────────────────────────
// selectorMatchesExtendTarget
// ─────────────────────────────────────────────────
describe('selectorMatchesExtendTarget', () => {
  it('matches identical simple value (non-partial)', () => {
    expect(selectorMatchesExtendTarget(el('.a'), el('.a'), false)).toBe(true);
  });

  it('rejects different simple value (non-partial)', () => {
    expect(selectorMatchesExtendTarget(el('.a'), el('.b'), false)).toBe(false);
  });

  it('matches when target is inside a SelectorList (non-partial)', () => {
    const target: Selector = sellist([el('.a'), el('.b')]);
    expect(selectorMatchesExtendTarget(target, el('.a'), false)).toBe(true);
  });

  it('matches complex value (non-partial)', () => {
    const a = sel([el('.a'), co('>'), el('.b')]);
    const b = sel([el('.a'), co('>'), el('.b')]);
    expect(selectorMatchesExtendTarget(a, b, false)).toBe(true);
  });

  it('rejects when find is not in target (non-partial)', () => {
    const target: Selector = sellist([el('.a'), el('.b')]);
    expect(selectorMatchesExtendTarget(target, el('.c'), false)).toBe(false);
  });
});

// ─────────────────────────────────────────────────
// normalizeSelectorForExtend
// ─────────────────────────────────────────────────
describe('normalizeSelectorForExtend', () => {
  it('passes through simple value unchanged', () => {
    const s = el('.a');
    const result = normalizeSelectorForExtend(s);
    expect(result.valueOf()).toBe('.a');
  });

  it('normalizes selector for extend matching', () => {
    // Basic sanity — should not crash and should return a selector
    const s = sel([el('.a'), co(' '), el('.b')]);
    const result = normalizeSelectorForExtend(s);
    expect(result).toBeTruthy();
    expect(typeof result.valueOf()).toBe('string');
  });
});

// ─────────────────────────────────────────────────
// selectorCompare — additional edge cases
// ─────────────────────────────────────────────────
describe('selectorCompare edge cases', () => {
  it('reports whole match for identical simple value', () => {
    const result = selectorCompare(el('.a'), el('.a'));
    expect(result.isEquivalent).toBe(true);
    expect(result.hasWholeMatch).toBe(true);
  });

  it('reports no match for different simple value', () => {
    const result = selectorCompare(el('.a'), el('.b'));
    expect(result.isEquivalent).toBe(false);
    expect(result.hasWholeMatch).toBe(false);
  });

  it('reports match for SelectorList containing the find', () => {
    const target: Selector = sellist([el('.a'), el('.b')]);
    const result = selectorCompare(target, el('.a'));
    // selectorCompare uses findExtendableLocations which detects presence
    expect(result.hasWholeMatch || result.hasPartialMatch).toBe(true);
  });

  it('uses Set-based O(N) comparison for two SelectorLists', () => {
    const a: Selector = sellist([el('.x'), el('.y'), el('.z')]);
    const b: Selector = sellist([el('.z'), el('.x'), el('.y')]);
    const result = selectorCompare(a, b);
    expect(result.isEquivalent).toBe(true);
  });

  it('rejects SelectorLists with different items', () => {
    const a: Selector = sellist([el('.x'), el('.y')]);
    const b: Selector = sellist([el('.x'), el('.z')]);
    const result = selectorCompare(a, b);
    expect(result.isEquivalent).toBe(false);
  });
});

// ─────────────────────────────────────────────────
// findExtendableLocations — additional unit tests
// ─────────────────────────────────────────────────
describe('findExtendableLocations unit tests', () => {
  it('finds simple selector in SelectorList', () => {
    const target: Selector = sellist([el('.a'), el('.b'), el('.c')]);
    const result = findExtendableLocations(target, el('.b'));
    expect(result.hasMatches).toBe(true);
  });

  it('returns no match when target does not contain find', () => {
    const target: Selector = sellist([el('.a'), el('.b')]);
    const result = findExtendableLocations(target, el('.z'));
    expect(result.hasMatches).toBe(false);
  });

  it('finds selector inside :is() argument', () => {
    const target = is(sellist([el('.a'), el('.b')]));
    const result = findExtendableLocations(target, el('.a'));
    expect(result.hasMatches).toBe(true);
  });

  it('finds compound subsequence as partial match', () => {
    // .a.b.c target, .a.c find → partial match
    const target = compound([el('.a'), el('.b'), el('.c')]);
    const result = findExtendableLocations(target, compound([el('.a'), el('.c')]));
    expect(result.hasMatches).toBe(true);
  });

  it('caches results for identical selector+find pairs', () => {
    const target = el('.cached');
    const find = el('.cached');
    const r1 = findExtendableLocations(target, find);
    const r2 = findExtendableLocations(target, find);
    // Should return the same cached object
    expect(r1).toBe(r2);
  });
});
