/**
 * Own-construction differential — `extendByIndexOwn` vs the `extendSelector` ORACLE.
 *
 * Unlike extend-index-differential.test.ts (whose engine delegates output to the oracle,
 * making accept-side agreement tautological), this engine CONSTRUCTS output itself with NO
 * `extendSelector` fallback. A wrong classification/construction produces wrong output and
 * fails here. Shapes the own engine does not build yet return UNSUPPORTED (asserted red-safe:
 * we skip the byte-compare and record the frontier), never a silent delegation.
 */
import { describe, it, expect } from 'vitest';
import { el, sel, sellist, compound, is, co, type Selector } from '../../../index.js';
import { extendSelector } from '../../util/extend.js';
import { extendByIndexOwn, UNSUPPORTED } from '../extend-index.js';

type Input = Parameters<typeof extendSelector>[0];
type Result = ReturnType<typeof extendSelector>;

function str(v: Result | Selector | Selector[]): string {
  if (typeof v === 'string') {
    return v;
  }
  if (Array.isArray(v)) {
    return v.map(s => String(typeof s === 'string' ? s : (s.valueOf?.() ?? s))).join(',');
  }
  return String(v.valueOf?.() ?? v);
}

/** Assert own-engine output is byte-identical to the oracle (fails on divergence). */
function same(
  make: () => { target: Input; find: Selector; extendWith: Selector; partial: boolean }
): void {
  const a = make();
  const oracle = extendSelector(a.target, a.find, a.extendWith, a.partial);
  const b = make();
  const mine = extendByIndexOwn(b.target, b.find, b.extendWith, b.partial);
  if (mine === UNSUPPORTED) {
    throw new Error(`own engine returned UNSUPPORTED (oracle: ${str(oracle)})`);
  }
  expect(str(mine)).toBe(str(oracle));
}

