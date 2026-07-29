import { describe, expect, it } from 'vitest';
import { collectPlan } from '../extend/plan.js';
import { composePath } from '../extend/compose.js';
import { classifyMatchBoundary } from '../extend/match.js';
import { branchFromComplex, branchText } from '../extend/ir.js';
import {
  compoundSelectorOf, complexSelector, rule, sel, selist, simpleSelector, stylesheet, type ComplexSelector
} from '../nodes.js';

/**
 * [&-boundary] Pins `classifyMatchBoundary` — the `bnd`-origin reader that replaces
 * the emit-layer text heuristics for the hoist decision. It classifies where an
 * instruction target matches a COMPOSED branch relative to the ampersand boundary
 * carried in `Branch.bnd` (own-local / inside an ancestor `&` / straddling it).
 */

const seg = (name: string) => ({ term: compoundSelectorOf([simpleSelector(name)]) });
const complex = (...names: string[]): ComplexSelector =>
  complexSelector(names.map((n, i) => (i === 0 ? seg(n) : { combinator: ' ' as const, ...seg(n) })));

/** Compose the single nested child of a one-child ancestor chain and return its
 * composed branch (carrying `bnd`). */
const composedChild = (doc: ReturnType<typeof stylesheet>, ownLocalText: string) => {
  const plan = collectPlan(doc);
  const subject = plan.subjects.find(s => branchText(s.ownLocal[0]!) === ownLocalText)!;
  return composePath(subject.path)[0]!;
};

describe('classifyMatchBoundary (bnd origin reader)', () => {
  it('classifies an own-local single-compound match as LOCAL', () => {
    // `.box { & .leaf {} }` -> `.box .leaf` (origins 1,0); target `.leaf` hits own-local.
    const doc = stylesheet([rule('.box', [rule(complex('&', '.leaf'), [])])]);
    const b = composedChild(doc, '& .leaf');
    const target = branchFromComplex(selist(sel('.leaf')).selectors[0]!);
    expect(classifyMatchBoundary(b, target, true)).toBe('local');
  });

  it('classifies an ancestor-only single-compound match as WITHIN', () => {
    // `.box { .item & {} }` -> `.item .box` (origins 0,1); target `.box` hits the ancestor slot.
    const doc = stylesheet([rule('.box', [rule(complex('.item', '&'), [])])]);
    const b = composedChild(doc, '.item &');
    const target = branchFromComplex(selist(sel('.box')).selectors[0]!);
    expect(classifyMatchBoundary(b, target, true)).toBe('within');
  });

  it('classifies a straddling multi-segment match as CROSSING', () => {
    /*
     * `.outer { .mid { & .leaf {} } }` -> `.outer .mid .leaf` (origins 2,1,0); target
     * `.mid .leaf` spans the ancestor `.mid` and own-local `.leaf`.
     */
    const doc = stylesheet([rule('.outer', [rule('.mid', [rule(complex('&', '.leaf'), [])])])]);
    const b = composedChild(doc, '& .leaf');
    const target = branchFromComplex(complex('.mid', '.leaf'));
    expect(classifyMatchBoundary(b, target, true)).toBe('crossing');
  });

  it('returns NONE when the target does not match the branch', () => {
    const doc = stylesheet([rule('.box', [rule(complex('&', '.leaf'), [])])]);
    const b = composedChild(doc, '& .leaf');
    const target = branchFromComplex(selist(sel('.absent')).selectors[0]!);
    expect(classifyMatchBoundary(b, target, true)).toBe('none');
  });

  it('reads a boundary-free branch (no bnd) as all own-local (LOCAL)', () => {
    // A raw target branch never went through an &-compose, so bnd is undefined.
    const b = branchFromComplex(selist(sel('.a')).selectors[0]!);
    const target = branchFromComplex(selist(sel('.a')).selectors[0]!);
    expect(classifyMatchBoundary(b, target, false)).toBe('local');
  });
});
