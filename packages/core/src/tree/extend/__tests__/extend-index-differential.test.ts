/**
 * Differential oracle test for the prototype index-driven extend engine.
 *
 * For each case, run BOTH:
 *   - `extendSelector`  (ORACLE — the existing walk)
 *   - `extendByIndex`   (the prototype under test)
 * on IDENTICAL inputs and assert their stringified results are equal.
 *
 * See docs/future/core-architecture/EXTEND-INDEX-DESIGN.md §Build plan (case ladder).
 * Add cases ONE rung at a time; each new case tells you which layer is missing.
 */
import { describe, it, expect } from 'vitest';
import { el, sel, sellist, compound, is, co, type Selector } from '../../../index.js';
import { Ampersand } from '../../ampersand.js';
import { F_IMPLICIT_AMPERSAND } from '../../node.js';
import { extendSelector } from '../../util/extend.js';
import { extendByIndex } from '../extend-index.js';

/** Ampersand whose parent-reference (graft target) is `parent`; `implicit` sets the nesting flag. */
function ampWith(parent: Selector, implicit = false): Ampersand {
  const created = Ampersand.create({ selectorContainer: { selector: parent } });
  if (!(created instanceof Ampersand)) {
    throw new Error('expected Ampersand');
  }
  if (implicit) {
    created.generated = true;
    created.addFlag(F_IMPLICIT_AMPERSAND);
  }
  return created;
}

type Input = Parameters<typeof extendSelector>[0];
type Result = ReturnType<typeof extendSelector>;

/** Stringify a result (Selector | list array | error string) exactly like the caller compares. */
function str(v: Result): string {
  if (typeof v === 'string') {
    return v;
  }
  if (Array.isArray(v)) {
    return v.map(s => String(typeof s === 'string' ? s : (s.valueOf?.() ?? s))).join(',');
  }
  return String(v.valueOf?.() ?? v);
}

/**
 * Fresh builders per assertion: extend mutates via inherit/adopt on placement copies,
 * and the two engines must NOT share input nodes (the oracle run would perturb the
 * index run). Each case supplies a THUNK returning fresh (target, find, extendWith).
 */
function assertSame(
  make: () => { target: Input; find: Selector; extendWith: Selector; partial: boolean }
): void {
  const a = make();
  const oracle = extendSelector(a.target, a.find, a.extendWith, a.partial);
  const b = make();
  const mine = extendByIndex(b.target, b.find, b.extendWith, b.partial);
  expect(str(mine)).toBe(str(oracle));
}

