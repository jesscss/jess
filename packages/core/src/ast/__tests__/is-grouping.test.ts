import { describe, expect, it } from 'vitest';
import { extendBranchSpecificity, nestingGroupKey, partitionGroups } from '../is-grouping.js';
import { branchFromSelector, descendantBranch, textSimple } from '../extend/ir.js';
import { compoundSelectorOf, complexSelector, relativeSelector, sel, simpleSelector, type SelectorBranch } from '../nodes.js';

/** Selectors-4 §17 specificity `(a,b,c)` in the module's packed form. */
const spec = (a: number, b: number, c: number): number => a * 2 ** 32 + b * 2 ** 16 + c;

const compound = (...simples: string[]): SelectorBranch =>
  compoundSelectorOf(simples.map(simpleSelector) as [ReturnType<typeof simpleSelector>, ReturnType<typeof simpleSelector>]);
const descendant = (...parts: string[]): SelectorBranch =>
  complexSelector(parts.map((p, i) => (i === 0
    ? { term: simpleSelector(p) }
    : { combinator: ' ' as const, term: simpleSelector(p) })) as Parameters<typeof complexSelector>[0]);
const ir = (branch: SelectorBranch) => branchFromSelector(branch);

describe('the shared :is() grouping', () => {
  it('scores an extend branch from the selector IR', () => {
    // extend-nest's mixed group: the complex and the compound member both score (0,2,0).
    expect(extendBranchSpecificity(ir(descendant('.type1', '.sidebar3')), false)).toBe(spec(0, 2, 0));
    expect(extendBranchSpecificity(ir(compound('.type2', '.sidebar4')), false)).toBe(spec(0, 2, 0));
    expect(extendBranchSpecificity(ir(sel('.sidebar')), false)).toBe(spec(0, 1, 0));
    expect(extendBranchSpecificity(ir(compound('div', '#a', '[x]', ':hover')), false)).toBe(spec(1, 2, 1));
    expect(extendBranchSpecificity(ir(sel('*')), false)).toBe(0);
  });

  it('keeps a complex member out of a group that something precedes', () => {
    expect(extendBranchSpecificity(ir(descendant('.type1', '.sidebar3')), true)).toBe(-1);
    expect(extendBranchSpecificity(ir(compound('.type2', '.sidebar4')), true)).toBe(spec(0, 2, 0));
  });

  it('keeps pseudo-elements, unlisted pseudo-classes and relative members out', () => {
    expect(extendBranchSpecificity(ir(compound('.a', '::before')), false)).toBe(-1);
    expect(extendBranchSpecificity(ir(compound('.a', ':before')), false)).toBe(-1);
    expect(extendBranchSpecificity(ir(compound('a', ':-webkit-autofill')), false)).toBe(-1);
    expect(extendBranchSpecificity(ir(relativeSelector('>', [{ term: simpleSelector('.a') }])), false)).toBe(-1);
  });

  it('never reads a token without parser provenance back out of its text', () => {
    // A `&` substituted by its parent's text, or a dynamic extender's composed text.
    expect(extendBranchSpecificity(descendantBranch([textSimple('.type2')]), true)).toBe(-1);
    expect(extendBranchSpecificity(descendantBranch([textSimple(':hover')]), false)).toBe(-1);
    expect(extendBranchSpecificity(descendantBranch([textSimple('.parent .col')]), false)).toBe(-1);
  });

  it('holds a nested extend group to the position of the group around it', () => {
    // `:is(.p .q, .r .s).k` spliced after a combinator would let `.p` sit above it.
    const inner = (fold: boolean) => descendantBranch([
      { t: 'is', branches: [ir(descendant('.p', '.q')), ir(descendant('.r', '.s'))], fold },
      ir(sel('.k')).segments[0]!.compound.value[0]!
    ]);
    expect(extendBranchSpecificity(inner(true), false)).toBe(spec(0, 3, 0));
    expect(extendBranchSpecificity(inner(true), true)).toBe(-1);

    // An authored `:is()` is the author's selector: it only adds its score.
    expect(extendBranchSpecificity(inner(false), true)).toBe(spec(0, 3, 0));
  });

  it('keys the nesting fold by specificity when guarded and by shape when not', () => {
    expect(nestingGroupKey(compound('input', '[type="radio"]'), true)).toBe(spec(0, 1, 1));
    expect(nestingGroupKey(descendant('thead', 'th'), true)).toBe(-1);
    expect(nestingGroupKey(descendant('thead', 'th'), false)).toBe(0);
    expect(nestingGroupKey(relativeSelector('>', [{ term: simpleSelector('.col') }]), false)).toBe(-1);
  });

  it('partitions by key, gathering non-adjacent equal keys in order of first appearance', () => {
    const keys = [5, -1, 3, 5, -1, 3, 5];
    expect(partitionGroups(keys)).toEqual([3, 1, 2, 1]);
    expect(keys).toEqual([0, 1, 2, 0, 3, 2, 0]);
  });
});
