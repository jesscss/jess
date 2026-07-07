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
