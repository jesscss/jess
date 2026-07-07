/**
 * COPY of the reachable `&` (ampersand) cases from extend-ampersand.test.ts / -boundary, driven
 * through the OWN-CONSTRUCTION engine. Each `extendSelector(...)` is routed through `extendViaOwn`,
 * which byte-compares the own engine to the oracle (throws on MISMATCH) and records UNSUPPORTED
 * otherwise.
 *
 * `&` subjects are built with `ampWith(parent)` — the post-eval Ampersand shape the engine sees
 * (an `Ampersand` node holding a parent REFERENCE via `_selectorContainer.selector`), which is
 * exactly what nested Less source composes to post-eval. NOT a hand-built leading-combinator or
 * detached amp (those are non-reachable per the design methodology).
 *
 * Derived rule (probe-verified): the `&` extend OUTPUT equals extending the amp's RESOLVED FORM at
 * the same `partial` flag, with a parent-only NOT_FOUND gate — see `extendAmpersandTarget`.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { el, sel, compound, co } from '../../../index.js';
import { Ampersand } from '../../ampersand.js';
import { extendViaOwn, reportFrontier, resetFrontier } from './corpus-harness.js';

function ampWith(selector: any): Ampersand {
  const created = Ampersand.create({ selectorContainer: { selector } });
  return created as Ampersand;
}

describe('CORPUS (own engine): Extend `&` (ampersand)', () => {
  resetFrontier();
  afterAll(() => reportFrontier('ampersand-cases'));

  // ── CROSSING → HOIST (find spans parent + child) ──────────────────────────
  it('&.bar crossing (partial) → .foo.bar,.a', () => {
    const r = extendViaOwn(
      compound([ampWith(el('.foo')), el('.bar')]),
      compound([el('.foo'), el('.bar')]), el('.a'), true, '&.bar cross partial'
    );
    expect(r.valueOf()).toBe('.foo.bar,.a');
  });

  it('&.bar crossing (full) → .foo.bar,.a', () => {
    const r = extendViaOwn(
      compound([ampWith(el('.foo')), el('.bar')]),
      compound([el('.foo'), el('.bar')]), el('.a'), false, '&.bar cross full'
    );
    expect(r.valueOf()).toBe('.foo.bar,.a');
  });

  it('&.bar crossing, find atoms out of order → .foo.bar,.x', () => {
    const r = extendViaOwn(
      compound([ampWith(el('.foo')), el('.bar')]),
      compound([el('.bar'), el('.foo')]), el('.x'), true, '&.bar cross reordered'
    );
    expect(r.valueOf()).toBe('.foo.bar,.x');
  });

  it('leading & .b crossing (partial) → .foo .b,.x', () => {
    const r = extendViaOwn(
      sel([ampWith(el('.foo')), co(' '), el('.b')]),
      sel([el('.foo'), co(' '), el('.b')]), el('.x'), true, '& .b cross partial'
    );
    expect(r.valueOf()).toBe('.foo .b,.x');
  });

  it('leading & .b crossing (full) → .foo .b,.x', () => {
    const r = extendViaOwn(
      sel([ampWith(el('.foo')), co(' '), el('.b')]),
      sel([el('.foo'), co(' '), el('.b')]), el('.x'), false, '& .b cross full'
    );
    expect(r.valueOf()).toBe('.foo .b,.x');
  });

  it('interior .b > & crossing (partial) → .b>.foo,.x', () => {
    const r = extendViaOwn(
      sel([el('.b'), co('>'), ampWith(el('.foo'))]),
      sel([el('.b'), co('>'), el('.foo')]), el('.x'), true, '.b>& cross partial'
    );
    expect(r.valueOf()).toBe('.b>.foo,.x');
  });

  it('&& crossing (partial) → .e.e,.dbl', () => {
    const r = extendViaOwn(
      compound([ampWith(el('.e')), ampWith(el('.e'))]),
      compound([el('.e'), el('.e')]), el('.dbl'), true, '&& cross partial'
    );
    expect(r.valueOf()).toBe('.e.e,.dbl');
  });

  it('&& crossing (full) → .e.e,.dbl', () => {
    const r = extendViaOwn(
      compound([ampWith(el('.e')), ampWith(el('.e'))]),
      compound([el('.e'), el('.e')]), el('.dbl'), false, '&& cross full'
    );
    expect(r.valueOf()).toBe('.e.e,.dbl');
  });

  it('&&(.foo.bar)(.baz).suffix passenger child-only → .foo.bar.baz:is(.suffix,.extended)', () => {
    const r = extendViaOwn(
      compound([ampWith(compound([el('.foo'), el('.bar')])), ampWith(el('.baz')), el('.suffix')]),
      el('.suffix'), el('.extended'), true, '&& passenger .suffix partial'
    );
    expect(r.valueOf()).toBe('.foo.bar.baz:is(.suffix,.extended)');
  });

  // ── CHILD-ONLY → IN-PLACE (find matches only the child material) ──────────
  it('&.bar child-only (partial) → .foo:is(.bar,.extended)', () => {
    const r = extendViaOwn(
      compound([ampWith(el('.foo')), el('.bar')]),
      el('.bar'), el('.extended'), true, '&.bar child partial'
    );
    expect(r.valueOf()).toBe('.foo:is(.bar,.extended)');
  });

  it('&.bar child-only (full) → .foo.bar (subset, unchanged)', () => {
    const r = extendViaOwn(
      compound([ampWith(el('.foo')), el('.bar')]),
      el('.bar'), el('.extended'), false, '&.bar child full'
    );
    expect(r.valueOf()).toBe('.foo.bar');
  });

  it('leading & .b child-only (partial) → .foo :is(.b,.x)', () => {
    const r = extendViaOwn(
      sel([ampWith(el('.foo')), co(' '), el('.b')]),
      el('.b'), el('.x'), true, '& .b child partial'
    );
    expect(r.valueOf()).toBe('.foo :is(.b,.x)');
  });

  it('&.keep child-only preserves parent (partial) → .parent:is(.keep,.extra)', () => {
    const r = extendViaOwn(
      compound([ampWith(el('.parent')), el('.keep')]),
      el('.keep'), el('.extra'), true, '&.keep child partial'
    );
    expect(r.valueOf()).toBe('.parent:is(.keep,.extra)');
  });

  // ── PARENT-ONLY → NOT_FOUND (find matches only the parent portion) ────────
  it('&.bar parent-only (partial) → NOT_FOUND', () => {
    const r = extendViaOwn(
      compound([ampWith(el('.foo')), el('.bar')]),
      el('.foo'), el('.x'), true, '&.bar parent-only partial'
    );
    expect(r).toBe('NOT_FOUND');
  });

  it('&.bar parent-only (full) → NOT_FOUND', () => {
    const r = extendViaOwn(
      compound([ampWith(el('.foo')), el('.bar')]),
      el('.foo'), el('.x'), false, '&.bar parent-only full'
    );
    expect(r).toBe('NOT_FOUND');
  });

  it('leading & .b parent-only (partial) → NOT_FOUND', () => {
    const r = extendViaOwn(
      sel([ampWith(el('.foo')), co(' '), el('.b')]),
      el('.foo'), el('.x'), true, '& .b parent-only partial'
    );
    expect(r).toBe('NOT_FOUND');
  });

  it('interior .b > & parent-only (partial) → NOT_FOUND', () => {
    const r = extendViaOwn(
      sel([el('.b'), co('>'), ampWith(el('.foo'))]),
      el('.foo'), el('.x'), true, '.b>& parent-only partial'
    );
    expect(r).toBe('NOT_FOUND');
  });
});

/**
 * LEADING-COMBINATOR RELATIVE `&` (rung 7). A nested RELATIVE rule (`.parent { > &.child {} }`)
 * composes post-eval to a ComplexSelector whose FIRST component is a combinator. The oracle takes
 * its `shouldSkipRelativePartialBoundary` path: re-target on the amp-RESOLVED form KEEPING the
 * leading combinator, then in-place `:is`-wrap. Rung 6's plain resolved-form recursion dropped the
 * combinator + used the wrong wrap-span; rung 7 builds the combinator-preserving wrap.
 *
 * Subjects are the reachable post-eval shape (a leading combinator + a compound carrying the
 * `Ampersand` node with its parent reference), exactly what nested relative Less source composes to.
 */
