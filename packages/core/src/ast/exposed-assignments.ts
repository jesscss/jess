import { isThenable, mapMaybe, type MaybePromise } from '@jesscss/awaitable-pipe';
import { ERR, WARN } from '../error/diagnostics.js';
import { callSiteLocation } from './call-site-location.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import type { Context } from '../context.js';
import { exportState, mixedReads, type ExposeScope, type ExportLane, type ExportRef, type ExportState } from './export-reads.js';
import { funcCall, keyword, type CallValue, type VariableDeclaration, type VariableExpose } from './nodes.js';
import type { BindingCell, Frame } from './serialize.js';
import { emitValue, type EvalValue } from './value-eval.js';

/**
 * Ledger A22 (owner 2026-11-19): an exposed variable is one variable, as an
 * exported JavaScript `let` is. Each assignment of it, made in the frame its
 * `@expose` binds in, is recorded here; a read that reaches any of them reads
 * the variable (export-reads.ts `refOf`), and the runtime's default for it is
 * its last value. The evaluator writes its live cells and scoped reassignments
 * through {@link writeCell} and {@link writeReassign}.
 */

/** An assignment of an exposed variable: its name, its value and the frame a read of it evaluates in. */
export interface ExposedWrite<F> {
  readonly name: string;
  readonly value: CallValue;
  readonly frame: F;
}

/**
 * Owner 2026-11-19 (ledger A22): a read of an exposed variable refers to the
 * variable, not to one of its values, so a read that reaches any assignment of
 * it (`$brand: red` before a later `$brand: blue`, or `$brand := blue`) is its
 * `var()`, with the value that read sees as the fallback, as the read of its
 * last declaration is (export-reads.ts `settle`).
 */
export function assignmentRef<F>(x: ExportState<F>, hit: { value: CallValue; frame: F }): ExportRef<F> | undefined {
  const write = x.writes.get(hit.value);
  return write?.frame !== hit.frame || !x.bound.has(write.name) ? undefined : exposedRef(x, write.name, hit);
}

/** The ref of a read of exposed variable `name` that reaches `hit`: its `var()` over the value it reaches, none for a mixin call's. */
export function exposedRef<F>(x: ExportState<F>, name: string, hit: { value: CallValue; frame: F }): ExportRef<F> | undefined {
  const value = hit.value;
  if (!isValueSlotArray(value) && value.type === 'MixinCall') {
    return undefined;
  }
  const call = funcCall('var', [keyword(`--${name}`), value]);
  const ref = { name, call, frame: hit.frame, source: undefined };
  x.refs.set(value, ref);
  x.behind.set(call, value);
  return ref;
}

/**
 * An assignment of `node.name` in frame `owner` whose value `value` is read in
 * `frame`: when an `@expose` of the name binds in `owner`, it assigns the exposed
 * variable ({@link assignmentRef}). A second one in the same file warns, once
 * per variable: the variable is one, like an exported JavaScript `let` assigned
 * twice, so `set()` sets the value every read follows (owner 2026-11-19, ledger
 * A22). An importer's assignment of a variable a file it imports declares is a
 * deliberate override and does not warn (orchestrator 2026-11-19).
 */
export function exposedWrite<F>(e: ExportLane<F>, node: VariableDeclaration, owner: F, value: CallValue, frame: F): void {
  const x = e.s.exports;
  const name = node.name;
  const home = x.homes.get(name);
  if (home?.frame !== owner) {
    return;
  }
  const write = { name, value, frame };
  x.writes.set(value, write);
  x.last.set(name, write);
  const first = x.assigned.get(name);
  if (first === undefined) {
    x.assigned.set(name, node);
  } else if (first !== node) {
    x.assigned.set(name, null);
  }
  const files = x.assignedIn.get(name);
  if (files === null) {
    return;
  }
  const file = e.s.context?.fileOfNode(node) ?? e.s.context?.sourceContext?.file;
  const earlier = files?.get(file);
  if (files === undefined) {
    x.assignedIn.set(name, new Map([[file, node]]));
  } else if (earlier === undefined) {
    files.set(file, node);
  } else if (earlier !== node) {
    x.assignedIn.set(name, null);
    e.s.context?.warn(WARN.exposeReassigned({ node, ...callSiteLocation(node, e.s), meta: { ...home.node.spelling, name } }));
  }
}

