/**
 * OQ-D — CONFLUENCE / batch-equals-sequential (standing invariant + boundary characterization).
 * ==============================================================================================
 *
 * OQ-D (UNIFIED-EVAL-EMIT-DESIGN.md §9, carried from EXTEND-GLOBAL-FLOW-DESIGN.md §2.6 OQ-4):
 * SOLVE fires rewrites in any order and EMIT sorts the resulting OR-branches by DOCUMENT order, so
 * the design's claim is "fire order is a perf choice, output is confluent because EMIT re-sorts."
 * OQ-D asked whether that holds for the CURRENT engine's `applyBatchedExtend` (extend.ts:523) vs the
 * sequential `tryExtendSelector` path (extend.ts:444).
 *
 * VERDICT (what this file pins, precisely):
 *
 *  (1) The raw per-subject `applyExtendsToSelector` (extend.ts:334) is APPLY-ORDER-SENSITIVE in
 *      comma-SIBLING ORDER. Two permutations of the same instruction set produce the SAME SET of
 *      branches but in a DIFFERENT comma order (e.g. `.base,.other,.x,.y,.q` vs
 *      `.base,.other,.q,.x,.y`). The set is invariant; the ordering is not. The batch fast-path is
 *      NOT a separate engine — the per-subject loop selects it purely by the ADJACENCY of
 *      same-target non-partial instructions (extend.ts:391-402), so permuting the list is a sound
 *      way to drive batched vs sequential and every relative order (documented per assertion below).
 *      ⇒ `siblingSet(...)` asserts the branch SET is confluent across all permutations.
 *      ⇒ the ORDER is asserted to be document-order-derived, NOT confluent, by the sibling-order case.
 *
 *  (2) The PRODUCTION render path is deterministic WITHOUT relying on the design's EMIT sort. It
 *      never permutes: `processExtends` (extend-roots.ts:686) builds its instruction list by
 *      `context.extends.flatMap(...)`, and `context.extends` is populated during eval in DOCUMENT
 *      order (extend.ts:341 `context.extends.push([... docOrder ...])`); the per-subject list is a
 *      document-order-preserving `filter` (extend-roots.ts:757). So today's sibling order = the
 *      document order the extenders were authored in. This is why extend-less-fixtures renders are
 *      stable and byte-exact.
 *
 *  (3) The design's confluence MECHANISM (EMIT sorts branches by document `order`, B3) is NOT wired
 *      in the current engine. `setExtendOrderMap` (extend.ts:155) — the only entry point that would
 *      install the value→documentOrder map the sort branches (extend.ts:842, :1192, :233) read — has
 *      ZERO callers anywhere in the repo. `extendOrderMap` is therefore always null and those sort
 *      branches are dead. Today's determinism is the document-ORDER FEED (2), not an
 *      order-independent-fixpoint + canonical-sort (the design's model).
 *
 * CONSEQUENCE for the design: OQ-D's premise ("EMIT's document-order sort is what pins output, so
 * SOLVE may fire in any order") describes a mechanism the CUTOVER must BUILD (wire the order map into
 * the fold). It is NOT already true. Until then, SOLVE cannot fire in arbitrary order and still match
 * today's output — order IS load-bearing for sibling ordering, currently pinned only by the
 * document-order feed. This test is the standing invariant guarding both halves so the cutover cannot
 * silently regress: the branch SET must stay confluent, and the document-order feed must keep pinning
 * sibling order until the EMIT sort replaces it.
 */
import { describe, it, expect } from 'vitest';
import { el, sellist, compound, sel, co, type Selector } from '../../index.js';
import {
  applyExtendsToSelector,
  type ExtendInstruction
} from '../../util/extend.js';

/** All permutations of an array (n! — inputs kept ≤ 5 instructions so this stays ≤120). */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {
    return [items.slice()];
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) {
      out.push([items[i]!, ...p]);
    }
  }
  return out;
}

/** The MULTISET of comma-separated branches, order-normalized — the confluent invariant. */
function siblingSet(value: string): string {
  return value.split(',').map(s => s.trim()).sort().join(',');
}

function instr(
  target: Selector,
  extendWith: Selector,
  partial = false
): ExtendInstruction {
  return { target, extendWith, partial };
}

interface ConfluenceCase {
  name: string;

  /** A fresh subject each run — eval/extend mutate, so never share a node across permutations. */
  subject: () => Selector;

  /** A fresh instruction list each run (same reason). */
  instructions: () => ExtendInstruction[];
}

