/**
 * COPY of the graft-into-target cases from extend-where-selector.test.ts, driven through the
 * OWN-CONSTRUCTION engine. Each `extendSelector(...)` is routed through `extendViaOwn`, which
 * byte-compares the own engine to the oracle (throws on MISMATCH) and records UNSUPPORTED
 * otherwise. Exercises `:where()`/`:is()` graft targets — the graft-into-target rung.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { el, sellist, compound, pseudo } from '../../../index.js';
import { extendViaOwn, reportFrontier, resetFrontier } from './corpus-harness.js';

const where = (arg: any) => pseudo({ name: ':where', arg });

describe('CORPUS (own engine): Extend :where() Selector', () => {
  resetFrontier();
  afterAll(() => reportFrontier('where-cases'));

  it('extend within :where() arguments (single arg)', () => {
    const r = extendViaOwn(where(el('.a')), el('.a'), el('.b'), false, ':where(.a) find .a full');
    expect(r.valueOf()).toBe(':where(.a,.b)');
  });

  it('extend within existing :where() argument list', () => {
    const r = extendViaOwn(where(sellist([el('.a'), el('.b')])), el('.a'), el('.c'), false, ':where(.a,.b) find .a full');
    expect(r.valueOf()).toBe(':where(.a,.b,.c)');
  });

  it('extend within :where() when a plain atom precedes it (partial)', () => {
    const r = extendViaOwn(
      compound([el('.foo'), where(el('.a'))]),
      el('.a'), el('.b'), true, '.foo:where(.a) find .a partial'
    );
    expect(r.valueOf()).toBe('.foo:where(.a,.b)');
  });

  it('preserves :where() (does not convert to :is())', () => {
    const r = extendViaOwn(where(el('.original')), el('.original'), el('.extended'), false, ':where(.original) find .original full');
    expect(r.valueOf()).toBe(':where(.original,.extended)');
  });
});
