/**
 * [plugin/P1] Scope-frame-aware function registry — the load-bearing seam in
 * isolation. Exercises visibility (a scoped `Fn` resolves only in the frame that
 * registers it and its descendants), shadowing (nearest frame wins over an ancestor
 * and over a same-name global built-in), and the idle-path guarantee (a null/omitted
 * scope takes the pre-P1 global path). All with ZERO plugin/module loading — native
 * `Fn` specs are seeded directly onto hand-built `Frame`s.
 */
import { describe, it, expect } from 'vitest';
import { makeFnScope, type Frame } from '../../serialize.js';
import { buildEvaluator } from '../../evaluator.js';
import { createFnRegistry } from '../../value-dispatch.js';
import { makeKeyword } from '../../value-factory.js';
import { DEFAULT_MODES, type List } from '../../value-eval.js';
import type { Fn } from '../../functions/types.js';

const emptyList = (): List => ({ type: 'List', items: [], sep: ',', bytes: '' });

/** A native variadic `Fn` returning a fixed keyword (no arg handling needed). */
const scopedFn = (name: string, out: string): Fn => ({
  name,
  params: [],
  variadic: true,
  body: () => makeKeyword(out),
});

/** Build a `Frame` with an optional scoped-fn map (keys lower-cased, as callers do). */
const frame = (parent: Frame | null, fns: Record<string, Fn> | null): Frame => ({
  parent,
  mixins: null,
  vars: null,
  fns: fns ? new Map(Object.entries(fns).map(([k, v]) => [k.toLowerCase(), v])) : null,
});

describe('[plugin/P1] scope-frame function registry', () => {
  it('resolves a function only within the frame that registers it (and descendants)', () => {
    const fn = scopedFn('scoped', 'scoped');
    const root = frame(null, null);
    const mid = frame(root, null);
    const leaf = frame(mid, { scoped: fn }); // registers here
    const descendant = frame(leaf, null); // below the registering frame
    const sibling = frame(mid, null); // beside it, no registration

    // Visible in the registering frame and anything nested under it.
    expect(makeFnScope(leaf).lookup('scoped')).toBe(fn);
    expect(makeFnScope(descendant).lookup('scoped')).toBe(fn);

    // Invisible to ancestors and to siblings — pure lexical, no subtree leak.
    expect(makeFnScope(mid).lookup('scoped')).toBeUndefined();
    expect(makeFnScope(root).lookup('scoped')).toBeUndefined();
    expect(makeFnScope(sibling).lookup('scoped')).toBeUndefined();
  });

  it('case-folds the lookup name like the global registry', () => {
    const fn = scopedFn('scoped', 'scoped');
    const leaf = frame(null, { scoped: fn });
    expect(makeFnScope(leaf).lookup('SCOPED')).toBe(fn);
    expect(makeFnScope(leaf).lookup('ScOpEd')).toBe(fn);
  });

  it('nearest frame shadows an ancestor registration (test-shadow semantics)', () => {
    const g = scopedFn('shadow', 'g');
    const l = scopedFn('shadow', 'l');
    const root = frame(null, { shadow: g });
    const local = frame(root, { shadow: l });
    const sibling = frame(root, null); // no own registration → inherits root's

    expect(makeFnScope(local).lookup('shadow')).toBe(l); // nearest wins
    expect(makeFnScope(sibling).lookup('shadow')).toBe(g); // ancestor via chain
    expect(makeFnScope(root).lookup('shadow')).toBe(g);
  });

  it('a scoped fn shadows a same-name global built-in through ev.call', () => {
    const registry = createFnRegistry();
    registry.register({ name: 'x', params: [], variadic: true, body: () => makeKeyword('global') });
    const ev = buildEvaluator(registry);

    const local = frame(null, { x: scopedFn('x', 'scoped') });
    const scoped = ev.call('x', emptyList(), DEFAULT_MODES, makeFnScope(local));
    expect(scoped).toMatchObject({ type: 'Keyword', bytes: 'scoped' });
  });

  it('idle path is untouched: null/omitted scope falls to the global registry', () => {
    const registry = createFnRegistry();
    registry.register({ name: 'x', params: [], variadic: true, body: () => makeKeyword('global') });
    const ev = buildEvaluator(registry);

    // A frame chain with NO scoped fns anywhere → scope miss → global fallback.
    const empty = frame(frame(null, null), null);

    const omitted = ev.call('x', emptyList(), DEFAULT_MODES);
    const nullScope = ev.call('x', emptyList(), DEFAULT_MODES, null);
    const missScope = ev.call('x', emptyList(), DEFAULT_MODES, makeFnScope(empty));

    expect(omitted).toMatchObject({ type: 'Keyword', bytes: 'global' });
    // Passing null, or a scope that misses, is byte-identical to omitting it.
    expect(nullScope).toEqual(omitted);
    expect(missScope).toEqual(omitted);
  });
});