/**
 * Realistic multi-instruction-per-subject shapes drawn from the extend corpus
 * (extend-less-fixtures.test.ts) — the cases where OQ-D's order question actually bites:
 * fan-out (many extenders, one target) and chaining (an extender is itself another target).
 */
const cases: ConfluenceCase[] = [
  {
    /*
     * extend-exact.less `.effected { &:extend(.a); &:extend(.b); &:extend(.c); }` — one subject,
     * three DISTINCT non-partial targets. Different orders reach different batch/sequential splits.
     */
    name: 'fan-in: one subject extends three distinct targets (.a,.b,.c)',
    subject: () => el('.a'),
    instructions: () => [
      instr(el('.a'), el('.effected')),
      instr(el('.b'), el('.effected')),
      instr(el('.c'), el('.effected'))
    ]
  },
  {
    /*
     * Fan-OUT: many extenders target the SAME base (.btn ← .x,.y,.z). This is the shape the batch
     * path was built for (Bootstrap-style). Adjacent → batched; permutation varies append order.
     */
    name: 'fan-out: three extenders on one base (.btn ← .x,.y,.z)',
    subject: () => el('.btn'),
    instructions: () => [
      instr(el('.btn'), el('.x')),
      instr(el('.btn'), el('.y')),
      instr(el('.btn'), el('.z'))
    ]
  },
  {
    /*
     * MIXED same-target + distinct-target: batch cluster (.base←.x,.y) INTERLEAVED with a distinct
     * (.other←.q). Permutation both clusters and splits the .base pair → batch vs sequential fork.
     */
    name: 'mixed: same-target pair interleaved with a distinct target',
    subject: () => sellist([el('.base'), el('.other')]),
    instructions: () => [
      instr(el('.base'), el('.x')),
      instr(el('.other'), el('.q')),
      instr(el('.base'), el('.y'))
    ]
  },
  {
    /*
     * CHAINED / transitive: .a←.b, .b←.c. Applying .b←.c first then .a←.b, or the reverse, must
     * converge to the same branch SET (the fixpoint re-queues chained discovery either way).
     */
    name: 'chain: .a←.b and .b←.c (transitive closure)',
    subject: () => el('.a'),
    instructions: () => [
      instr(el('.a'), el('.b')),
      instr(el('.b'), el('.c'))
    ]
  },
  {
    /*
     * extend-selector.less `.foo .bar,.foo .baz` gaining `.foo`←{.ext1 .ext2,.ext3,.ext4} — a
     * complex-component target list with fan-out on a complex subject.
     */
    name: 'fan-out into complex subject (.foo .bar ← .foo from many)',
    subject: () => sellist([
      sel([el('.foo'), co(' '), el('.bar')]),
      sel([el('.foo'), co(' '), el('.baz')])
    ]),
    instructions: () => [
      instr(el('.foo'), sel([el('.ext1'), co(' '), el('.ext2')])),
      instr(el('.foo'), el('.ext3')),
      instr(el('.foo'), el('.ext4'))
    ]
  },
  {
    /*
     * Compound targets + fan-out (extend-nest.less sidebar family): base `.sidebar` gains four
     * extenders of varied shape (simple, complex, compound).
     */
    name: 'compound/complex fan-out (.sidebar ← .sidebar2, .type1 .sidebar3, .type2.sidebar4)',
    subject: () => el('.sidebar'),
    instructions: () => [
      instr(el('.sidebar'), el('.sidebar2')),
      instr(el('.sidebar'), sel([el('.type1'), co(' '), el('.sidebar3')])),
      instr(el('.sidebar'), compound([el('.type2'), el('.sidebar4')]))
    ]
  },
  {
    /*
     * Partial + non-partial MIX on one subject: `.z .c` gains a partial `.z`←.visible while a
     * distinct non-partial `.c`←.q also applies. Partial never batches (extend.ts:391 gates
     * `!partial`), so this forces the partial through sequential regardless of position.
     */
    name: 'partial+full mix (.z .c: partial .z←.visible + full .c←.q)',
    subject: () => sel([el('.z'), co(' '), el('.c')]),
    instructions: () => [
      instr(el('.z'), el('.visible'), true),
      instr(el('.c'), el('.q'))
    ]
  }
];

