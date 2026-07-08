/**
 * pipeline.ts — the END-TO-END capstone driver that COMPOSES PLAN → SOLVE → EMIT into one
 * bundle-excluded flow and produces each subject's FINAL composed/hoisted/collapsed selector.
 * ==========================================================================================
 *
 * The three landed phases each own one layer of the extend flow and are individually validated
 * (plan-differential / solve-differential / emit-differential):
 *
 *   PLAN  (`plan.ts`)  — reachability (A1–A8) + the target index. WHICH instructions may touch
 *                        WHICH subjects. Pure precompute over the extend-root graph.
 *   SOLVE (`solve.ts`) — the document fixpoint at the LOCAL-APPLY layer. WHICH instructions
 *                        actually FIRE against a subject (match + transitive closure), using the
 *                        raw per-instruction `(target, extendWith, partial)` and the validated
 *                        `extendByIndexOwn` per-match engine.
 *   EMIT  (`emit.ts`)  — the projection ABOVE local-apply. Composes a fired extender relative to
 *                        its target from BUCKET PATHS, hoists an `&`-crossing branch to root, and
 *                        groups under `:is()` per the collapse policy.
 *
 * SOLVE deliberately stops at local-apply (raw `extendWith`, no compose/hoist) — it agrees with the
 * `applyExtendsToSelector` oracle. EMIT owns compose/hoist/collapse but is driven from explicit
 * bucket paths, not the node graph. NEITHER phase alone produces a subject's final rendered header.
 * This driver is the missing seam: it runs SOLVE to decide WHICH contributions fire (the match +
 * cross-selector transitive closure), maps each fired contribution to its EMIT bucket-path
 * contribution, then runs EMIT to produce the composed/hoisted/collapsed output. That cross-layer
 * seam (fixpoint × scope × compose × hoist × collapse) is exactly what the per-layer tests cannot
 * exercise, and what the capstone differential validates against the ratified v5 alpha `.css`.
 *
 * OWN CONSTRUCTION, FAIL-LOUD. The driver never delegates to `processExtends`/`extend-roots.ts`. A
 * per-match shape the own engine cannot build returns UNSUPPORTED (recorded as a fallback candidate,
 * never silently applied). A subject touching any UNSUPPORTED instruction is reported UNSUPPORTED.
 *
 * NOT wired into production, NOT the render cutover — a validated building block. Not exported from
 * `index.ts` → bundle-excluded.
 */
import type { Selector } from '../selector.js';
import { SelectorList } from '../selector-list.js';
import { extendByIndexOwn, UNSUPPORTED, type UnsupportedResult } from './extend-index.js';
import {
  composeTargetOwn,
  projectSubject,
  emitNestedChildHeader,
  emitSubjectHeader,
  type BucketPath,
  type EmitContribution,
  type EmitSubject
} from './emit.js';

export { UNSUPPORTED, type UnsupportedResult };

/**
 * One extend instruction as the pipeline sees it, decoded from an authored extend. `path` is the
 * extender's ancestor selector chain (outermost → own local) — the structural artifact EMIT composes
 * from (design OQ-5(B): placement derives from the bucket path, not a stored own-selector field).
 * `target`/`partial` are the raw local-apply inputs SOLVE fires with; `order` is the document order
 * EMIT sorts branches by; `scope` is an opaque reachability key (PLAN's reachable-root set in
 * production — here supplied by the caller so scope is a bucketing precondition, never re-tested on
 * the per-match path).
 */
export interface PipelineInstruction {
  target: Selector;
  extendWith: Selector;
  partial: boolean;
  path: BucketPath;
  order: number;
  scope?: unknown;
}

/**
 * A subject to drive: its authored bucket path (the target's own ancestor chain), its document
 * order, an opaque scope key, and — when the subject is a NESTED block whose header the collapse
 * policy reshapes — the child-local selector to fold the projected parent Or-set into.
 */
export interface PipelineSubject {
  id: string;
  path: BucketPath;
  order: number;
  scope?: unknown;
  /** when set, the emitted header is this child folded into the projected parent Or-set (collapse). */
  nestedChildLocal?: Selector;
}

export interface PipelineSubjectResult {
  id: string;
  /** the subject's final composed/hoisted/collapsed header (valueOf form), or '' when UNSUPPORTED. */
  header: string;
  /** the ordered projected Or-branch set (empty when UNSUPPORTED). */
  branches: string[];
  /** true when the subject's projection crosses a parent boundary (hoist-to-root). */
  hoistToRoot: boolean;
  /** true when every fired instruction built on the own engine (no UNSUPPORTED for this subject). */
  ownBuilt: boolean;
  /** instructions whose per-match shape the own engine cannot build yet (fallback candidates). */
  unsupported: PipelineInstruction[];
}

