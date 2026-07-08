/**
 * solve-differential.test.ts — the ORACLE for the SOLVE phase (document-level fixpoint).
 * =====================================================================================
 *
 * SOLVE (`solve.ts`) drives the document-global extend fixpoint on top of PLAN (`plan.ts`,
 * reachability + target index) and the validated per-match engine (`extendByIndexOwn`). Its
 * NEW surface — not exercised by the per-call sweep — is the ORCHESTRATION: many subjects,
 * chained extends interacting ACROSS selectors (cross-selector transitive closure), fire-once
 * across the whole document, reachability as a per-subject scope gate, and `&`-crossing/hoist
 * (recorded as a known-fallback where the own engine cannot build it).
 *
 * ORACLE. Production applies extends per subject via `applyExtendsToSelector(subjectSelector,
 * reachableInstructions)` (extend-roots.ts:980 `localApplicableExtends` path). That IS the
 * ground truth for a subject's final selector. This suite:
 *   1. renders a document (parse → eval/render) to build the LIVE extend-root graph +
 *      `context.extends` the production gather uses;
 *   2. builds PLAN over that context;
 *   3. defines the document's SUBJECTS (each authored selector + its extend root) and, per
 *      subject, the reachable instruction set BOTH SOLVE and the oracle see (PLAN reachability
 *      against the subject's root — identical gate, so the comparison isolates the fixpoint);
 *   4. runs SOLVE and asserts each subject's final selector == the oracle's, EXCEPT subjects
 *      SOLVE marks UNSUPPORTED (crossing/hoist/graft the own engine does not build) — those are
 *      recorded as KNOWN-FALLBACK, not failures.
 *
 * A divergence in the FIXPOINT (a chained extend across selectors, fire-once, ordering) is the
 * valuable new find and is surfaced loudly (input/oracle/mine).
 */
import { describe, it, expect } from 'vitest';
import { Parser } from '../../../../../less-parser/src/index.js';
import { Context } from '../../../context.js';
import { renderNodeToString, type RenderBufferNode } from '../../util/render-buffer.js';
import type { Rules } from '../../rules.js';
import type { Selector } from '../../selector.js';
import { applyExtendsToSelector, type ExtendInstruction } from '../../util/extend.js';
import { el, sel, sellist, co, compound } from '../../index.js';
import {
  buildExtendPlan,
  type ExtendPlan,
  type PlanInstruction
} from '../plan.js';
import { solveExtends, type SolveSubject, type SolveSubjectResult } from '../solve.js';

interface Built {
  context: Context;
  plan: ExtendPlan;
}

async function build(src: string, collapseNesting = false): Promise<Built> {
  const context = new Context({ output: { collapseNesting }, leakyRules: true });
  const parser = new Parser();
  const { tree } = parser.parse(src);
  // Force the EVAL path (identity `preSerializeRoot` pins off the single-pass spine): this
  // suite validates SOLVE against the EVAL-path gather's `context.extends` + `extendRoots`,
  // which the spine (P3) does not populate (it folds extend into the pass, spine-native).
  await renderNodeToString(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    tree as unknown as RenderBufferNode,
    context,
    { context, preSerializeRoot: (r: Rules) => r }
  );
  return { context, plan: buildExtendPlan(context) };
}

/** The reachable instruction set for a subject root — the SAME gate SOLVE applies. */
function reachableInstructions(plan: ExtendPlan, root: Rules): PlanInstruction[] {
  return plan.instructions.filter((inst) => {
    const set = plan.reachability.get(inst);
    return set !== undefined && set.has(root);
  });
}

function toExtendInstruction(inst: PlanInstruction): ExtendInstruction {
  return {
    target: inst.target,
    extendWith: inst.extendWith,
    partial: inst.partial,
    extendRoot: inst.extendRoot,
    extendNode: inst.extendNode
  };
}

/**
 * The ORACLE final selector for one subject: production's per-subject apply. `applyExtendsToSelector`
 * is itself a chained worklist over the reachable set, so it reproduces the transitive closure the
 * document fixpoint must match.
 */
function oracleSelector(plan: ExtendPlan, subjectSel: Selector, root: Rules): string {
  const insts = reachableInstructions(plan, root).map(toExtendInstruction);
  return String(applyExtendsToSelector(subjectSel, insts).valueOf());
}

/** The registry's document root — the scope root-level subjects live under. */
function rootScope(built: Built): Rules {
  const r = built.context.extendRoots.root;
  if (!r) {
    throw new Error('no document root registered');
  }
  return r;
}

interface DiffOutcome {
  ownPass: number;
  knownFallback: number;
  divergences: string[];
}

/**
 * Run SOLVE over `subjects` and diff each against the oracle. A subject SOLVE could fully build
 * (ownBuilt) must match byte-for-byte; a subject that hit UNSUPPORTED is a known-fallback (recorded,
 * not compared — the wire-in falls back for it). Any own-built mismatch is a fixpoint divergence.
 */