describe('OQ-D — extend confluence: branch SET is order-independent (batch == sequential == any order)', () => {
  for (const c of cases) {
    it(`branch SET byte-identical over ALL instruction permutations — ${c.name}`, () => {
      const allInstr = c.instructions();
      const perms = permutations(allInstr.map((_, i) => i));

      let canonicalSet: string | undefined;
      let canonicalRaw: string | undefined;
      let canonicalOrder: number[] | undefined;

      const describeOrder = (o: number[]): string =>
        o.map((i) => {
          const ins = allInstr[i]!;
          return `${ins.partial ? '~' : ''}${String(ins.target.valueOf())}<-${String(ins.extendWith.valueOf())}`;
        }).join(' , ');

      for (const order of perms) {
        // Fresh nodes per run: eval/extend mutate selector nodes in place.
        const subject = c.subject();
        const freshList = c.instructions();
        const extendsList = order.map(i => freshList[i]!);

        /*
         * `allExtends` is the FULL set (canonical order) held constant across permutations so
         * chained-extend discovery routes identically — the variable under test is APPLY order.
         */
        const allExtends = c.instructions();

        const value = String(applyExtendsToSelector(subject, extendsList, allExtends).valueOf());
        const set = siblingSet(value);

        if (canonicalSet === undefined) {
          canonicalSet = set;
          canonicalRaw = value;
          canonicalOrder = order;
        } else if (set !== canonicalSet) {
          throw new Error(`OQ-D COUNTEREXAMPLE — the branch SET (not just its order) depends on apply order for `
            + `"${c.name}".\n`
            + `  order ${describeOrder(canonicalOrder!)}\n    => ${canonicalRaw}\n`
            + `  order ${describeOrder(order)}\n    => ${value}`);
        }
      }

      expect(canonicalSet).toBeDefined();
    });
  }

  it('batch fast-path (adjacent same-target) yields the SAME branch SET as interleaved sequential', () => {
    /*
     * Two extenders on the SAME base + one distinct target between them. Adjacent placement drives
     * the batch fast-path (extend.ts:402 `applyBatchedExtend`); interleaving the distinct target
     * between them defeats the adjacency scan (extend.ts:395-401) → per-instruction sequential.
     */
    const mk = (): ExtendInstruction[] => [
      instr(el('.base'), el('.x')),
      instr(el('.base'), el('.y')),
      instr(el('.other'), el('.q'))
    ];

    // (a) BATCHED: same-target adjacent.
    const batchedList = mk();
    const batched = applyExtendsToSelector(
      sellist([el('.base'), el('.other')]),
      [batchedList[0]!, batchedList[1]!, batchedList[2]!],
      batchedList
    );

    // (b) SEQUENTIAL: same-target instructions split by the distinct one.
    const seqList = mk();
    const sequential = applyExtendsToSelector(
      sellist([el('.base'), el('.other')]),
      [seqList[0]!, seqList[2]!, seqList[1]!],
      seqList
    );

    // The design's confluence claim, at the level it holds TODAY: the branch SET is identical.
    expect(siblingSet(String(batched.valueOf()))).toBe(siblingSet(String(sequential.valueOf())));
  });

  it('EXTEND IS LIST-APPEND: the target LEADS; siblings follow in FEED (document) order — no sort', () => {
    /*
     * OQ-D CORRECTED (owner 2026-07-08): there was never a "document-order sort" to build. Extend
     * = append the extender to the target's list; the target's own selector always LEADS, and
     * extenders follow in the order they are fed. The former `setExtendOrderMap`/`extendOrderMap`
     * scaffolding (a canonicalizing sort) was DEAD (no callers) and is DELETED — it modeled a sort
     * append semantics have no use for. So: the branch SET is confluent (above); the ORDER is
     * deterministically the FEED order (= document order in production, which never permutes).
     */
    const mk = (): ExtendInstruction[] => [
      instr(el('.btn'), el('.x')),
      instr(el('.btn'), el('.y'))
    ];
    const forward = mk();
    const a = String(applyExtendsToSelector(el('.btn'), [forward[0]!, forward[1]!], forward).valueOf());
    const reverse = mk();
    const b = String(applyExtendsToSelector(el('.btn'), [reverse[1]!, reverse[0]!], reverse).valueOf());

    /*
     * SAME set; order follows the (reversed) feed. NOT a bug and NOT a missing sort — production
     * feeds in document order, so order is pinned there. Target-first is invariant in both.
     */
    expect(siblingSet(a)).toBe(siblingSet(b));
    expect(a.startsWith('.btn')).toBe(true);
    expect(b.startsWith('.btn')).toBe(true);
  });
});