/**
 * Each exposed variable assigned more than once has its last value as the
 * runtime's default, the value it holds once the stylesheet is compiled,
 * though a read before a later assignment saw an earlier one (owner
 * 2026-11-19, ledger A22). `evaluate` evaluates a value in its frame; exports
 * read inside it are read as their compile-time values, as a computed call's
 * known arguments are (export-reads.ts `knownArguments`).
 */
export function exportFinalDefaults<F>(e: ExportLane<F>, evaluate: (value: CallValue, frame: F) => MaybePromise<EvalValue>): MaybePromise<void> {
  const x = e.s.exports;
  const runtime = x.runtime;
  if (runtime === undefined) {
    return undefined;
  }
  const finals: Array<MaybePromise<void>> = [];
  for (const [name, last] of x.last) {
    if (x.assigned.get(name) !== null || !runtime.defaults.has(name)) {
      continue;
    }
    const { inputs, knownReads } = x;
    x.inputs = [];
    x.knownReads = true;
    try {
      finals.push(mapMaybe(evaluate(last.value, last.frame), (value) => {
        runtime.defaults.set(name, typeof value === 'string' ? value : emitValue(value));
      }));
    } finally {
      x.inputs = inputs;
      x.knownReads = knownReads;
    }
  }
  return finals.some(isThenable) ? Promise.all(finals).then(() => undefined) : undefined;
}

/**
 * Excludes `node` from lookups while a read evaluates it (`on`), or releases it.
 * An exposed variable's read evaluates its `var()` stand-in, whose fallback is
 * the declaration's own value, so the declaration is excluded with it: in
 * `@b: @b + 1` the `@b` then reads the earlier `@b`, as it does unexposed.
 *
 * While a read evaluates an exposed variable's value, a read of the variable
 * inside it reads the value it reaches (A22): in `$b: $($b + 1)` the value is
 * computed, not a CSS read. Excluding returns the variable it marks, which the
 * release takes back (`entered`), so a ref made while the value evaluates does
 * not release a mark it never set.
 */
export function excluding<F>(e: { readonly excluded: Set<CallValue>; readonly s: { readonly exports: ExportState<F> } }, node: CallValue, on: boolean, entered?: string): string | undefined {
  const x = e.s.exports;
  const behind = x.runtime === undefined ? undefined : x.behind.get(node);
  if (on) {
    e.excluded.add(node);
    if (behind !== undefined) {
      e.excluded.add(behind);
    }
    const name = x.runtime === undefined ? undefined : x.refs.get(behind ?? node)?.name;
    if (name !== undefined) {
      x.within.set(name, (x.within.get(name) ?? 0) + 1);
    }
    return name;
  }
  e.excluded.delete(node);
  if (behind !== undefined) {
    e.excluded.delete(behind);
  }
  if (entered !== undefined) {
    const depth = x.within.get(entered)! - 1;
    if (depth === 0) {
      x.within.delete(entered);
    } else {
      x.within.set(entered, depth);
    }
  }
  return undefined;
}

/** Sets `name`'s live cell in `owner`'s `cells`, an assignment of the exposed variable when it is one ({@link exposedWrite}). */
export function writeCell(e: ExportLane<Frame>, cells: Map<string, BindingCell>, cell: BindingCell, owner: Frame): void {
  cells.set(cell.declaration.name, cell);
  if (owner.parent === null) {
    noteTopLevelDeclaration(e.s.exports, owner, cell.declaration.name);
  }
  if (e.s.exports.runtime !== undefined) {
    exposedWrite(e, cell.declaration, owner, cell.value, cell.valueFrame ?? owner);
  }
}

/** Records `node` as `owner`'s scoped reassignment of its name, an assignment of the exposed variable when it is one ({@link exposedWrite}). */
export function writeReassign(e: ExportLane<Frame>, owner: Frame, node: VariableDeclaration): void {
  (owner.reassign ??= new Map()).set(node.name, node);
  if (e.s.exports.runtime !== undefined) {
    exposedWrite(e, node, owner, node.value, owner);
  }
}

