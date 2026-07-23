import { describe, expect, it } from 'vitest';
import { branchText, descendantBranch, mkBranch } from '../extend/ir.js';
import type { Branch, Simple } from '../extend/ir.js';
import { appendDeduped } from '../extend/match.js';
import { buildContribs, groupInstructions } from '../extend/solve.js';
import type { Contrib, ContribMap } from '../extend/solve.js';
import type { PlanInstruction } from '../extend/plan.js';

/**
 * Isolated unit tests for the three pure pieces of INCREMENT A of the extend-matcher
 * redesign (fold-all-in-one-pass). Each function is exercised directly, without the
 * serializer/plan pipeline, so a failure localizes to the piece:
 *   - `mkBranch` / `branchText`  — the pre-declared branch-key cache (ir.ts).
 *   - `groupInstructions`         — folding by `(partial, hidden, target)` (solve.ts).
 *   - `appendDeduped`             — the once-per-pass whole-branch append dedup (match.ts).
 */

/** A single-segment descendant branch of one text simple (e.g. `.base`). */
const textBranch = (text: string): Branch => descendantBranch([{ t: 'text', text } as Simple]);

const inst = (
  target: string,
  partial: boolean,
  extender: string,
  extenderHidden = false,
  order = 0
): PlanInstruction => ({
  target: textBranch(target),
  partial,
  extenderPath: [[textBranch(extender)]],
  scope: [],
  order,
  extenderHidden,
  referenceBoundary: null
});

describe('branch-key cache (mkBranch / branchText)', () => {
  it('mkBranch pre-declares `key` as an own property initialized undefined', () => {
    const b = mkBranch([{ comb: ' ', compound: { simples: [{ t: 'text', text: '.a' }] } }]);
    // One stable hidden class: every branch is born `{ segs, key }`, so the memo
    // write below is an in-place store, never a `{segs}`->`{segs,key}` transition.
    expect(Object.keys(b)).toEqual(['segs', 'key']);
    expect(Object.hasOwn(b, 'key')).toBe(true);
    expect(b.key).toBeUndefined();
  });

  it('branchText computes once, stores the result on `key`, and reads it back', () => {
    const b = textBranch('.foo');
    expect(b.key).toBeUndefined();
    const first = branchText(b);
    expect(first).toBe('.foo');
    // The result is memoized onto the pre-declared field...
    expect(b.key).toBe('.foo');
    // ...and a second call returns the SAME cached string identity.
    expect(branchText(b)).toBe(first);
  });

  it('branchText returns the cached `key` verbatim (proves the memo is load-bearing)', () => {
    const b = textBranch('.real');
    branchText(b); // prime the cache
    b.key = 'CACHED'; // tamper the memo only
    expect(branchText(b)).toBe('CACHED');
  });
});

describe('groupInstructions — fold by (partial, hidden, target)', () => {
  it('folds instructions with the same match condition into one group, extenders in document order', () => {
    const instructions = [inst('.base', false, '.x0', false, 0), inst('.base', false, '.x1', false, 1)];
    const groups = groupInstructions(instructions, buildContribs(instructions));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.partial).toBe(false);
    expect(groups[0]!.extenderHidden).toBe(false);
    expect(groups[0]!.targetKey).toBe('.base');
    // Concatenated in incoming (document) order so the folded append order is
    // byte-identical to firing the instructions one-per-round.
    expect(groups[0]!.extenders.map(branchText)).toEqual(['.x0', '.x1']);
    expect([...groups[0]!.keys].sort()).toEqual(['.x0', '.x1']);
  });

  it('does NOT merge exact vs partial on the same target text', () => {
    const instructions = [inst('.base', false, '.x', false, 0), inst('.base', true, '.y', false, 1)];
    const groups = groupInstructions(instructions, buildContribs(instructions));
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.partial)).toEqual([false, true]);
  });

  it('does NOT merge visible vs hidden extends on the same target text', () => {
    const instructions = [inst('.base', false, '.v', false, 0), inst('.base', false, '.h', true, 1)];
    const groups = groupInstructions(instructions, buildContribs(instructions));
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.extenderHidden)).toEqual([false, true]);
  });

  it('groups distinct targets separately, first-seen document order preserved', () => {
    const instructions = [
      inst('.a', false, '.x', false, 0),
      inst('.b', false, '.y', false, 1),
      inst('.a', false, '.z', false, 2)
    ];
    const groups = groupInstructions(instructions, buildContribs(instructions));
    expect(groups.map(g => g.targetKey)).toEqual(['.a', '.b']);
    expect(groups[0]!.extenders.map(branchText)).toEqual(['.x', '.z']);
    expect(groups[1]!.extenders.map(branchText)).toEqual(['.y']);
  });

  it('drops a no-op instruction (no extenders, not partial) from every group', () => {
    const noop = inst('.base', false, '.ignored', false, 0);
    // Force an empty-extender contrib for the no-op, exactly the shape the old
    // per-instruction guard skipped.
    const contribs: ContribMap = new Map<PlanInstruction, Contrib>([
      [noop, { extenders: [], keys: new Set<string>(), targetAtoms: new Set(['.base']) }]
    ]);
    expect(groupInstructions([noop], contribs)).toHaveLength(0);
  });
});

describe('appendDeduped — whole-branch append dedup', () => {
  it('appends only branches whose text is not already present, mutating out + present', () => {
    const out = [textBranch('.a')];
    const present = new Set(out.map(branchText));
    const added = appendDeduped(out, [textBranch('.b'), textBranch('.a'), textBranch('.c'), textBranch('.b')], present);
    expect(added).toBe(true);
    expect(out.map(branchText)).toEqual(['.a', '.b', '.c']);
    expect([...present].sort()).toEqual(['.a', '.b', '.c']);
  });

  it('returns false and leaves out unchanged when every append is already present', () => {
    const out = [textBranch('.a'), textBranch('.b')];
    const present = new Set(out.map(branchText));
    expect(appendDeduped(out, [textBranch('.a'), textBranch('.b')], present)).toBe(false);
    expect(out.map(branchText)).toEqual(['.a', '.b']);
  });

  it('returns false for an empty append list', () => {
    const out = [textBranch('.a')];
    expect(appendDeduped(out, [], new Set(['.a']))).toBe(false);
  });
});