export interface PipelineResult {
  subjects: PipelineSubjectResult[];
  /** true when NO subject hit an UNSUPPORTED per-match shape (whole document own-built). */
  fullyOwnBuilt: boolean;
}

function scopeKey(scope: unknown): string {
  if (scope === undefined || scope === null) {
    return '';
  }
  if (typeof scope === 'string' || typeof scope === 'number') {
    return String(scope);
  }
  return '#obj';
}

/** Compose a subject/target bucket path to its own authored selector (its full nesting composed). */
function ownComposed(path: BucketPath): Selector {
  return composeTargetOwn(path);
}

function asSelector(result: Selector | Selector[]): Selector {
  return Array.isArray(result) ? new SelectorList(result as SelectorList['value']) : result;
}

/**
 * SOLVE (localized to one subject) — decide WHICH instructions FIRE against the subject and in what
 * transitive order. A subject's own composed selector is the seed; an instruction fires when
 * `extendByIndexOwn` reports a CHANGE against the current value (a real match, at the local-apply
 * layer the oracle measures). A fired change re-opens the sweep so a CHAINED extend (an extender that
 * is itself another instruction's target) fires transitively — the cross-selector closure. Fire-once
 * is keyed on (branch value, instruction) so re-appending an extender each round is impossible. Only
 * SCOPE-REACHABLE instructions (same opaque scope key as the subject) are considered — the PLAN gate,
 * applied here as a precondition. UNSUPPORTED shapes are recorded and skipped (fail-loud).
 */
function solveContributions(
  subject: PipelineSubject,
  instructions: PipelineInstruction[]
): { fired: PipelineInstruction[]; unsupported: PipelineInstruction[]; ownBuilt: boolean } {
  const subjectScope = scopeKey(subject.scope);
  const reachable = instructions.filter(inst => scopeKey(inst.scope) === subjectScope);
  const unsupported: PipelineInstruction[] = [];
  const fired: PipelineInstruction[] = [];
  let ownBuilt = true;

  let current = ownComposed(subject.path);
  const done = new Set<string>();
  const fireKey = (branchValue: string, inst: PipelineInstruction): string =>
    `${branchValue}|${inst.partial ? 1 : 0}|${String(inst.target.valueOf())}|${String(inst.extendWith.valueOf())}`;

  let changed = true;
  const guardMax = (reachable.length + 2) * (reachable.length + 2);
  let rounds = 0;
  while (changed && rounds <= guardMax) {
    changed = false;
    rounds++;
    const branchValue = String(current.valueOf());
    for (const inst of reachable) {
      const key = fireKey(branchValue, inst);
      if (done.has(key)) {
        continue;
      }
      const result = extendByIndexOwn(current, inst.target, inst.extendWith, inst.partial);
      if (result === UNSUPPORTED) {
        ownBuilt = false;
        unsupported.push(inst);
        done.add(key);
        continue;
      }
      if (result === 'NOT_FOUND') {
        continue;
      }
      const next = asSelector(result);
      done.add(key);
      if (String(next.valueOf()) !== branchValue) {
        current = next;
        fired.push(inst);
        changed = true;
        break;
      }
    }
  }

  return { fired, unsupported, ownBuilt };
}

/**
 * Drive ONE subject end-to-end: SOLVE decides the fired contribution set; EMIT projects them from
 * bucket paths to the final composed/hoisted/collapsed header.
 */
function runSubject(subject: PipelineSubject, instructions: PipelineInstruction[]): PipelineSubjectResult {
  const { fired, unsupported, ownBuilt } = solveContributions(subject, instructions);
  if (!ownBuilt) {
    return { id: subject.id, header: '', branches: [], hoistToRoot: false, ownBuilt: false, unsupported };
  }

  const contributions: EmitContribution[] = fired.map(inst => ({ path: inst.path, order: inst.order }));
  const emitSubject: EmitSubject = { path: subject.path, order: subject.order, contributions };
  const projection = projectSubject(emitSubject);

  const branches = projection.branches.map(b => String(b.valueOf()));
  const header = subject.nestedChildLocal
    ? emitNestedChildHeader(projection, subject.nestedChildLocal, true)
    : emitSubjectHeader(projection);

  return {
    id: subject.id,
    header,
    branches,
    hoistToRoot: projection.hoistToRoot,
    ownBuilt: true,
    unsupported
  };
}

/**
 * The composed capstone flow: PLAN (the caller supplies the decoded instruction set + per-subject
 * scope keys, i.e. reachability as a precondition) → SOLVE (per-subject fixpoint deciding fired
 * contributions) → EMIT (project to the final header). Materialization is once, at the end.
 */
export function runExtendPipeline(
  subjects: PipelineSubject[],
  instructions: PipelineInstruction[]
): PipelineResult {
  const results = subjects.map(subject => runSubject(subject, instructions));
  const fullyOwnBuilt = results.every(r => r.ownBuilt);
  return { subjects: results, fullyOwnBuilt };
}