function diff(built: Built, subjects: SolveSubject[]): DiffOutcome {
  const solved = solveExtends(built.plan, subjects);
  const byId = new Map<string, SolveSubjectResult>(solved.subjects.map(s => [s.id, s]));
  const out: DiffOutcome = { ownPass: 0, knownFallback: 0, divergences: [] };
  for (const subject of subjects) {
    const result = byId.get(subject.id)!;
    const oracle = oracleSelector(built.plan, subject.selector, subject.root);
    if (!result.ownBuilt) {
      out.knownFallback++;
      continue;
    }
    const mine = String(result.selector.valueOf());
    if (mine !== oracle) {
      out.divergences.push(
        `[${subject.id}] input=${String(subject.selector.valueOf())} oracle=${oracle} mine=${mine}`
      );
    } else {
      out.ownPass++;
    }
  }
  return out;
}

function expectNoDivergence(outcome: DiffOutcome): void {
  expect(outcome.divergences, outcome.divergences.join('\n')).toEqual([]);
}

describe('SOLVE document fixpoint — differential vs per-subject applyExtendsToSelector', () => {
  it('fan-out — many extenders, one target (.btn ← .x,.y,.z)', async () => {
    const built = await build(`
      .btn { color: red; }
      .x:extend(.btn) { }
      .y:extend(.btn) { }
      .z:extend(.btn) { }
    `);
    const root = rootScope(built);
    const subjects: SolveSubject[] = [
      { id: 'btn', selector: el('.btn'), root },
      { id: 'x', selector: el('.x'), root },
      { id: 'y', selector: el('.y'), root },
      { id: 'z', selector: el('.z'), root }
    ];
    const outcome = diff(built, subjects);
    expectNoDivergence(outcome);
    // .btn gains all three extenders; the extenders themselves are not targets → unchanged.
    expect(outcome.ownPass).toBe(4);
  });

  it('CROSS-SELECTOR transitive closure — chained .a←.b, .b←.c across selectors', async () => {
    // .a is extended by .b; .b is itself extended by .c. Subject .a must transitively gain BOTH
    // .b (direct) and .c (via .b becoming present). This is the fixpoint's cross-selector closure —
    // the per-call sweep never sees it because it drives one selector at a time.
    const built = await build(`
      .a { color: red; }
      .b:extend(.a) { }
      .c:extend(.b) { }
    `);
    const root = rootScope(built);
    const subjects: SolveSubject[] = [
      { id: 'a', selector: el('.a'), root },
      { id: 'b', selector: el('.b'), root },
      { id: 'c', selector: el('.c'), root }
    ];
    const outcome = diff(built, subjects);
    expectNoDivergence(outcome);
    // Verify the transitive gain concretely (not just oracle-agreement): .a → .a,.b,.c.
    const solved = solveExtends(built.plan, subjects);
    const a = solved.subjects.find(s => s.id === 'a')!;
    expect(String(a.selector.valueOf())).toBe('.a,.b,.c');
  });

  it('deep chain .a←.b←.c←.d — closure across four selectors', async () => {
    const built = await build(`
      .a { color: red; }
      .b:extend(.a) { }
      .c:extend(.b) { }
      .d:extend(.c) { }
    `);
    const root = rootScope(built);
    const subjects: SolveSubject[] = [
      { id: 'a', selector: el('.a'), root },
      { id: 'b', selector: el('.b'), root },
      { id: 'c', selector: el('.c'), root },
      { id: 'd', selector: el('.d'), root }
    ];
    expectNoDivergence(diff(built, subjects));
    const solved = solveExtends(built.plan, subjects);
    expect(String(solved.subjects.find(s => s.id === 'a')!.selector.valueOf())).toBe('.a,.b,.c,.d');
  });

  it('FIRE-ONCE — a target present in two subjects fires the same extender once per subject', async () => {
    // .base appears as its own subject AND inside .wrap's list; each subject fires .base←.ext once.
    const built = await build(`
      .base { color: red; }
      .ext:extend(.base) { }
    `);
    const root = rootScope(built);
    const subjects: SolveSubject[] = [
      { id: 'base', selector: el('.base'), root },
      { id: 'list', selector: sellist([el('.base'), el('.other')]), root }
    ];
    expectNoDivergence(diff(built, subjects));
    const solved = solveExtends(built.plan, subjects);
    // .base → .base,.ext (fired ONCE, not .base,.ext,.ext); list → .base,.other,.ext.
    expect(String(solved.subjects.find(s => s.id === 'base')!.selector.valueOf())).toBe('.base,.ext');
    expect(String(solved.subjects.find(s => s.id === 'list')!.selector.valueOf())).toBe('.base,.other,.ext');
  });

  it('SCOPE gate — a media-scoped extend does not reach a root-level subject (A3)', async () => {
    const built = await build(`
      .shared { color: red; }
      @media print {
        .mext:extend(.shared) { }
      }
      .also { color: blue; }
    `);
    const root = rootScope(built);
    // .mext's extend lives in the media root; it reaches media subjects only. A root-level subject
    // .shared must NOT gain it. We drive .shared under the DOCUMENT root — the reachable set for it
    // excludes the media-scoped instruction, so SOLVE leaves it unchanged, matching the oracle.
    const subjects: SolveSubject[] = [
      { id: 'shared', selector: el('.shared'), root },
      { id: 'also', selector: el('.also'), root }
    ];
    expectNoDivergence(diff(built, subjects));
  });

  it('partial extend across selectors — .a>.b subject gains a partial extender', async () => {
    // A partial extend `.b` from .d>.e: any subject carrying .b gets `:is(.b, .d>.e)`.
    const built = await build(`
      .host { .a > .b { color: red; } }
      .q:extend(.b) { }
    `);
    const root = rootScope(built);
    const subjects: SolveSubject[] = [
      { id: 'ab', selector: sel([el('.a'), co('>'), el('.b')]), root }
    ];
    // The oracle drives the reachable partial set; SOLVE must match (own-built or known-fallback).
    const outcome = diff(built, subjects);
    expectNoDivergence(outcome);
  });

  it('mixed document — fan-out + chain + a non-target subject in one sheet', async () => {
    const built = await build(`
      .base { color: red; }
      .a:extend(.base) { }
      .b:extend(.base) { }
      .mid:extend(.a) { }
      .leaf { color: green; }
    `);
    const root = rootScope(built);
    const subjects: SolveSubject[] = [
      { id: 'base', selector: el('.base'), root },
      { id: 'a', selector: el('.a'), root },
      { id: 'b', selector: el('.b'), root },
      { id: 'mid', selector: el('.mid'), root },
      { id: 'leaf', selector: el('.leaf'), root }
    ];
    expectNoDivergence(diff(built, subjects));
  });

  it('compound-target fan-out — .type2.sidebar4 style extenders on a base', async () => {
    const built = await build(`
      .sidebar { width: 300px; }
      .sidebar2:extend(.sidebar all) { }
    `);
    const root = rootScope(built);
    const subjects: SolveSubject[] = [
      { id: 'sidebar', selector: el('.sidebar'), root },
      { id: 'compound', selector: compound([el('.type2'), el('.sidebar4')]), root }
    ];
    const outcome = diff(built, subjects);
    expectNoDivergence(outcome);
  });

  it('extend.less shape — nested-target chain (.aa .dd ← .ee; .cc ← .aa,.bb) at exact parity', async () => {
    // The extend.less corpus fixture, driven at the subject level: .cc extends .aa AND .bb; .ee
    // extends .dd(all) + .bb; .ff extends .dd + .bb(all). Root-level subjects .aa,.bb gain their
    // extenders; the nested .dd/.bb subjects are exercised too. Any own-built subject must match
    // the oracle; UNSUPPORTED (e.g. nested/composed targets) is a known-fallback.
    const built = await build(`
      .aa { color: black; .dd { background: red; } }
      .bb { background: red; .bb { color: black; } }
      .cc:extend(.aa,.bb) {}
      .ee:extend(.dd all,.bb) {}
      .ff:extend(.dd,.bb all) {}
    `);
    const root = rootScope(built);
    const subjects: SolveSubject[] = [
      { id: 'aa', selector: el('.aa'), root },
      { id: 'bb', selector: el('.bb'), root },
      { id: 'dd', selector: el('.dd'), root },
      { id: 'cc', selector: el('.cc'), root },
      { id: 'ee', selector: el('.ee'), root },
      { id: 'ff', selector: el('.ff'), root }
    ];
    const outcome = diff(built, subjects);
    expectNoDivergence(outcome);
  });
});

