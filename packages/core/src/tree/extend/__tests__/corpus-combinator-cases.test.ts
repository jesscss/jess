/**
 * COPY of the pure `extendSelector` cases from extend-combinator-handling.test.ts, driven
 * through the OWN-CONSTRUCTION engine via `extendViaOwn`. These pin combinator preservation
 * (`>`, `+`, `~`, ` `) through the partial `:is()` wrap, plus exact/NOT_FOUND on complex finds.
 * The harness itself byte-compares own-engine output to the oracle.
 */
import { describe, it, afterAll } from 'vitest';
import { el, sel, compound, co } from '../../../index.js';
import { extendViaOwn, reportFrontier, resetFrontier } from './corpus-harness.js';

type Comb = '>' | '+' | '~' | ' ';

function complex(first: string, comb: Comb, second: string) {
  return sel([compound([el('.parent'), el(first)]), co(comb), el(second)]);
}

describe('CORPUS (own engine): Combinator handling', () => {
  resetFrontier();
  afterAll(() => reportFrontier('combinator-cases'));

  for (const comb of ['>', '+', '~', ' '] as Comb[]) {
    it(`preserve ${comb} combinator in complex partial extend`, () => {
      extendViaOwn(complex('.foo', comb, '.child'), el('.foo'), el('.bar'), true, `.parent.foo ${comb} .child find .foo partial`);
    });
  }

  it('preserve multiple combinators .a.foo > .b + .c find .foo partial', () => {
    extendViaOwn(
      sel([compound([el('.a'), el('.foo')]), co('>'), el('.b'), co('+'), el('.c')]),
      el('.foo'), el('.bar'), true, '.a.foo>.b+.c find .foo partial'
    );
  });

  it('match identical complex .parent>.child full', () => {
    extendViaOwn(sel([el('.parent'), co('>'), el('.child')]), sel([el('.parent'), co('>'), el('.child')]), el('.extended'), false, '.parent>.child full');
  });

  it('NOT match .parent>.child vs .parent+.child full → NOT_FOUND', () => {
    extendViaOwn(sel([el('.parent'), co('>'), el('.child')]), sel([el('.parent'), co('+'), el('.child')]), el('.extended'), false, '.parent>.child find .parent+.child full');
  });
});