/** A compile's exports' state, made by {@link holdExports}, and the exports it holds as written. */
export interface ExportHold {
  readonly asWritten: ReadonlySet<string> | undefined;
  exports: Pick<ExportState<unknown>, 'runtime'> | undefined;
}

/** The exports' state of the compile `hold` is for, holding `hold.asWritten` as written. */
export function holdExports<F>(hold: ExportHold): ExportState<F> {
  const exports = exportState<F>(hold.asWritten);
  hold.exports = exports;
  return exports;
}

/**
 * `compile`, once more when it read an export both as a ratio and as written
 * ({@link mixedReads}): one custom property holds one form, and which value
 * each read sees is known only once the stylesheet is compiled (owner
 * 2026-11-19, ledger A22). The second run reports the errors; the first
 * run's warnings are kept and the second's muted, a fatal one excepted.
 */
export function compileHoldingMixed<R>(context: Context | undefined, compile: (hold: ExportHold) => MaybePromise<R>): MaybePromise<R> {
  const errorsBefore = context?.errors.length ?? 0;
  const first: ExportHold = { asWritten: undefined, exports: undefined };
  return mapMaybe(compile(first), (result) => {
    const mixed = first.exports === undefined ? undefined : mixedReads(first.exports);
    if (mixed === undefined) {
      return result;
    }
    context?.errors.splice(errorsBefore);
    return withWarningsMuted(context, () => compile({ asWritten: mixed, exports: undefined }));
  });
}

/** `run`, dropping the warnings it raises but a fatal one. */
function withWarningsMuted<R>(context: Context | undefined, run: () => MaybePromise<R>): MaybePromise<R> {
  if (context === undefined) {
    return run();
  }
  const was = context.warningsMuted;
  context.warningsMuted = true;
  const restore = (): void => {
    context.warningsMuted = was;
  };
  try {
    const result = run();
    if (isThenable(result)) {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

/** Records a declaration at a top level as the render walk reaches it ({@link writeCell}), so an `@expose` after it may name it ({@link requireDeclaredBefore}). */
function noteTopLevelDeclaration<F>(x: ExportState<F>, frame: F, name: string): void {
  let names = x.declaredSoFar.get(frame);
  if (names === undefined) {
    names = new Set();
    x.declaredSoFar.set(frame, names);
  }
  names.add(name);
}

/**
 * A variable is exposed after it is declared (owner 2026-11-26, ledger A20):
 * when the render walk reaches an `@expose`, each name it lists has a
 * declaration already walked in its frame, written there, by a file
 * imported before it or by a mixin called before it. A name with none yet is
 * marked, and rejected when it resolves (export-reads.ts `settle`), so one
 * nothing declares stays `eval/expose-not-declared`; one a read already
 * resolved is rejected here.
 */
export function requireDeclaredBefore<F>(node: VariableExpose, frame: F, { own, leaks }: Pick<ExposeScope<F>, 'own' | 'leaks'>, e: ExportLane<F>): void {
  if (own !== undefined) {
    return; // the root's, bound before the walk; checked when the walk reaches it
  }
  const x = e.s.exports;
  const names = x.declaredSoFar.get(frame);
  for (const exported of node.names) {
    const name = exported.name;
    if (names?.has(name) === true || leaks(name)) {
      continue;
    }
    if (x.bound.has(name)) {
      throw ERR.exposeBeforeDeclaration({ node: exported, ...callSiteLocation(exported, e.s), meta: { ...node.spelling, name } });
    }
    x.early.add(exported);
  }
}

/** Rejects an exposed name {@link requireDeclaredBefore} marked, once it resolves to a declaration. */
export function rejectEarly(early: ReadonlySet<object>, node: VariableExpose, exported: VariableExpose['names'][number], where: ReturnType<typeof callSiteLocation>): void {
  if (early.has(exported)) {
    throw ERR.exposeBeforeDeclaration({ node: exported, ...where, meta: { ...node.spelling, name: exported.name } });
  }
}