describe('extend-index differential (vs extendSelector oracle)', () => {
  // ── Case 1: exact single compound ──────────────────────────────────────
  describe('1. exact single compound', () => {
    it('.a extend .b (full)', () => {
      assertSame(() => ({ target: el('.a'), find: el('.a'), extendWith: el('.b'), partial: false }));
    });
    it('.a NOT_FOUND against .z', () => {
      assertSame(() => ({ target: el('.a'), find: el('.z'), extendWith: el('.b'), partial: false }));
    });
    it('exact compound .a.b extend .c (full)', () => {
      assertSame(() => ({
        target: compound([el('.a'), el('.b')]),
        find: compound([el('.a'), el('.b')]),
        extendWith: el('.c'),
        partial: false
      }));
    });
  });

  // ── Case 1b: compound is a SET — order-independent match, order-preserving output ──
  describe('1b. compound set semantics (order-free match, order/slot-preserving output)', () => {
    it('(a) .a.b find .b.a matches (order-independent, full)', () => {
      assertSame(() => ({
        target: compound([el('.a'), el('.b')]),
        find: compound([el('.b'), el('.a')]),
        extendWith: el('.c'),
        partial: false
      }));
    });
    it('(b) .b.a find .a partial → extender in matched slot, source order preserved', () => {
      assertSame(() => ({
        target: compound([el('.b'), el('.a')]),
        find: el('.a'),
        extendWith: el('.x'),
        partial: true
      }));
    });
    it('(b) .b.a.c find .a partial → slot preservation across 3 atoms', () => {
      assertSame(() => ({
        target: compound([el('.b'), el('.a'), el('.c')]),
        find: el('.a'),
        extendWith: el('.x'),
        partial: true
      }));
    });
  });

  // ── Case 1c: DUPLICATES — ordered list keeps dupes, match-bitset dedupes ──
  // Matching is set-CONTAINMENT (not multiset): .b.b.c matches exactly the finds .b.c does.
  // Output must round-trip dupes verbatim; the substitution slot rule is oracle-defined.
  describe('1c. duplicate atoms (set-containment match, dup-preserving output)', () => {
    it('(match) .b.b.c find .b.c full → matches (dupe in target ignored by bitset)', () => {
      assertSame(() => ({
        target: compound([el('.b'), el('.b'), el('.c')]),
        find: compound([el('.b'), el('.c')]),
        extendWith: el('.x'),
        partial: false
      }));
    });
    it('(find dupe) .b.c find .b.b → oracle treats find .b.b as {b} (confirm)', () => {
      assertSame(() => ({
        target: compound([el('.b'), el('.c')]),
        find: compound([el('.b'), el('.b')]),
        extendWith: el('.x'),
        partial: false
      }));
    });
    it('(substitution) .b.b.c find .b partial extend .x → oracle-defined slot(s)', () => {
      assertSame(() => ({
        target: compound([el('.b'), el('.b'), el('.c')]),
        find: el('.b'),
        extendWith: el('.x'),
        partial: true
      }));
    });
    it('(dup output round-trip) .b.b.c find .z NOT_FOUND (dupes untouched)', () => {
      assertSame(() => ({
        target: compound([el('.b'), el('.b'), el('.c')]),
        find: el('.z'),
        extendWith: el('.x'),
        partial: false
      }));
    });
  });

  // ── Case 2: subset in a compound (all / full) ──────────────────────────
  describe('2. subset in a compound', () => {
    it('.b.c find .b full → NOT extended (partial-only match)', () => {
      assertSame(() => ({
        target: compound([el('.b'), el('.c')]),
        find: el('.b'),
        extendWith: el('.q'),
        partial: false
      }));
    });
    it('.b.c find .b partial → :is(.b,.q).c', () => {
      assertSame(() => ({
        target: compound([el('.b'), el('.c')]),
        find: el('.b'),
        extendWith: el('.q'),
        partial: true
      }));
    });
  });

  // ── Case 3: position in a sequence ─────────────────────────────────────
  describe('3. position in a sequence', () => {
    it('.x .b find .b partial', () => {
      assertSame(() => ({
        target: sel([el('.x'), co(' '), el('.b')]),
        find: el('.b'),
        extendWith: el('.c'),
        partial: true
      }));
    });
    it('.a > .b find .b partial', () => {
      assertSame(() => ({
        target: sel([el('.a'), co('>'), el('.b')]),
        find: el('.b'),
        extendWith: el('.c'),
        partial: true
      }));
    });
    it('.x .b find .z NOT_FOUND', () => {
      assertSame(() => ({
        target: sel([el('.x'), co(' '), el('.b')]),
        find: el('.z'),
        extendWith: el('.c'),
        partial: true
      }));
    });
  });

  // ── Case 4: multi-compound sequence find ───────────────────────────────
  describe('4. multi-compound sequence find', () => {
    it('.x .b find .x .b full → .x .b, ext', () => {
      assertSame(() => ({
        target: sel([el('.x'), co(' '), el('.b')]),
        find: sel([el('.x'), co(' '), el('.b')]),
        extendWith: el('.c'),
        partial: false
      }));
    });
    it('.a > .b > .c find .a > .b partial', () => {
      assertSame(() => ({
        target: sel([el('.a'), co('>'), el('.b'), co('>'), el('.c')]),
        find: sel([el('.a'), co('>'), el('.b')]),
        extendWith: el('.q'),
        partial: true
      }));
    });
    it('combinator mismatch: .a > .b find .a .b NOT_FOUND', () => {
      assertSame(() => ({
        target: sel([el('.a'), co('>'), el('.b')]),
        find: sel([el('.a'), co(' '), el('.b')]),
        extendWith: el('.q'),
        partial: false
      }));
    });
  });

  // ── Case 5: :is() graft + head-wall ────────────────────────────────────
  describe('5. :is() seam', () => {
    it(':is(.a,.b) find .a full → :is(.a,.b,.c)', () => {
      assertSame(() => ({
        target: is(sellist([el('.a'), el('.b')])),
        find: el('.a'),
        extendWith: el('.c'),
        partial: false
      }));
    });
    it('.a > .b find .b partial → .a>:is(.b,.c)', () => {
      assertSame(() => ({
        target: sel([el('.a'), co('>'), el('.b')]),
        find: el('.b'),
        extendWith: el('.c'),
        partial: true
      }));
    });
    it('.a > .b.c find .b partial → .a>:is(.b,.d).c', () => {
      assertSame(() => ({
        target: sel([el('.a'), co('>'), compound([el('.b'), el('.c')])]),
        find: el('.b'),
        extendWith: el('.d'),
        partial: true
      }));
    });
    it(':is(a).info find .info full → unchanged (partial-only within compound)', () => {
      assertSame(() => ({
        target: compound([is(el('a')), el('.info')]),
        find: el('.info'),
        extendWith: compound([el('div'), el('.foo')]),
        partial: false
      }));
    });
    it(':is() extendWith extracted: .foo find .foo extend :is(.ext3,.ext4)', () => {
      assertSame(() => ({
        target: el('.foo'),
        find: el('.foo'),
        extendWith: is(sellist([el('.ext3'), el('.ext4')])),
        partial: false
      }));
    });
  });

  // ── Case 6: & seams (child-only / crossing→hoist / parent-only→drop) ────
  // extendByIndex OWNS the classification: a two-probe IR differential (find matches the
  // parent-grafted RESOLVED form ∧ NOT the amp-dropped EMPTY form ⇒ crossing) plus the
  // decision gates surfaced by PROBE (see extend-index.ts §`&` SEAM and the report).
  describe('6. ampersand seam', () => {
    it('.a > .b > .c find .a > .c NOT contiguous → :is span or NOT_FOUND (oracle-defined)', () => {
      assertSame(() => ({
        target: sel([el('.a'), co('>'), el('.b'), co('>'), el('.c')]),
        find: sel([el('.a'), co('>'), el('.c')]),
        extendWith: el('.q'),
        partial: true
      }));
    });

    // CROSSING → HOIST: &.bar (parent .foo), find .foo.bar → the find matches only the
    // parent-grafted form ⇒ hoist to root: `.foo.bar,\n.a`.
    it('(cross) &.bar[.foo] find .foo.bar partial → hoist', () => {
      assertSame(() => ({
        target: compound([ampWith(el('.foo')), el('.bar')]),
        find: compound([el('.foo'), el('.bar')]),
        extendWith: el('.a'),
        partial: true
      }));
    });
    it('(cross) &.bar[.foo] find .foo.bar FULL → hoist', () => {
      assertSame(() => ({
        target: compound([ampWith(el('.foo')), el('.bar')]),
        find: compound([el('.foo'), el('.bar')]),
        extendWith: el('.a'),
        partial: false
      }));
    });

    // CHILD-ONLY → in-place: find matches the amp-dropped form (.bar) ⇒ extend the child
    // material only, amp preserved: `.foo:is(.bar, .a)` (amp renders as its resolved value).
    it('(child) &.bar[.foo] find .bar partial → in-place :is()', () => {
      assertSame(() => ({
        target: compound([ampWith(el('.foo')), el('.bar')]),
        find: el('.bar'),
        extendWith: el('.a'),
        partial: true
      }));
    });

    // NOTE: the former "relative-partial gate" cases (a hand-built `> &.child` subject — a
    // root-level leading-`>` ComplexSelector) were PURGED: that is not a reachable/well-formed
    // input (a real `.parent { > &.child }` composes to `.parent > .parent.child` or lives
    // nested; a dangling-`>` standalone never reaches extend). See EXTEND-INDEX-DESIGN.md
    // "Gate 1 (WITHDRAWN)" + the reachable-inputs METHODOLOGY note.

    // IMPLICIT `& .b` (parent .a): crossing (find .a .b matches only grafted form) → hoist.
    it('(cross) implicit & .b[.a] find .a .b partial → hoist', () => {
      assertSame(() => ({
        target: sel([ampWith(el('.a'), true), co(' '), el('.b')]),
        find: sel([el('.a'), co(' '), el('.b')]),
        extendWith: el('.ext'),
        partial: true
      }));
    });
    it('(cross) implicit & .b[.a] find .a .b FULL → hoist', () => {
      assertSame(() => ({
        target: sel([ampWith(el('.a'), true), co(' '), el('.b')]),
        find: sel([el('.a'), co(' '), el('.b')]),
        extendWith: el('.ext'),
        partial: false
      }));
    });
    // IMPLICIT `& .b` child-only: find .b matches the amp-dropped form → in-place: `.a :is(.b, .ext)`.
    it('(child) implicit & .b[.a] find .b partial → in-place', () => {
      assertSame(() => ({
        target: sel([ampWith(el('.a'), true), co(' '), el('.b')]),
        find: el('.b'),
        extendWith: el('.ext'),
        partial: true
      }));
    });

    // PARENT-ONLY GATE: &.bar[.foo] find .foo — find matches ONLY the parent, not child .bar.
    // Simple-find full & partial-no-whole-location both collapse to NOT_FOUND (parent carries it).
    it('(parent-only) &.bar[.foo] find .foo full → NOT_FOUND', () => {
      assertSame(() => ({
        target: compound([ampWith(el('.foo')), el('.bar')]),
        find: el('.foo'),
        extendWith: el('.ext'),
        partial: false
      }));
    });
    it('(parent-only) &.bar[.foo] find .foo partial → NOT_FOUND', () => {
      assertSame(() => ({
        target: compound([ampWith(el('.foo')), el('.bar')]),
        find: el('.foo'),
        extendWith: el('.ext'),
        partial: true
      }));
    });
  });

  // ── Case 7: all vs partial ─────────────────────────────────────────────
  describe('7. all/partial vs exact', () => {
    it('.a.b find .a full → unchanged (partial-only)', () => {
      assertSame(() => ({
        target: compound([el('.a'), el('.b')]),
        find: el('.a'),
        extendWith: el('.c'),
        partial: false
      }));
    });
    it('.a.b find .a partial → :is(.a,.c).b', () => {
      assertSame(() => ({
        target: compound([el('.a'), el('.b')]),
        find: el('.a'),
        extendWith: el('.c'),
        partial: true
      }));
    });
  });

  // ── Case 8: chained fixpoint (target→ext→target) ───────────────────────
  // extendByIndex is the single-shot primitive; chain it manually and compare to the
  // oracle chained the same way. (Full worklist fixpoint lives in applyExtendsToSelector;
  // here we prove the primitive composes identically step-for-step.)
  describe('8. chained fixpoint (manual composition)', () => {
    it('.a →(.a→.b) →(.b→.c)', () => {
      const step = (
        engine: (t: Input, f: Selector, e: Selector, p: boolean) => Result
      ): string => {
        const r1 = engine(sellist([el('.a')]), el('.a'), el('.b'), false);
        const t1: Input = typeof r1 === 'string'
          ? sellist([el('.a')])
          : (Array.isArray(r1) ? sellist(r1) : r1);
        const r2 = engine(t1, el('.b'), el('.c'), false);
        return str(r2);
      };
      expect(step(extendByIndex)).toBe(step(extendSelector));
    });
  });

  // ── Case 9: deeper nesting ──────────────────────────────────────────────
  describe('9. deep nesting', () => {
    it('.a > .b .c find .c partial', () => {
      assertSame(() => ({
        target: sel([el('.a'), co('>'), el('.b'), co(' '), el('.c')]),
        find: el('.c'),
        extendWith: el('.z'),
        partial: true
      }));
    });
    it('.a .b > .c .d find .b > .c partial (interior 2-compound find)', () => {
      assertSame(() => ({
        target: sel([el('.a'), co(' '), el('.b'), co('>'), el('.c'), co(' '), el('.d')]),
        find: sel([el('.b'), co('>'), el('.c')]),
        extendWith: el('.z'),
        partial: true
      }));
    });
  });

  // ── NOT_FOUND independence: discovery gate must reject on its own ───────
  describe('discovery gate independence (NOT_FOUND)', () => {
    it(':is(.a,.b) find .z NOT_FOUND (grafted symbols, none match)', () => {
      assertSame(() => ({
        target: is(sellist([el('.a'), el('.b')])),
        find: el('.z'),
        extendWith: el('.c'),
        partial: false
      }));
    });
    it('.x .b find .x .z NOT_FOUND (second compound absent)', () => {
      assertSame(() => ({
        target: sel([el('.x'), co(' '), el('.b')]),
        find: sel([el('.x'), co(' '), el('.z')]),
        extendWith: el('.c'),
        partial: false
      }));
    });
  });

  // ── SelectorList discovery ─────────────────────────────────────────────
  describe('selector list', () => {
    it('.btn,.link find .btn full', () => {
      assertSame(() => ({
        target: sellist([el('.btn'), el('.link')]),
        find: el('.btn'),
        extendWith: el('.primary'),
        partial: false
      }));
    });
  });
});
