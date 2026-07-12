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
import { el, sel, sellist, compound, is, co, pseudo, amp, type Selector } from '../../../index.js';
import { Ampersand } from '../../ampersand.js';
import { extendSelector } from '../../util/extend.js';
import { extendByIndexOwn, UNSUPPORTED } from '../extend-index.js';

const not = (arg: Selector): Selector => pseudo({ name: ':not', arg }) as unknown as Selector;
const where = (arg: Selector): Selector => pseudo({ name: ':where', arg }) as unknown as Selector;
const has = (arg: Selector): Selector => pseudo({ name: ':has', arg }) as unknown as Selector;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ampWith = (selector: any): any => Ampersand.create({ selectorContainer: { selector } });

/** Hardcoded-pin helper: assert own-engine output is EXACTLY `expected` (independent of oracle). */
function pin(
  target: Input,
  find: Selector,
  extendWith: Selector,
  partial: boolean,
  expected: string
): void {
  const r = extendByIndexOwn(target, find, extendWith, partial);
  expect(r === UNSUPPORTED ? 'UNSUPPORTED' : str(r)).toBe(expected);
}

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
    it('.b.b.c find .b.c full → unchanged (stranded .b → not a full match)', () => {
      same(() => ({
        target: compound([el('.b'), el('.b'), el('.c')]),
        find: compound([el('.b'), el('.c')]),
        extendWith: el('.x'),
        partial: false
      }));
    });
    it('.b.b.c find .b.c full → unchanged (HARDCODED pin — pre-fix returned .b.b.c,.x)', () => {
      // `same()` above only asserts prototype==oracle; before the dup-full fix BOTH engines
      // agreed on the WRONG answer (.b.b.c,.x), so it caught nothing. This pins the CORRECT output.
      const r = extendByIndexOwn(compound([el('.b'), el('.b'), el('.c')]), compound([el('.b'), el('.c')]), el('.x'), false);
      expect(r === UNSUPPORTED ? 'UNSUPPORTED' : str(r)).toBe('.b.b.c');
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

  /**
   * GRAFT-INTO-TARGET — extending INTO a `:is(...)` / `:not(...)` / pseudo-arg graft.
   * A pseudo carrying a selector arg is a recursive extend point: recurse into the arg, rewrap.
   * Only `:is()` boundary-crosses into an outer compound match; `:not`/`:where`/`:has` recurse only.
   * These are HARDCODED pins (independent of the oracle) so a regression is caught here directly,
   * plus `same()` byte-compares to the oracle for the same shapes.
   */
  describe('10. graft-into-target (:is/:not/:where/:has)', () => {
    it('bare :is(.a,.b) find .a full → :is(.a,.b,.c) (append into arg)', () => {
      pin(is(sellist([el('.a'), el('.b')])), el('.a'), el('.c'), false, ':is(.a,.b,.c)');
      same(() => ({ target: is(sellist([el('.a'), el('.b')])), find: el('.a'), extendWith: el('.c'), partial: false }));
    });
    it('bare :is(.a,.b) find .a partial → :is(.a,.b,.c) (same as full for whole-branch)', () => {
      pin(is(sellist([el('.a'), el('.b')])), el('.a'), el('.c'), true, ':is(.a,.b,.c)');
    });
    it('bare :is(.foo) find .foo full → :is(.foo,.ext)', () => {
      pin(is(el('.foo')), el('.foo'), el('.ext'), false, ':is(.foo,.ext)');
    });
    it(':not(.foo) find .foo full → :not(.foo,.bar) (recursion, not append/boundary)', () => {
      pin(not(el('.foo')), el('.foo'), el('.bar'), false, ':not(.foo,.bar)');
      same(() => ({ target: not(el('.foo')), find: el('.foo'), extendWith: el('.bar'), partial: false }));
    });
    it(':where(.a,.b) find .a full → :where(.a,.b,.c)', () => {
      pin(where(sellist([el('.a'), el('.b')])), el('.a'), el('.c'), false, ':where(.a,.b,.c)');
    });
    it(':has(.a) find .a full → :has(.a,.q)', () => {
      pin(has(el('.a')), el('.a'), el('.q'), false, ':has(.a,.q)');
    });
    it('bare :is(.a.b) find .a partial → :is(:is(.a,.q).b) (inner subset wrap)', () => {
      pin(is(compound([el('.a'), el('.b')])), el('.a'), el('.q'), true, ':is(:is(.a,.q).b)');
    });
    it('bare :is(.a.b) find .a full → :is(.a.b) (full: no inner subset)', () => {
      pin(is(compound([el('.a'), el('.b')])), el('.a'), el('.q'), false, ':is(.a.b)');
    });
    it(':is(.a.b,.x) find .a partial → :is(:is(.a,.q).b,.x)', () => {
      pin(is(sellist([compound([el('.a'), el('.b')]), el('.x')])), el('.a'), el('.q'), true, ':is(:is(.a,.q).b,.x)');
    });
    it(':is(.foo .bar,.baz) find .bar partial → :is(.foo :is(.bar,.q),.baz) (complex inner branch)', () => {
      pin(
        is(sellist([sel([el('.foo'), co(' '), el('.bar')]), el('.baz')])),
        el('.bar'), el('.q'), true, ':is(.foo :is(.bar,.q),.baz)'
      );
    });

    // Graft as PASSENGER in a larger compound (match/no-match on other atoms).
    it('.x:not(.foo) find .foo partial → .x:not(.foo,.q) (recurse graft passenger)', () => {
      pin(compound([el('.x'), not(el('.foo'))]), el('.foo'), el('.q'), true, '.x:not(.foo,.q)');
    });
    it('.x:not(.foo) find .foo full → .x:not(.foo) (subset, unchanged)', () => {
      pin(compound([el('.x'), not(el('.foo'))]), el('.foo'), el('.q'), false, '.x:not(.foo)');
    });
    it('.x:not(.foo) find .x partial → :is(.x,.q):not(.foo) (wrap plain, graft passenger)', () => {
      pin(compound([el('.x'), not(el('.foo'))]), el('.x'), el('.q'), true, ':is(.x,.q):not(.foo)');
    });
    it('.x:is(.a,.b) find .a partial → .x:is(.a,.b,.q)', () => {
      pin(compound([el('.x'), is(sellist([el('.a'), el('.b')]))]), el('.a'), el('.q'), true, '.x:is(.a,.b,.q)');
    });
    it('.x:is(.a,.b) find .a full → .x:is(.a,.b) (subset, unchanged)', () => {
      pin(compound([el('.x'), is(sellist([el('.a'), el('.b')]))]), el('.a'), el('.q'), false, '.x:is(.a,.b)');
    });
    it(':is(a).info find .info full → :is(a).info (plain subset with graft passenger, unchanged)', () => {
      pin(compound([is(el('a')), el('.info')]), el('.info'), compound([el('div'), el('.foo')]), false, ':is(a).info');
    });

    // `:is()` boundary-cross into an OUTER full compound match → append sibling.
    it(':is(.a,.b).c find .a.c full → :is(.a,.b).c,.d (:is boundary reach, whole-compound full)', () => {
      pin(compound([is(sellist([el('.a'), el('.b')])), el('.c')]), compound([el('.a'), el('.c')]), el('.d'), false, ':is(.a,.b).c,.d');
    });
    it(':is(.a,.b).c find .b.c full → :is(.a,.b).c,.d (other :is branch)', () => {
      pin(compound([is(sellist([el('.a'), el('.b')])), el('.c')]), compound([el('.b'), el('.c')]), el('.d'), false, ':is(.a,.b).c,.d');
    });
    it(':is(.a,.b).c find .a full → :is(.a,.b).c (subset, unchanged)', () => {
      pin(compound([is(sellist([el('.a'), el('.b')])), el('.c')]), el('.a'), el('.d'), false, ':is(.a,.b).c');
    });

    // Graft in one compound, plain match in a DIFFERENT compound of a complex selector.
    it(':is(.foo,.a) .bar find .bar partial → :is(.foo,.a) :is(.bar,.ext) (graft untouched)', () => {
      pin(sel([is(sellist([el('.foo'), el('.a')])), co(' '), el('.bar')]), el('.bar'), el('.ext'), true, ':is(.foo,.a) :is(.bar,.ext)');
    });

    // No-match / gate.
    it('bare :is(.a,.b) find .z → NOT_FOUND', () => {
      pin(is(sellist([el('.a'), el('.b')])), el('.z'), el('.c'), false, 'NOT_FOUND');
    });
  });

  // RUNG CLOSED: `:is` boundary-cross flatten (PARTIAL). A multi-atom find that aligns POSITIONALLY
  // across a graft-bearing compound, crossing at least one `:is` boundary, collapses the matched span
  // into `:is(<find-as-written>, <extendWith>)` placed first, with the UNMATCHED plain atoms trailing
  // in original order. A find whose atoms are NOT in target position order is a non-positional whole
  // consume → append. All pins are HARDCODED (independent of the oracle).
  describe('12. :is boundary-cross flatten (PARTIAL)', () => {
    it(':is(.a,.b).c find .a.c → :is(.a.c,.d)  (canonical: matched span → :is, `.b` arm dropped)', () => {
      pin(compound([is(sellist([el('.a'), el('.b')])), el('.c')]), compound([el('.a'), el('.c')]), el('.d'), true, ':is(.a.c,.d)');
    });
    it(':is(.a,.b).c.x find .a.c → :is(.a.c,.d).x  (unmatched `.x` trails)', () => {
      pin(compound([is(sellist([el('.a'), el('.b')])), el('.c'), el('.x')]), compound([el('.a'), el('.c')]), el('.d'), true, ':is(.a.c,.d).x');
    });
    it(':is(.a,.b).x.c find .a.c → :is(.a.c,.d).x  (positional skip over `.x`)', () => {
      pin(compound([is(sellist([el('.a'), el('.b')])), el('.x'), el('.c')]), compound([el('.a'), el('.c')]), el('.d'), true, ':is(.a.c,.d).x');
    });
    it('.m:is(.a,.b).c find .a.c → :is(.a.c,.d).m  (`:is` hoists to front, unmatched `.m` trails)', () => {
      pin(compound([el('.m'), is(sellist([el('.a'), el('.b')])), el('.c')]), compound([el('.a'), el('.c')]), el('.d'), true, ':is(.a.c,.d).m');
    });
    it('.x:is(.a,.b).y.c find .a.c → :is(.a.c,.d).x.y  (two unmatched, order preserved)', () => {
      pin(compound([el('.x'), is(sellist([el('.a'), el('.b')])), el('.y'), el('.c')]), compound([el('.a'), el('.c')]), el('.d'), true, ':is(.a.c,.d).x.y');
    });
    it('.c:is(.a,.b) find .c.a → :is(.c.a,.d)  (graft second, positional flatten)', () => {
      pin(compound([el('.c'), is(sellist([el('.a'), el('.b')]))]), compound([el('.c'), el('.a')]), el('.d'), true, ':is(.c.a,.d)');
    });
    it(':is(.a,.b):is(.x,.y) find .a.x → :is(.a.x,.d)  (graft+graft crossing)', () => {
      pin(compound([is(sellist([el('.a'), el('.b')])), is(sellist([el('.x'), el('.y')]))]), compound([el('.a'), el('.x')]), el('.d'), true, ':is(.a.x,.d)');
    });
    it(':is(.a,.b).c find .c.a → :is(.a,.b).c,.d  (NON-positional whole consume → append, NOT flatten)', () => {
      pin(compound([is(sellist([el('.a'), el('.b')])), el('.c')]), compound([el('.c'), el('.a')]), el('.d'), true, ':is(.a,.b).c,.d');
    });
    it('extendWith list: find .a.c ext (.d,.e) → :is(.a.c,.d,.e)  (list flattens into `:is`)', () => {
      pin(compound([is(sellist([el('.a'), el('.b')])), el('.c')]), compound([el('.a'), el('.c')]), sellist([el('.d'), el('.e')]), true, ':is(.a.c,.d,.e)');
    });
    it('extendWith :is: find .a.c ext :is(.d,.e) → :is(.a.c,.d,.e)  (`:is` ext flattens)', () => {
      pin(compound([is(sellist([el('.a'), el('.b')])), el('.c')]), compound([el('.a'), el('.c')]), is(sellist([el('.d'), el('.e')])), true, ':is(.a.c,.d,.e)');
    });
    it('extendWith combinator: find .a.c ext .d>.e → :is(.a.c,.d>.e)  (combinator kept)', () => {
      pin(compound([is(sellist([el('.a'), el('.b')])), el('.c')]), compound([el('.a'), el('.c')]), sel([el('.d'), co('>'), el('.e')]), true, ':is(.a.c,.d>.e)');
    });
    it('.z :is(.a,.b).c find .a.c → .z :is(.a.c,.d)  (flatten in a complex seq position)', () => {
      pin(sel([el('.z'), co(' '), compound([is(sellist([el('.a'), el('.b')])), el('.c')])]), compound([el('.a'), el('.c')]), el('.d'), true, '.z :is(.a.c,.d)');
    });
    it('list target :is(.a,.b).c,.q find .a.c → :is(.a.c,.d),.q  (only the graft branch flattens)', () => {
      pin(sellist([compound([is(sellist([el('.a'), el('.b')])), el('.c')]), el('.q')]), compound([el('.a'), el('.c')]), el('.d'), true, ':is(.a.c,.d),.q');
    });
  });

  describe('12b. graft partial-of-branch → NOT_FOUND (rung 4, class 1)', () => {
    // `.a` reaches only PART of the multi-atom `:is` branch `.a.z` — partial-of-a-branch never
    // matches, so the whole find fails to match. The oracle returns NOT_FOUND (no extend). Own now
    // returns NOT_FOUND (was UNSUPPORTED) — a clean "no match", not a fail-loud gate.
    it(':is(.a.z,.b).c find .a.c partial → NOT_FOUND  (`.a` partial-of-branch `.a.z`)', () => {
      pin(compound([is(sellist([compound([el('.a'), el('.z')]), el('.b')])), el('.c')]), compound([el('.a'), el('.c')]), el('.d'), true, 'NOT_FOUND');
    });
    it(':is(.a.z,.b).c find .a.c FULL → NOT_FOUND', () => {
      pin(compound([is(sellist([compound([el('.a'), el('.z')]), el('.b')])), el('.c')]), compound([el('.a'), el('.c')]), el('.d'), false, 'NOT_FOUND');
    });
    it(':is(.a.z,.b).c find .a.z.c FULL → NOT_FOUND  (branch fully covered but still no whole-branch consume)', () => {
      pin(compound([is(sellist([compound([el('.a'), el('.z')]), el('.b')])), el('.c')]), compound([el('.a'), el('.z'), el('.c')]), el('.d'), false, 'NOT_FOUND');
    });
    it(':is(.a,.b).c find .a.c.x FULL → NOT_FOUND  (find atom `.x` absent from target)', () => {
      pin(compound([is(sellist([el('.a'), el('.b')])), el('.c')]), compound([el('.a'), el('.c'), el('.x')]), el('.d'), false, 'NOT_FOUND');
    });
  });

  describe('12c. graft proper-subset-in-full with trailing atom → unchanged (rung 4, class 2)', () => {
    // FULL mode, the find matches the graft + a plain atom as a SUBSET but a trailing `.x` is
    // stranded → not a full match → the target is UNCHANGED (oracle-verified). Own now builds this
    // (was UNSUPPORTED).
    it(':is(.a,.b).c.x find .a.c FULL → :is(.a,.b).c.x  (unchanged; `.x` stranded)', () => {
      pin(compound([is(sellist([el('.a'), el('.b')])), el('.c'), el('.x')]), compound([el('.a'), el('.c')]), el('.d'), false, ':is(.a,.b).c.x');
    });
    it('.m:is(.a,.b).c.x find .a.c FULL → .m:is(.a,.b).c.x  (leading plain atom, still unchanged)', () => {
      pin(compound([el('.m'), is(sellist([el('.a'), el('.b')])), el('.c'), el('.x')]), compound([el('.a'), el('.c')]), el('.d'), false, '.m:is(.a,.b).c.x');
    });
    it(':is(.a,.b).c.x find .c.a FULL → :is(.a,.b).c.x  (out-of-order find, unchanged)', () => {
      pin(compound([is(sellist([el('.a'), el('.b')])), el('.c'), el('.x')]), compound([el('.c'), el('.a')]), el('.d'), false, ':is(.a,.b).c.x');
    });
  });

  describe('13. OR-find (selector-list find) — rung 4, class 3', () => {
    // A `sellist` find matches a target branch via the FIRST find branch that matches THAT branch
    // (oracle-verified). extendWith is appended ONCE overall for full matches, never per find branch.
    it('.a.b find (.a,.b) partial → :is(.a,.d).b  (first find branch `.a` fires; `.b` ignored)', () => {
      pin(compound([el('.a'), el('.b')]), sellist([el('.a'), el('.b')]), el('.d'), true, ':is(.a,.d).b');
    });
    it('.a.b find (.a,.b) FULL → .a.b  (neither find branch is a whole-compound match)', () => {
      pin(compound([el('.a'), el('.b')]), sellist([el('.a'), el('.b')]), el('.d'), false, '.a.b');
    });
    it('.a find (.q,.a) FULL → .a,.d  (non-matching branch skipped, `.a` fires)', () => {
      pin(el('.a'), sellist([el('.q'), el('.a')]), el('.d'), false, '.a,.d');
    });
    it('.a,.z find (.a,.z) FULL → .a,.z,.d  (both target branches full-match; extendWith appended once)', () => {
      pin(sellist([el('.a'), el('.z')]), sellist([el('.a'), el('.z')]), el('.d'), false, '.a,.z,.d');
    });
    it('.a.x,.b.y find (.a,.b) partial → :is(.a,.d).x,:is(.b,.d).y  (per-branch first-match wrap)', () => {
      pin(sellist([compound([el('.a'), el('.x')]), compound([el('.b'), el('.y')])]), sellist([el('.a'), el('.b')]), el('.d'), true, ':is(.a,.d).x,:is(.b,.d).y');
    });
    it('.a .b find (.a,.b) partial → :is(.a,.d) .b  (complex seq, first branch `.a`)', () => {
      pin(sel([el('.a'), co(' '), el('.b')]), sellist([el('.a'), el('.b')]), el('.d'), true, ':is(.a,.d) .b');
    });
    it('.x find (.a,.b) partial → NOT_FOUND  (no find branch matches)', () => {
      pin(el('.x'), sellist([el('.a'), el('.b')]), el('.d'), true, 'NOT_FOUND');
    });
  });

  describe('14. multi-compound find against a graft-bearing target — rung 4, class 4', () => {
    // Clean WHOLE-span side-by-side match: each find compound fully consumes its aligned target
    // compound (plain multiset-equal, or a single find atom = a whole BARE `:is` branch), combinators
    // match → target branch UNCHANGED, extendWith appended as a sibling (both modes, oracle-verified).
    it(':is(.a,.b) .c find .a .c partial → :is(.a,.b) .c,.d', () => {
      pin(sel([is(sellist([el('.a'), el('.b')])), co(' '), el('.c')]), sel([el('.a'), co(' '), el('.c')]), el('.d'), true, ':is(.a,.b) .c,.d');
    });
    it(':is(.a,.b) .c find .a .c FULL → :is(.a,.b) .c,.d', () => {
      pin(sel([is(sellist([el('.a'), el('.b')])), co(' '), el('.c')]), sel([el('.a'), co(' '), el('.c')]), el('.d'), false, ':is(.a,.b) .c,.d');
    });
    it('.x :is(.a,.b) find .x .a partial → .x :is(.a,.b),.d  (graft at tail)', () => {
      pin(sel([el('.x'), co(' '), is(sellist([el('.a'), el('.b')]))]), sel([el('.x'), co(' '), el('.a')]), el('.d'), true, '.x :is(.a,.b),.d');
    });
    it(':is(.a,.b) .c find .b .c partial → :is(.a,.b) .c,.d  (matches the OTHER branch `.b`)', () => {
      pin(sel([is(sellist([el('.a'), el('.b')])), co(' '), el('.c')]), sel([el('.b'), co(' '), el('.c')]), el('.d'), true, ':is(.a,.b) .c,.d');
    });
    it(':is(.a,.b)>.c find .a>.c partial → :is(.a,.b)>.c,.d  (child combinator preserved)', () => {
      pin(sel([is(sellist([el('.a'), el('.b')])), co('>'), el('.c')]), sel([el('.a'), co('>'), el('.c')]), el('.d'), true, ':is(.a,.b)>.c,.d');
    });
    it(':is(.a,.b) .c find .a .c FULL ext (.d,.e) → :is(.a,.b) .c,.d,.e  (extendWith list appended)', () => {
      pin(sel([is(sellist([el('.a'), el('.b')])), co(' '), el('.c')]), sel([el('.a'), co(' '), el('.c')]), sellist([el('.d'), el('.e')]), false, ':is(.a,.b) .c,.d,.e');
    });
  });

  describe('15. multi-compound :is-graft EXPANSION — rung 5', () => {
    // A MULTI-compound find crossing a BARE single-`:is` compound (`:is(.a,.b)` in its own slot),
    // where the alignment is NOT the clean rung-4 whole-span-full. The oracle expands the `:is` into
    // one sibling branch per arm (splicing the arm's compounds into the slot), then runs the plain
    // multi-compound extend per expanded branch. PARTIAL folds per arm (substring `:is`-wrap or
    // whole-span remainder sibling-split, hoisted to the tail); FULL emits expanded branches unchanged
    // and appends extendWith ONCE iff the graft was multi-arm. All oracle-derived + pinned.
    const t = (): Selector => sel([el('.x'), co(' '), is(sellist([el('.a'), el('.b')])), co(' '), el('.c')]);
    const fac = (): Selector => sel([el('.a'), co(' '), el('.c')]);

    it('.x :is(.a,.b) .c f .a .c FULL → expand + append', () => {
      pin(t(), fac(), el('.d'), false, '.x .a .c,.x .b .c,.d');
    });
    it('.x :is(.a,.b) .c f .a .c PARTIAL → matching arm :is-wrapped in place', () => {
      pin(t(), fac(), el('.d'), true, '.x :is(.a .c,.d),.x .b .c');
    });
    it('.x :is(.a,.b) .c f .b .c PARTIAL → SECOND arm wrapped (order preserved)', () => {
      pin(t(), sel([el('.b'), co(' '), el('.c')]), el('.d'), true, '.x .a .c,.x :is(.b .c,.d)');
    });
    it('.x :is(.a,.b) .c f .q .c → NOT_FOUND (neither arm matches)', () => {
      pin(t(), sel([el('.q'), co(' '), el('.c')]), el('.d'), false, 'NOT_FOUND');
      pin(t(), sel([el('.q'), co(' '), el('.c')]), el('.d'), true, 'NOT_FOUND');
    });
    it('.x :is(.a) .c f .a .c FULL → single-arm expands, NO through-graft append', () => {
      pin(sel([el('.x'), co(' '), is(sellist([el('.a')])), co(' '), el('.c')]), fac(), el('.d'), false, '.x .a .c');
    });
    it('.x :is(.a) .c f .a .c PARTIAL → single-arm :is-wrap', () => {
      pin(sel([el('.x'), co(' '), is(sellist([el('.a')])), co(' '), el('.c')]), fac(), el('.d'), true, '.x :is(.a .c,.d)');
    });
    it('.x :is(.a,.b,.e) .c f .a .c FULL → 3-arm expand + append', () => {
      pin(sel([el('.x'), co(' '), is(sellist([el('.a'), el('.b'), el('.e')])), co(' '), el('.c')]), fac(), el('.d'), false, '.x .a .c,.x .b .c,.x .e .c,.d');
    });
    it('.x :is(.a,.b,.e) .c f .a .c PARTIAL → first arm wrapped, rest unchanged', () => {
      pin(sel([el('.x'), co(' '), is(sellist([el('.a'), el('.b'), el('.e')])), co(' '), el('.c')]), fac(), el('.d'), true, '.x :is(.a .c,.d),.x .b .c,.x .e .c');
    });
    it(':is(.a,.b) .c.x f .a .c FULL → remainder tail, expand + append', () => {
      pin(sel([is(sellist([el('.a'), el('.b')])), co(' '), compound([el('.c'), el('.x')])]), fac(), el('.d'), false, '.a .c.x,.b .c.x,.d');
    });
    it(':is(.a,.b) .c.x f .a .c PARTIAL → per-arm sibling-split, sibling hoisted to tail', () => {
      pin(sel([is(sellist([el('.a'), el('.b')])), co(' '), compound([el('.c'), el('.x')])]), fac(), el('.d'), true, '.a .c.x,.b .c.x,.x.d');
    });
    it('.p :is(.a,.b) .c.x f .a .c PARTIAL → substring :is-wrap absorbs remainder', () => {
      pin(sel([el('.p'), co(' '), is(sellist([el('.a'), el('.b')])), co(' '), compound([el('.c'), el('.x')])]), fac(), el('.d'), true, '.p :is(.a .c.x,.d),.p .b .c.x');
    });
    it(':is(.a .m,.b) .c f .a .m .c → multi-compound arm splices', () => {
      const tgt = (): Selector => sel([is(sellist([sel([el('.a'), co(' '), el('.m')]), el('.b')])), co(' '), el('.c')]);
      const f = (): Selector => sel([el('.a'), co(' '), el('.m'), co(' '), el('.c')]);
      pin(tgt(), f(), el('.d'), false, '.a .m .c,.b .c,.d');
      pin(tgt(), f(), el('.d'), true, '.a .m .c,.b .c,.d');
    });
    it('.x>:is(.a,.b)>.c f .a>.c → child combinators preserved through expansion', () => {
      const tgt = (): Selector => sel([el('.x'), co('>'), is(sellist([el('.a'), el('.b')])), co('>'), el('.c')]);
      const f = (): Selector => sel([el('.a'), co('>'), el('.c')]);
      pin(tgt(), f(), el('.d'), false, '.x>.a>.c,.x>.b>.c,.d');
      pin(tgt(), f(), el('.d'), true, '.x>:is(.a>.c,.d),.x>.b>.c');
    });
    it('.x :is(.a,.b) .c .z f .a .c PARTIAL → mid-substring wrap in matching arm', () => {
      pin(sel([el('.x'), co(' '), is(sellist([el('.a'), el('.b')])), co(' '), el('.c'), co(' '), el('.z')]), fac(), el('.d'), true, '.x :is(.a .c,.d) .z,.x .b .c .z');
    });
    it('ext list .x :is(.a,.b) .c f .a .c FULL → all ext branches appended', () => {
      pin(t(), fac(), sellist([el('.d'), el('.e')]), false, '.x .a .c,.x .b .c,.d,.e');
    });
    it('ext list .x :is(.a,.b) .c f .a .c PARTIAL → ext folds into matching arm :is', () => {
      pin(t(), fac(), sellist([el('.d'), el('.e')]), true, '.x :is(.a .c,.d,.e),.x .b .c');
    });

    // SCOPE (fail-loud / distinct paths): a 2nd graft the find must cross → UNSUPPORTED (oracle
    // NOT_FOUND, but proving it needs the expansion-then-fail machinery → prefer fail-loud).
    it('.x :is(.a,.b) :is(.p,.q) f .a .p → UNSUPPORTED (2nd graft in span)', () => {
      pin(sel([el('.x'), co(' '), is(sellist([el('.a'), el('.b')])), co(' '), is(sellist([el('.p'), el('.q')]))]), sel([el('.a'), co(' '), el('.p')]), el('.d'), false, 'UNSUPPORTED');
    });
  });

  describe('11. remainder-splitting (multi-compound partial with an unmatched remainder)', () => {
    // WHOLE span → SIBLING-SPLIT: original branch unchanged + one sibling built from the LAST
    // spanned compound's remainder merged into extendWith's head compound.
    it('.a>.b.c find .a>.b partial → .a>.b.c,.c.d (sibling, last-compound remainder)', () => {
      pin(sel([el('.a'), co('>'), compound([el('.b'), el('.c')])]), sel([el('.a'), co('>'), el('.b')]), el('.d'), true, '.a>.b.c,.c.d');
    });
    it('.a>.b.c find .a>.b ext .d.e → .a>.b.c,.c.d.e (remainder into ext head compound)', () => {
      pin(sel([el('.a'), co('>'), compound([el('.b'), el('.c')])]), sel([el('.a'), co('>'), el('.b')]), compound([el('.d'), el('.e')]), true, '.a>.b.c,.c.d.e');
    });
    it('.a>.b.c find .a>.b ext .d>.e → .a>.b.c,.c.d>.e (remainder into ext HEAD, >.e kept)', () => {
      pin(sel([el('.a'), co('>'), compound([el('.b'), el('.c')])]), sel([el('.a'), co('>'), el('.b')]), sel([el('.d'), co('>'), el('.e')]), true, '.a>.b.c,.c.d>.e');
    });
    it('.a>.b.c.x find .a>.b → .a>.b.c.x,.c.x.d (multi-atom remainder)', () => {
      pin(sel([el('.a'), co('>'), compound([el('.b'), el('.c'), el('.x')])]), sel([el('.a'), co('>'), el('.b')]), el('.d'), true, '.a>.b.c.x,.c.x.d');
    });
    it('.a.x>.b find .a>.b → .a.x>.b,.x.d (remainder on FIRST compound, last fully matched)', () => {
      pin(sel([compound([el('.a'), el('.x')]), co('>'), el('.b')]), sel([el('.a'), co('>'), el('.b')]), el('.d'), true, '.a.x>.b,.x.d');
    });
    it('.a.x>.b.y find .a>.b → .a.x>.b.y,.y.d (rem in first AND last → only the LAST)', () => {
      pin(sel([compound([el('.a'), el('.x')]), co('>'), compound([el('.b'), el('.y')])]), sel([el('.a'), co('>'), el('.b')]), el('.d'), true, '.a.x>.b.y,.y.d');
    });
    it('.a.m>.b.n>.c find .a>.b>.c → .a.m>.b.n>.c,.n.d (middle-remainder → last spanned rem compound)', () => {
      pin(sel([compound([el('.a'), el('.m')]), co('>'), compound([el('.b'), el('.n')]), co('>'), el('.c')]), sel([el('.a'), co('>'), el('.b'), co('>'), el('.c')]), el('.d'), true, '.a.m>.b.n>.c,.n.d');
    });
    it('.a .b.c find .a .b → .a .b.c,.c.d (descendant combinator; sibling bare, no combinator)', () => {
      pin(sel([el('.a'), co(' '), compound([el('.b'), el('.c')])]), sel([el('.a'), co(' '), el('.b')]), el('.d'), true, '.a .b.c,.c.d');
    });
    // extendWith LIST: remainder merges into FIRST branch only; remaining branches appended verbatim.
    it('.a>.b.c find .a>.b ext (.d,.e) → .a>.b.c,.c.d,.e', () => {
      pin(sel([el('.a'), co('>'), compound([el('.b'), el('.c')])]), sel([el('.a'), co('>'), el('.b')]), sellist([el('.d'), el('.e')]), true, '.a>.b.c,.c.d,.e');
    });
    it('.a>.b.c find .a>.b ext (.d>.f,.e) → .a>.b.c,.c.d>.f,.e', () => {
      pin(sel([el('.a'), co('>'), compound([el('.b'), el('.c')])]), sel([el('.a'), co('>'), el('.b')]), sellist([sel([el('.d'), co('>'), el('.f')]), el('.e')]), true, '.a>.b.c,.c.d>.f,.e');
    });
    // extendWith :is(...) is NOT flattened into the sibling: `.c:is(.d,.e)`.
    it('.a>.b.c find .a>.b ext :is(.d,.e) → .a>.b.c,.c:is(.d,.e)', () => {
      pin(sel([el('.a'), co('>'), compound([el('.b'), el('.c')])]), sel([el('.a'), co('>'), el('.b')]), is(sellist([el('.d'), el('.e')])), true, '.a>.b.c,.c:is(.d,.e)');
    });

    // PROPER-SUBSTRING span → :is()-WRAP (compound before the span kept, span wrapped as-authored).
    it('div+.a.c.b>.y.x find .a.b>.x → div+:is(.a.c.b>.y.x,.q) (substring → :is-wrap)', () => {
      pin(sel([el('div'), co('+'), compound([el('.a'), el('.c'), el('.b')]), co('>'), compound([el('.y'), el('.x')])]), sel([compound([el('.a'), el('.b')]), co('>'), el('.x')]), el('.q'), true, 'div+:is(.a.c.b>.y.x,.q)');
    });
    it('div+.a.c.b>.y.x find .a.b>.x ext (.d,.e) → div+:is(.a.c.b>.y.x,.d,.e) (list flattens into :is arg)', () => {
      pin(sel([el('div'), co('+'), compound([el('.a'), el('.c'), el('.b')]), co('>'), compound([el('.y'), el('.x')])]), sel([compound([el('.a'), el('.b')]), co('>'), el('.x')]), sellist([el('.d'), el('.e')]), true, 'div+:is(.a.c.b>.y.x,.d,.e)');
    });
  });

  // RUNG 8 — closed by the full-corpus sweep (differential vs the oracle over the whole reachable
  // extend suite). Each case is a real divergence the sweep surfaced; the fix is pinned here.
  describe('16. full-corpus sweep (rung 8)', () => {
    // FULL-mode append DEDUPES: extendWith already a target branch → no duplicate OR-branch.
    it('.base,.child f .base e .child → .base,.child (dedup, no dup branch)', () => {
      pin(sellist([sel([el('.base')]), sel([el('.child')])]), el('.base'), el('.child'), false, '.base,.child');
    });
    it('.x,.y,.z f .z e .x → .x,.y,.z (dedup, .x already present)', () => {
      pin(sellist([sel([el('.x')]), sel([el('.y')]), sel([el('.z')])]), el('.z'), el('.x'), false, '.x,.y,.z');
    });
    it('.w f .w e .w → .w (FULL self-extend no-op)', () => {
      pin(sel([el('.w')]), el('.w'), el('.w'), false, '.w');
    });
    it('.btn:hover f .btn:hover e .btn:hover → .btn:hover (FULL self-extend no-op)', () => {
      pin(sel([compound([el('.btn'), pseudo({ name: ':hover' })])]), sel([compound([el('.btn'), pseudo({ name: ':hover' })])]), sel([compound([el('.btn'), pseudo({ name: ':hover' })])]), false, '.btn:hover');
    });
    // Control: extendWith NOT present → append fires normally.
    it('.a,.b f .b e .c → .a,.b,.c (control, append fires)', () => {
      pin(sellist([sel([el('.a')]), sel([el('.b')])]), el('.b'), el('.c'), false, '.a,.b,.c');
    });

    // DUP-FIND multiset: `.e.e` (2 atoms, 1 sym) needs the target to carry `.e` twice.
    it('.e f .e.e e .dbl FULL → NOT_FOUND (target has one .e, find needs two)', () => {
      pin(sel([el('.e')]), compound([el('.e'), el('.e')]), el('.dbl'), false, 'NOT_FOUND');
    });
    it('.e f .e.e e .dbl PARTIAL → NOT_FOUND', () => {
      pin(sel([el('.e')]), compound([el('.e'), el('.e')]), el('.dbl'), true, 'NOT_FOUND');
    });
    it('.e.e f .e.e e .dbl FULL → .e.e,.dbl (target supplies both .e)', () => {
      pin(compound([el('.e'), el('.e')]), compound([el('.e'), el('.e')]), el('.dbl'), false, '.e.e,.dbl');
    });

    // FULL-mode bare-`:is` graft appends ONLY when it is the WHOLE selector.
    it(':is(.dd,.ee) f .dd e .ff FULL → :is(.dd,.ee,.ff) (whole selector → append)', () => {
      pin(sel([is(sellist([sel([el('.dd')]), sel([el('.ee')])]))]), el('.dd'), el('.ff'), false, ':is(.dd,.ee,.ff)');
    });
    it('.aa :is(.dd,.ee) f .dd e .ff FULL → .aa :is(.dd,.ee) (graft not whole selector → unchanged)', () => {
      pin(sel([el('.aa'), co(' '), is(sellist([sel([el('.dd')]), sel([el('.ee')])]))]), el('.dd'), el('.ff'), false, '.aa :is(.dd,.ee)');
    });
    it('.aa :is(.dd,.ee) f .dd e .ff PARTIAL → .aa :is(.dd,.ee,.ff) (partial still wraps)', () => {
      pin(sel([el('.aa'), co(' '), is(sellist([sel([el('.dd')]), sel([el('.ee')])]))]), el('.dd'), el('.ff'), true, '.aa :is(.dd,.ee,.ff)');
    });

    // Single-arm `:is` with a MULTI-compound arm is kept wrapped on a full through-match.
    it('d :is(.b .c) f .b .c e .a FULL → d :is(.b .c) (multi-compound arm not unwrapped)', () => {
      pin(sel([el('d'), co(' '), is(sellist([sel([el('.b'), co(' '), el('.c')])]))]), sel([el('.b'), co(' '), el('.c')]), el('.a'), false, 'd :is(.b .c)');
    });

    // Graft target, find matches NOTHING → NOT_FOUND (not the unchanged target).
    it(':is(.foo,.bar) .baz f .aa FULL → NOT_FOUND (no match anywhere)', () => {
      pin(sel([is(sellist([sel([el('.foo')]), sel([el('.bar')])])), co(' '), el('.baz')]), el('.aa'), el('.cc'), false, 'NOT_FOUND');
    });

    // Element/ID conflict → UNSUPPORTED (fail-loud; own engine does not build conflict validation).
    it('a.info f .info e div.foo PARTIAL → UNSUPPORTED (element conflict)', () => {
      pin(compound([el('a'), el('.info')]), el('.info'), compound([el('div'), el('.foo')]), true, 'UNSUPPORTED');
    });
    it('#main.info f .info e #other.foo PARTIAL → UNSUPPORTED (id conflict)', () => {
      pin(compound([el('#main'), el('.info')]), el('.info'), compound([el('#other'), el('.foo')]), true, 'UNSUPPORTED');
    });
    // Control: same element type → no conflict, wrap builds.
    it('a.info f .info e a.foo PARTIAL → a:is(.info,a.foo) (same element, no conflict)', () => {
      pin(compound([el('a'), el('.info')]), el('.info'), compound([el('a'), el('.foo')]), true, 'a:is(.info,a.foo)');
    });

    // Exact-mode cartesian de-distribution (oracle compacts to :is()) → UNSUPPORTED (not built).
    it('.a .b,.a .d,.c .b f .c .b e .c .d FULL → UNSUPPORTED (cartesian de-distribution)', () => {
      pin(sellist([sel([el('.a'), co(' '), el('.b')]), sel([el('.a'), co(' '), el('.d')]), sel([el('.c'), co(' '), el('.b')])]), sel([el('.c'), co(' '), el('.b')]), sel([el('.c'), co(' '), el('.d')]), false, 'UNSUPPORTED');
    });

    // Graft arm with an INTERNAL non-space combinator → UNSUPPORTED (flatten not built).
    it(':is(.p+.q) .r f .p .r e .x FULL → UNSUPPORTED (arm has + combinator)', () => {
      pin(sel([is(sellist([sel([el('.p'), co('+'), el('.q')])])), co(' '), el('.r')]), sel([el('.p'), co(' '), el('.r')]), el('.x'), false, 'UNSUPPORTED');
    });
  });

  // RUNG 9 residuals — the last own-engine UNSUPPORTED-with-oracle-output classes the rung-8 sweep
  // enumerated (reached only from synthetic unit tests, never a real render). Each derived from the
  // oracle on the exact sweep tuples + hardcode-pinned. See EXTEND-INDEX-DESIGN.md rung 9.
  describe('17. rung-9 residual classes', () => {
    // (1) DISTINCT-PARENT `&&` passenger — two amps with DIFFERENT resolved parents in one compound.
    // A CHILD-ONLY match (find confined to the compound's genuinely-child atom, disjoint from every
    // resolved parent) is order-independent: recurse the resolved form (parents ride as passengers,
    // spliced AT their `&` positions so order is faithful). Any parent contact → NOT_FOUND.
    const ampAmp = (): Selector => compound([ampWith(compound([el('.foo'), el('.bar')])), ampWith(el('.baz')), el('.suffix')]);
    it('&(.foo.bar)&(.baz).suffix f .suffix e .extended PARTIAL → .foo.bar.baz:is(.suffix,.extended)', () => {
      pin(ampAmp(), el('.suffix'), el('.extended'), true, '.foo.bar.baz:is(.suffix,.extended)');
    });
    it('&(.foo.bar)&(.baz).suffix f .suffix e .extended FULL → .foo.bar.baz.suffix (subset → unchanged)', () => {
      pin(ampAmp(), el('.suffix'), el('.extended'), false, '.foo.bar.baz.suffix');
    });
    it('&(.foo.bar)&(.baz).suffix f .baz e .extended PARTIAL → NOT_FOUND (parent-only)', () => {
      pin(ampAmp(), el('.baz'), el('.extended'), true, 'NOT_FOUND');
    });
    it('&(.foo.bar)&(.baz).suffix f .foo e .extended PARTIAL → NOT_FOUND (parent-only)', () => {
      pin(ampAmp(), el('.foo'), el('.extended'), true, 'NOT_FOUND');
    });
    it('&(.foo.bar)&(.baz).suffix f .foo.suffix e .extended PARTIAL → NOT_FOUND (crossing)', () => {
      pin(ampAmp(), compound([el('.foo'), el('.suffix')]), el('.extended'), true, 'NOT_FOUND');
    });

    // (2) FIND-SIDE GRAFT, WHOLE-SELECTOR match — a find carrying a `:where`/`:not`/`:has`/multi-arm
    // `:is` graft equal to a whole target branch → append extendWith (deduped). Single-arm `:is`
    // (needs the oracle's unwrap on output) and non-whole-branch shapes stay UNSUPPORTED (unreached).
    it(':where(.a) f :where(.a) e .b FULL → :where(.a),.b (the reachable sweep tuple)', () => {
      pin(where(el('.a')), where(el('.a')), el('.b'), false, ':where(.a),.b');
    });
    it(':where(.a) f :where(.a) e .b PARTIAL → :where(.a),.b (whole-match append in both modes)', () => {
      pin(where(el('.a')), where(el('.a')), el('.b'), true, ':where(.a),.b');
    });
    it(':where(.a,.b) f :where(.a,.b) e .c FULL → :where(.a,.b),.c (multi-arm)', () => {
      pin(where(sellist([el('.a'), el('.b')])), where(sellist([el('.a'), el('.b')])), el('.c'), false, ':where(.a,.b),.c');
    });
    it('.a:not(.b) f .a:not(.b) e .c FULL → .a:not(.b),.c', () => {
      pin(compound([el('.a'), not(el('.b'))]), compound([el('.a'), not(el('.b'))]), el('.c'), false, '.a:not(.b),.c');
    });
    it(':is(.b,.d) f :is(.b,.d) e .c FULL → :is(.b,.d),.c (multi-arm is, no unwrap)', () => {
      pin(is(sellist([el('.b'), el('.d')])), is(sellist([el('.b'), el('.d')])), el('.c'), false, ':is(.b,.d),.c');
    });
    it(':where(.a) f :where(.a) e :where(.a) FULL → :where(.a) (self-extend dedupes)', () => {
      pin(where(el('.a')), where(el('.a')), where(el('.a')), false, ':where(.a)');
    });
    it('.a:is(.b) f .a:is(.b) e .c FULL → UNSUPPORTED (single-arm :is unwrap not built)', () => {
      pin(compound([el('.a'), is(sellist([el('.b')]))]), compound([el('.a'), is(sellist([el('.b')]))]), el('.c'), false, 'UNSUPPORTED');
    });

    // (3) MULTI-GRAFT-IN-BOTH-SLOTS, find wholly absent → definite NOT_FOUND (find sym absent from the
    // target's full sym superset). Was UNSUPPORTED (multi-graft fail-loud); now the correct NOT_FOUND.
    it(':is(.a,.b) :is(.p,.q) f .x .y e .d PARTIAL → NOT_FOUND (find absent everywhere)', () => {
      pin(sel([is(sellist([el('.a'), el('.b')])), co(' '), is(sellist([el('.p'), el('.q')]))]), sel([el('.x'), co(' '), el('.y')]), el('.d'), true, 'NOT_FOUND');
    });
  });

  describe('18. rung-6 FIND-SIDE `&` (resolve the find amp, then extend the plain find)', () => {
    // A find carrying `&` is resolved the same way a `&` TARGET is: an UNRESOLVED amp matches no
    // concrete compound (oracle NOT_FOUND); a RESOLVED amp becomes a plain find the engine builds.
    it('UNRESOLVED &.x find, .a.x target FULL → NOT_FOUND (bare & matches nothing)', () => {
      pin(compound([el('.a'), el('.x')]), compound([amp(), el('.x')]), el('.y'), false, 'NOT_FOUND');
    });
    it('UNRESOLVED &.x find, .a.x target PARTIAL → NOT_FOUND', () => {
      pin(compound([el('.a'), el('.x')]), compound([amp(), el('.x')]), el('.y'), true, 'NOT_FOUND');
    });
    it('UNRESOLVED "& .foo" descendant find → NOT_FOUND', () => {
      pin(sel([el('.p'), co(' '), el('.foo')]), sel([amp(), co(' '), el('.foo')]), el('.y'), true, 'NOT_FOUND');
    });
    it('UNRESOLVED bare & find → NOT_FOUND', () => {
      pin(el('.a'), amp(), el('.y'), true, 'NOT_FOUND');
    });
    it('RESOLVED &.x (&=.foo), .foo.x target FULL → .foo.x,.y (resolves to .foo.x, matches, appends)', () => {
      pin(compound([el('.foo'), el('.x')]), compound([ampWith(el('.foo')), el('.x')]), el('.y'), false, '.foo.x,.y');
    });
    it('RESOLVED &.x (&=.foo), .foo.x target PARTIAL → .foo.x,.y', () => {
      pin(compound([el('.foo'), el('.x')]), compound([ampWith(el('.foo')), el('.x')]), el('.y'), true, '.foo.x,.y');
    });
    it('RESOLVED &.x (&=.foo), .bar.x target PARTIAL → NOT_FOUND (resolved .foo.x absent)', () => {
      pin(compound([el('.bar'), el('.x')]), compound([ampWith(el('.foo')), el('.x')]), el('.y'), true, 'NOT_FOUND');
    });
    // Byte-identical to the oracle across the same shapes.
    it('resolved &-find agrees with oracle (differential)', () => {
      same(() => ({ target: compound([el('.foo'), el('.x')]), find: compound([ampWith(el('.foo')), el('.x')]), extendWith: el('.y'), partial: false }));
      same(() => ({ target: compound([el('.foo'), el('.x')]), find: compound([ampWith(el('.foo')), el('.x')]), extendWith: el('.y'), partial: true }));
    });
  });
});
