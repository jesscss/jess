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
import { el, sel, sellist, compound, is, co, pseudo, type Selector } from '../../../index.js';
import { extendSelector } from '../../util/extend.js';
import { extendByIndexOwn, UNSUPPORTED } from '../extend-index.js';

const not = (arg: Selector): Selector => pseudo({ name: ':not', arg }) as unknown as Selector;
const where = (arg: Selector): Selector => pseudo({ name: ':where', arg }) as unknown as Selector;
const has = (arg: Selector): Selector => pseudo({ name: ':has', arg }) as unknown as Selector;

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
    it(':is(.a,.b).c find .a.c PARTIAL → UNSUPPORTED (boundary-cross flatten, not built yet)', () => {
      pin(compound([is(sellist([el('.a'), el('.b')])), el('.c')]), compound([el('.a'), el('.c')]), el('.d'), true, 'UNSUPPORTED');
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
});
