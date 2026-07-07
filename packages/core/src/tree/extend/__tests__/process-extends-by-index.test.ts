/**
 * Prototype global-flow differential: `processExtendsByIndex` (IR worklist, materialize once)
 * vs `applyExtendsToSelector` (ORACLE — the landed node-mutating worklist).
 *
 * Proves the IR worklist reproduces multi-extend fan-out + chained/transitive fixpoint output
 * for the shapes the own construction engine covers, WITHOUT per-extend node round-trips. Cases
 * whose bucket the own engine cannot build report `fullyOwnBuilt=false` (frontier), never silent
 * delegation.
 */
import { describe, it, expect } from 'vitest';
import { el, sel, sellist, co, type Selector } from '../../../index.js';
import { applyExtendsToSelector, type ExtendInstruction } from '../../util/extend.js';
import { processExtendsByIndex, type IndexExtendInstruction } from '../process-extends-by-index.js';

function str(v: Selector | Selector[] | string): string {
  if (typeof v === 'string') {
    return v;
  }
  if (Array.isArray(v)) {
    return v.map(s => String(s.valueOf())).join(',');
  }
  return String(v.valueOf());
}

describe('processExtendsByIndex (IR worklist) vs applyExtendsToSelector oracle', () => {
  it('single non-partial extend .base→.child', () => {
    const oracle = applyExtendsToSelector(sellist([el('.base')]), [
      { target: el('.base'), extendWith: el('.child'), partial: false }
    ] as ExtendInstruction[]);
    const mine = processExtendsByIndex(sellist([el('.base')]), [
      { target: el('.base'), extendWith: el('.child'), partial: false }
    ] as IndexExtendInstruction[]);
    expect(mine.fullyOwnBuilt).toBe(true);
    expect(str(mine.selector)).toBe(str(oracle));
  });

  it('same-target fan-out .base→{.c1,.c2,.c3}', () => {
    const insts = [
      { target: el('.base'), extendWith: el('.c1'), partial: false },
      { target: el('.base'), extendWith: el('.c2'), partial: false },
      { target: el('.base'), extendWith: el('.c3'), partial: false }
    ];
    const oracle = applyExtendsToSelector(sellist([el('.base')]), insts as ExtendInstruction[]);
    const mine = processExtendsByIndex(sellist([el('.base')]), insts as IndexExtendInstruction[]);
    expect(mine.fullyOwnBuilt).toBe(true);
    expect(str(mine.selector)).toBe(str(oracle));
  });

  it('different targets .a→.x, .b→.y', () => {
    const insts = [
      { target: el('.a'), extendWith: el('.x'), partial: false },
      { target: el('.b'), extendWith: el('.y'), partial: false }
    ];
    const oracle = applyExtendsToSelector(sellist([el('.a'), el('.b')]), insts as ExtendInstruction[]);
    const mine = processExtendsByIndex(sellist([el('.a'), el('.b')]), insts as IndexExtendInstruction[]);
    expect(mine.fullyOwnBuilt).toBe(true);
    expect(str(mine.selector)).toBe(str(oracle));
  });

  it('CHAINED fixpoint .a→.b→.c (transitive, in IR)', () => {
    const insts = [
      { target: el('.a'), extendWith: el('.b'), partial: false },
      { target: el('.b'), extendWith: el('.c'), partial: false }
    ];
    const oracle = applyExtendsToSelector(sellist([el('.a')]), insts as ExtendInstruction[]);
    const mine = processExtendsByIndex(sellist([el('.a')]), insts as IndexExtendInstruction[]);
    expect(mine.fullyOwnBuilt).toBe(true);
    expect(str(mine.selector)).toBe(str(oracle));
  });

  it('CHAINED three-deep .a→.b→.c→.d', () => {
    const insts = [
      { target: el('.a'), extendWith: el('.b'), partial: false },
      { target: el('.b'), extendWith: el('.c'), partial: false },
      { target: el('.c'), extendWith: el('.d'), partial: false }
    ];
    const oracle = applyExtendsToSelector(sellist([el('.a')]), insts as ExtendInstruction[]);
    const mine = processExtendsByIndex(sellist([el('.a')]), insts as IndexExtendInstruction[]);
    expect(mine.fullyOwnBuilt).toBe(true);
    expect(str(mine.selector)).toBe(str(oracle));
  });

  it('no matching instruction → unchanged', () => {
    const insts = [{ target: el('.z'), extendWith: el('.x'), partial: false }];
    const oracle = applyExtendsToSelector(sellist([el('.a')]), insts as ExtendInstruction[]);
    const mine = processExtendsByIndex(sellist([el('.a')]), insts as IndexExtendInstruction[]);
    expect(str(mine.selector)).toBe(str(oracle));
  });

  it('mixed full match on a list member .btn,.link → .btn,.link,.primary', () => {
    const insts = [{ target: el('.btn'), extendWith: el('.primary'), partial: false }];
    const oracle = applyExtendsToSelector(sellist([el('.btn'), el('.link')]), insts as ExtendInstruction[]);
    const mine = processExtendsByIndex(sellist([el('.btn'), el('.link')]), insts as IndexExtendInstruction[]);
    expect(mine.fullyOwnBuilt).toBe(true);
    expect(str(mine.selector)).toBe(str(oracle));
  });

  it('reports UNSUPPORTED for a graft-target bucket (no silent delegation)', () => {
    // Partial extend into `.a > .b` (a build the own engine covers) chained with a target
    // whose construction the own engine gates → fullyOwnBuilt reflects the frontier honestly.
    const insts = [
      { target: el('.b'), extendWith: sel([el('.d'), co('>'), el('.e')]), partial: true }
    ];
    const mine = processExtendsByIndex(sel([el('.a'), co('>'), el('.b')]), insts as IndexExtendInstruction[]);
    // .a>.b find .b partial extend .d>.e → .a>:is(.b,.d>.e) is own-buildable.
    expect(mine.fullyOwnBuilt).toBe(true);
    expect(str(mine.selector)).toBe('.a>:is(.b,.d>.e)');
  });
});