describe('extendByIndexOwn (own construction, no delegation)', () => {
  describe('1. exact single compound', () => {
    it('.a extend .b full → .a,.b', () => {
      same(() => ({ target: el('.a'), find: el('.a'), extendWith: el('.b'), partial: false }));
    });
    it('.a NOT_FOUND against .z', () => {
      same(() => ({ target: el('.a'), find: el('.z'), extendWith: el('.b'), partial: false }));
    });
    it('.a.b find .a.b full → .a.b,.c', () => {
      same(() => ({
        target: compound([el('.a'), el('.b')]),
        find: compound([el('.a'), el('.b')]),
        extendWith: el('.c'),
        partial: false
      }));
    });
  });

  describe('1b. compound set semantics', () => {
    it('.a.b find .b.a full (order-free match)', () => {
      same(() => ({
        target: compound([el('.a'), el('.b')]),
        find: compound([el('.b'), el('.a')]),
        extendWith: el('.c'),
        partial: false
      }));
    });
    it('.b.a find .a partial → .b:is(.a,.x)', () => {
      same(() => ({
        target: compound([el('.b'), el('.a')]),
        find: el('.a'),
        extendWith: el('.x'),
        partial: true
      }));
    });
    it('.b.a.c find .a partial → .b:is(.a,.x).c', () => {
      same(() => ({
        target: compound([el('.b'), el('.a'), el('.c')]),
        find: el('.a'),
        extendWith: el('.x'),
        partial: true
      }));
    });
  });

  describe('1c. duplicate atoms', () => {
    it('.b.b.c find .b.c full → matches (dup ignored by bitset)', () => {
      same(() => ({
        target: compound([el('.b'), el('.b'), el('.c')]),
        find: compound([el('.b'), el('.c')]),
        extendWith: el('.x'),
        partial: false
      }));
    });
    it('.b.b.c find .b partial → :is(.b,.x):is(.b,.x).c (each occurrence)', () => {
      same(() => ({
        target: compound([el('.b'), el('.b'), el('.c')]),
        find: el('.b'),
        extendWith: el('.x'),
        partial: true
      }));
    });
    it('.b.b.c find .z NOT_FOUND', () => {
      same(() => ({
        target: compound([el('.b'), el('.b'), el('.c')]),
        find: el('.z'),
        extendWith: el('.x'),
        partial: false
      }));
    });
  });

  describe('2. subset in a compound', () => {
    it('.b.c find .b full → unchanged (partial-only)', () => {
      same(() => ({
        target: compound([el('.b'), el('.c')]),
        find: el('.b'),
        extendWith: el('.q'),
        partial: false
      }));
    });
    it('.b.c find .b partial → :is(.b,.q).c', () => {
      same(() => ({
        target: compound([el('.b'), el('.c')]),
        find: el('.b'),
        extendWith: el('.q'),
        partial: true
      }));
    });
    it('.a.b.c find .a.b partial → :is(.a.b,.x).c', () => {
      same(() => ({
        target: compound([el('.a'), el('.b'), el('.c')]),
        find: compound([el('.a'), el('.b')]),
        extendWith: el('.x'),
        partial: true
      }));
    });
    it('.a.b find .a partial extend .x.y → :is(.a,.x.y).b', () => {
      same(() => ({
        target: compound([el('.a'), el('.b')]),
        find: el('.a'),
        extendWith: compound([el('.x'), el('.y')]),
        partial: true
      }));
    });
  });

  describe('3. position in a sequence', () => {
    it('.x .b find .b partial → .x :is(.b,.c)', () => {
      same(() => ({
        target: sel([el('.x'), co(' '), el('.b')]),
        find: el('.b'),
        extendWith: el('.c'),
        partial: true
      }));
    });
    it('.a > .b find .b partial → .a>:is(.b,.c)', () => {
      same(() => ({
        target: sel([el('.a'), co('>'), el('.b')]),
        find: el('.b'),
        extendWith: el('.c'),
        partial: true
      }));
    });
    it('.x .b find .z NOT_FOUND', () => {
      same(() => ({
        target: sel([el('.x'), co(' '), el('.b')]),
        find: el('.z'),
        extendWith: el('.c'),
        partial: true
      }));
    });
    it('.x .b.c find .b partial → .x :is(.b,.q).c', () => {
      same(() => ({
        target: sel([el('.x'), co(' '), compound([el('.b'), el('.c')])]),
        find: el('.b'),
        extendWith: el('.q'),
        partial: true
      }));
    });
  });

  describe('4. multi-compound sequence find', () => {
    it('.x .b find .x .b full → .x .b,.c', () => {
      same(() => ({
        target: sel([el('.x'), co(' '), el('.b')]),
        find: sel([el('.x'), co(' '), el('.b')]),
        extendWith: el('.c'),
        partial: false
      }));
    });
    it('.a > .b > .c find .a > .b partial → :is(.a>.b,.q)>.c', () => {
      same(() => ({
        target: sel([el('.a'), co('>'), el('.b'), co('>'), el('.c')]),
        find: sel([el('.a'), co('>'), el('.b')]),
        extendWith: el('.q'),
        partial: true
      }));
    });
    it('.a > .b > .c find .b > .c partial → .a>:is(.b>.c,.q)', () => {
      same(() => ({
        target: sel([el('.a'), co('>'), el('.b'), co('>'), el('.c')]),
        find: sel([el('.b'), co('>'), el('.c')]),
        extendWith: el('.q'),
        partial: true
      }));
    });
    it('combinator mismatch .a > .b find .a .b NOT_FOUND', () => {
      same(() => ({
        target: sel([el('.a'), co('>'), el('.b')]),
        find: sel([el('.a'), co(' '), el('.b')]),
        extendWith: el('.q'),
        partial: false
      }));
    });
  });

  describe('5. :is() extendWith flatten', () => {
    it('.foo find .foo extend :is(.ext3,.ext4) full → .foo,.ext3,.ext4', () => {
      same(() => ({
        target: el('.foo'),
        find: el('.foo'),
        extendWith: is(sellist([el('.ext3'), el('.ext4')])),
        partial: false
      }));
    });
  });

  describe('7. all/partial vs exact', () => {
    it('.a.b find .a full → unchanged', () => {
      same(() => ({
        target: compound([el('.a'), el('.b')]),
        find: el('.a'),
        extendWith: el('.c'),
        partial: false
      }));
    });
    it('.a.b find .a partial → :is(.a,.c).b', () => {
      same(() => ({
        target: compound([el('.a'), el('.b')]),
        find: el('.a'),
        extendWith: el('.c'),
        partial: true
      }));
    });
  });

  describe('9. deep nesting', () => {
    it('.a > .b .c find .c partial → .a>.b :is(.c,.z)', () => {
      same(() => ({
        target: sel([el('.a'), co('>'), el('.b'), co(' '), el('.c')]),
        find: el('.c'),
        extendWith: el('.z'),
        partial: true
      }));
    });
    it('.a .b > .c .d find .b > .c partial', () => {
      same(() => ({
        target: sel([el('.a'), co(' '), el('.b'), co('>'), el('.c'), co(' '), el('.d')]),
        find: sel([el('.b'), co('>'), el('.c')]),
        extendWith: el('.z'),
        partial: true
      }));
    });
  });

  describe('discovery gate independence (NOT_FOUND)', () => {
    it('.x .b find .x .z NOT_FOUND', () => {
      same(() => ({
        target: sel([el('.x'), co(' '), el('.b')]),
        find: sel([el('.x'), co(' '), el('.z')]),
        extendWith: el('.c'),
        partial: false
      }));
    });
  });

  describe('selector list', () => {
    it('.btn,.link find .btn full → .btn,.link,.primary', () => {
      same(() => ({
        target: sellist([el('.btn'), el('.link')]),
        find: el('.btn'),
        extendWith: el('.primary'),
        partial: false
      }));
    });
    it('.a,.b find .a full → .a,.b,.c', () => {
      same(() => ({
        target: sellist([el('.a'), el('.b')]),
        find: el('.a'),
        extendWith: el('.c'),
        partial: false
      }));
    });
  });
});
