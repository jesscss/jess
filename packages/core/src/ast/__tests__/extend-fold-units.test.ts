import { describe, expect, it } from 'vitest';
import { branchText, descendantBranch, mkBranch, multisetEqual } from '../extend/ir.js';
import type { Branch, SelectorPart, Simple } from '../extend/ir.js';
import type { Combinator } from '../node.js';
import { appendDeduped, branchWholeMatch } from '../extend/match.js';

/** Exact-mode whole-branch equivalence: the unified matcher in its non-`all` form.
 *  These INCREMENT-B assertions pin the exact decision (reordered compounds match,
 *  consume-ALL, aligned combinators, interp-empty parity, graft opacity). */
const branchExactEquivalent = (b: Branch, target: Branch): boolean => branchWholeMatch(b, target, false);
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
  it('mkBranch pre-declares `key` and `bnd` as own properties initialized undefined', () => {
    const b = mkBranch([{ combinator: ' ', compound: { value: [{ t: 'text', text: '.a' }] } }]);

    /*
     * One stable hidden class: every branch is born `{ segments, key, bnd }`, so the memo
     * write below (and any later `bnd` origin store) is an in-place store, never a
     * `{segments}`->`{segments,key}`->`{segments,key,bnd}` transition.
     */
    expect(Object.keys(b)).toEqual(['segments', 'key', 'bnd']);
    expect(Object.hasOwn(b, 'key')).toBe(true);
    expect(b.key).toBeUndefined();
    expect(Object.hasOwn(b, 'bnd')).toBe(true);
    expect(b.bnd).toBeUndefined();
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

    /*
     * Concatenated in incoming (document) order so the folded append order is
     * byte-identical to firing the instructions one-per-round.
     */
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

    /*
     * Force an empty-extender contrib for the no-op, exactly the shape the old
     * per-instruction guard skipped.
     */
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

/**
 * Isolated unit tests for INCREMENT B — the pure exact-mode WHOLE-branch equivalence
 * predicate (`branchExactEquivalent`) and the multiset-EQUALITY primitive it rests on.
 * Exercised directly on the flat `Branch` IR, so a failure localizes to the predicate
 * rather than the serializer/plan pipeline. Covers the three landmines the exact
 * decision must honor: reordered compounds match, a strict subset (consume-ALL) does
 * NOT, and a combinator mismatch does NOT.
 */

/** A one-segment branch of N text tokens (a single compound `.b.c` = ['.b','.c']). */
const compoundBranch = (...texts: string[]): Branch =>
  mkBranch([{ combinator: ' ', compound: { value: texts.map((text): Simple => ({ t: 'text', text })) } }]);

/** A complex branch: each `[combinator, ...tokens]` tuple is one segment. */
const complexBranch = (...segments: [Combinator, ...string[]][]): Branch =>
  mkBranch(segments.map(([combinator, ...texts]): SelectorPart => ({
    combinator,
    compound: { value: texts.map((text): Simple => ({ t: 'text', text })) }
  })));

describe('multiset equality (multisetEqual)', () => {
  it('is true for a reordered multiset', () => {
    expect(multisetEqual(['.b', '.c'], ['.c', '.b'])).toBe(true);
  });

  it('is false for a strict subset (unequal counts)', () => {
    expect(multisetEqual(['.b', '.b', '.c'], ['.b', '.c'])).toBe(false);
    expect(multisetEqual(['.b', '.c'], ['.b', '.b', '.c'])).toBe(false);
  });

  it('is false when an element differs', () => {
    expect(multisetEqual(['.a', '.b'], ['.a', '.c'])).toBe(false);
  });

  it('respects repeated-element counts', () => {
    expect(multisetEqual(['.a', '.a', '.b'], ['.a', '.b', '.a'])).toBe(true);
    expect(multisetEqual(['.a', '.a', '.b'], ['.a', '.b', '.b'])).toBe(false);
  });
});

describe('exact-mode whole-branch equivalence (branchExactEquivalent)', () => {
  it('matches a reordered compound (the fixed correctness bug)', () => {
    // `.b.c` ≡ `.c.b` — order of value is irrelevant (EXTEND_RULES §0).
    expect(branchExactEquivalent(compoundBranch('.b', '.c'), compoundBranch('.c', '.b'))).toBe(true);
  });

  it('matches an identical single-simple branch (string-equality parity)', () => {
    expect(branchExactEquivalent(compoundBranch('.base'), compoundBranch('.base'))).toBe(true);
  });

  it('rejects a consume-ALL subset (`.b.b.c` is not `.b.c`)', () => {
    expect(branchExactEquivalent(compoundBranch('.b', '.b', '.c'), compoundBranch('.b', '.c'))).toBe(false);
    expect(branchExactEquivalent(compoundBranch('.b', '.c'), compoundBranch('.b', '.b', '.c'))).toBe(false);
  });

  it('rejects a combinator mismatch (`.a .b` is not `.a > .b`)', () => {
    const descendant = complexBranch([' ', '.a'], [' ', '.b']);
    const child = complexBranch([' ', '.a'], ['>', '.b']);
    const adjacent = complexBranch([' ', '.a'], ['+', '.b']);
    expect(branchExactEquivalent(descendant, child)).toBe(false);
    expect(branchExactEquivalent(descendant, adjacent)).toBe(false);
    expect(branchExactEquivalent(child, adjacent)).toBe(false);
  });

  it('matches a multi-segment branch with per-segment reordering and aligned combinators', () => {
    // `.a.b > .c.d` ≡ `.b.a > .d.c`.
    const a = complexBranch([' ', '.a', '.b'], ['>', '.c', '.d']);
    const b = complexBranch([' ', '.b', '.a'], ['>', '.d', '.c']);
    expect(branchExactEquivalent(a, b)).toBe(true);
  });

  it('rejects a differing segment count', () => {
    expect(branchExactEquivalent(compoundBranch('.a'), complexBranch([' ', '.a'], [' ', '.b']))).toBe(false);
  });

  it('fast-accepts equal serializations even when a simple renders empty (interp-empty parity)', () => {
    /*
     * `.a@{x}` renders value ['.a', ''] but serializes to '.a' (the interpolated
     * simple contributes no text). The old `bKey === targetKey` matched it against
     * `.a`; the branchText fast-accept preserves that (true strict superset), where a
     * bare structural multiset check would wrongly drop it on the length guard.
     */
    const withEmpty = compoundBranch('.a', '');
    const plain = compoundBranch('.a');
    expect(branchText(withEmpty)).toBe(branchText(plain)); // both serialize to '.a'
    expect(branchExactEquivalent(withEmpty, plain)).toBe(true);
  });

  it('keeps an `:is()` graft opaque (a graft-bearing compound is not equal to its bare simple)', () => {
    const bare = compoundBranch('.a');
    const grafted = mkBranch([{
      combinator: ' ',
      compound: { value: [{ t: 'text', text: '.a' }, { t: 'is', branches: [compoundBranch('.b')] }] }
    }]);
    expect(branchExactEquivalent(bare, grafted)).toBe(false);
  });
});