describe('CORPUS (own engine): leading-combinator relative `&`', () => {
  resetFrontier();
  afterAll(() => reportFrontier('relative-ampersand-cases'));

  const child = () => sel([co('>'), compound([ampWith(el('.parent')), el('.child')])]);

  // ── CROSSING (find spans the amp compound) → wrap WHOLE compound, keep the combinator ──
  it('> &.child f .parent.child (partial) → >:is(.parent.child,.new)', () => {
    const r = extendViaOwn(child(), compound([el('.parent'), el('.child')]), el('.new'), true, '> &.child cross partial');
    expect(r.valueOf()).toBe('>:is(.parent.child,.new)');
  });
  it('> &.child f .parent.child (FULL) → >.parent.child (unchanged)', () => {
    const r = extendViaOwn(child(), compound([el('.parent'), el('.child')]), el('.new'), false, '> &.child cross full');
    expect(r.valueOf()).toBe('>.parent.child');
  });
  it('+ &.child f .parent.child (partial) → +:is(.parent.child,.new)', () => {
    const r = extendViaOwn(
      sel([co('+'), compound([ampWith(el('.parent')), el('.child')])]),
      compound([el('.parent'), el('.child')]), el('.new'), true, '+ &.child cross partial'
    );
    expect(r.valueOf()).toBe('+:is(.parent.child,.new)');
  });

  // ── CHILD-ONLY (simple child atom) → wrap that atom in place, keep the combinator ──
  it('> &.child f .child (partial) → >.parent:is(.child,.new)', () => {
    const r = extendViaOwn(child(), el('.child'), el('.new'), true, '> &.child child partial');
    expect(r.valueOf()).toBe('>.parent:is(.child,.new)');
  });
  it('> &.child f .child (FULL) → >.parent.child (subset, unchanged)', () => {
    const r = extendViaOwn(child(), el('.child'), el('.new'), false, '> &.child child full');
    expect(r.valueOf()).toBe('>.parent.child');
  });

  // ── PARENT-ONLY (embedded amp) → NOT_FOUND (both modes) ──
  it('> &.child f .parent (partial) → NOT_FOUND', () => {
    const r = extendViaOwn(child(), el('.parent'), el('.new'), true, '> &.child parent-only partial');
    expect(r).toBe('NOT_FOUND');
  });
  it('> &.child f .parent (FULL) → NOT_FOUND', () => {
    const r = extendViaOwn(child(), el('.parent'), el('.new'), false, '> &.child parent-only full');
    expect(r).toBe('NOT_FOUND');
  });

  // ── LONE amp then descendant child (`> & .b`): parent is its own step, NO parent gate ──
  const lone = () => sel([co('>'), ampWith(el('.parent')), co(' '), el('.b')]);
  it('> & .b f .parent .b (partial) → >:is(.parent .b,.x)', () => {
    const r = extendViaOwn(lone(), sel([el('.parent'), co(' '), el('.b')]), el('.x'), true, '> & .b whole partial');
    expect(r.valueOf()).toBe('>:is(.parent .b,.x)');
  });
  it('> & .b f .b (child-only partial) → >.parent :is(.b,.x)', () => {
    const r = extendViaOwn(lone(), el('.b'), el('.x'), true, '> & .b child partial');
    expect(r.valueOf()).toBe('>.parent :is(.b,.x)');
  });
  it('> & .b f .parent (partial, lone amp → NOT parent-only) → >:is(.parent,.x) .b', () => {
    const r = extendViaOwn(lone(), el('.parent'), el('.x'), true, '> & .b parent partial');
    expect(r.valueOf()).toBe('>:is(.parent,.x) .b');
  });

  // ── EMBEDDED amp with a SEPARATE amp atom + child (`> &(.p1.p2).c`) ──
  const m2 = () => sel([co('>'), compound([ampWith(compound([el('.p1'), el('.p2')])), el('.c')])]);
  it('> &(.p1.p2).c f .p1.p2 (partial, amp-unit) → >:is(.p1.p2,.n).c', () => {
    const r = extendViaOwn(m2(), compound([el('.p1'), el('.p2')]), el('.n'), true, '> &(.p1.p2).c amp-unit');
    expect(r.valueOf()).toBe('>:is(.p1.p2,.n).c');
  });
  it('> &(.p1.p2).c f .c (partial, child-only) → >.p1.p2:is(.c,.n)', () => {
    const r = extendViaOwn(m2(), el('.c'), el('.n'), true, '> &(.p1.p2).c child');
    expect(r.valueOf()).toBe('>.p1.p2:is(.c,.n)');
  });
  it('> &(.p1.p2).c f .p1 (partial, proper-subset parent) → NOT_FOUND', () => {
    const r = extendViaOwn(m2(), el('.p1'), el('.n'), true, '> &(.p1.p2).c proper-subset');
    expect(r).toBe('NOT_FOUND');
  });
  it('> &(.p1.p2).c f .p1.c (partial, proper-subset parent + child) → NOT_FOUND', () => {
    const r = extendViaOwn(m2(), compound([el('.p1'), el('.c')]), el('.n'), true, '> &(.p1.p2).c subset+child');
    expect(r).toBe('NOT_FOUND');
  });
});