/**
 * SCOPE BOUNDARY — SOLVE reproduces the LOCAL-APPLY layer (`applyExtendsToSelector`), the same
 * layer the per-subject oracle measures. It does NOT reproduce the `processExtends`-level EMIT
 * concerns that sit ABOVE local-apply: composing a nested extender relative to its target
 * (`composeExtendWithRelativeToTarget`/`getFullComposedForm`) and hoisting a `&`-crossing branch to
 * root. Those are re-bucketing/projection events the design assigns to EMIT (§4.3), NOT to the SOLVE
 * fixpoint. This test PINS that boundary: for a `&`-crossing extend, SOLVE and the local-apply
 * oracle AGREE (both use the raw `extendWith`, neither composes/hoists) — so SOLVE is faithful to
 * its layer, and the composed/hoisted render shape is correctly the wire-in's EMIT responsibility.
 */
describe('SOLVE — local-apply layer boundary (crossing/hoist is EMIT, not SOLVE)', () => {
  it('&-crossing extend (footer/header shape) agrees with local-apply oracle; compose/hoist deferred to EMIT', async () => {
    const built = await build(`
      .header { .header-nav { background: red; } }
      .footer { .footer-nav:extend(.header .header-nav all) { } }
    `);
    const root = rootScope(built);
    const subjects: SolveSubject[] = [
      { id: 'header-nav', selector: sel([el('.header'), co(' '), el('.header-nav')]), root }
    ];
    const outcome = diff(built, subjects);
    // SOLVE matches the local-apply oracle exactly (own-built, no divergence). The rendered CSS
    // additionally composes `.footer-nav` → `.footer .footer-nav` and hoists — an EMIT step above
    // this layer, deliberately NOT reproduced by SOLVE.
    expectNoDivergence(outcome);
    expect(outcome.ownPass).toBe(1);
  });
});
