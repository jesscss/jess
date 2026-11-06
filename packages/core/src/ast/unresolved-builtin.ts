import { mapMaybe, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { Context } from '../context.js';
import { DocumentContext } from '../document-context.js';
import { ERR, toDiagnostic } from '../error/diagnostics.js';
import { callSiteLocation } from './call-site-location.js';
import { onlyExportsUnknown, type ExportLane } from './export-reads.js';
import type { FunctionCall } from './nodes.js';
import { sourceStartOf } from './provenance.js';
import { emitValue, isValueGroupArray, type EvalValue, type ValueGroup } from './value-eval.js';

const lone = (value: ValueGroup): ValueGroup => isValueGroupArray(value) && value.length === 1 ? lone(value[0]!) : value;

/** Whether a value holds `wanted` itself, as a list holds an item and a map a value. */
function holds(value: ValueGroup, wanted: ValueGroup): boolean {
  const item = lone(value);
  if (item === wanted) {
    return true;
  }
  if (isValueGroupArray(item)) {
    return item.some(part => holds(part, wanted));
  }
  return item.type === 'List'
    ? item.value.some(part => holds(part, wanted))
    : item.type === 'Collection' && item.entries.some(entry => holds(entry.value, wanted));
}

/**
 * Whether a call's result is a CSS form or the CSS call it declined to, rather
 * than a value. What it only handed back from its arguments (`map.get`) is no
 * form of its own.
 */
function isPrintedForm(out: EvalValue, vals: readonly ValueGroup[]): boolean {
  const value = typeof out === 'string' ? out : lone(out);
  return typeof value !== 'string' && !isValueGroupArray(value) && value.type === 'FunctionCall' && (value.computed || value.result !== null)
    && !vals.some(val => holds(val, value));
}

/** Reports the call once however often it runs, at the place it was written in `owner`'s file. */
function report<F>(node: FunctionCall, printed: string, owner: object | null, e: ExportLane<F>): void {
  const context = e.s.context;
  if (context === undefined) {
    return;
  }
  void context.withSourceOwner(owner, () => {
    const site = `${context.sourceContext?.file?.fullPath ?? ''}:${sourceStartOf(node)}:${node.name}`;
    const sites = context.unresolvedBuiltinSites ??= new Set();
    if (sites.has(site)) {
      return;
    }
    sites.add(site);
    const meta = { name: node.name, printed };
    if (e.modes.unresolvedBuiltins === 'warn') {
      context.warnAtNode('eval/unresolved-builtin', 'eval', node, meta);
      return;
    }

    /* Evaluation goes on, so such calls keep being reported; the compile fails at the end (P45). */
    context.errors.push(toDiagnostic(ERR.unresolvedBuiltin({ node, ...callSiteLocation(node, e.s), meta })));
  });
}

/**
 * Watches one evaluation of a namespaced built-in written in `owner`. `call` is
 * its dispatch: only the first counts, since a call reading an export runs again
 * over the export's `var()`, which is deferred on purpose. `settled` reports what
 * it finally wrote.
 */
export function unresolvedWatch<F>(node: FunctionCall, e: ExportLane<F>, owner: object | null, call: (vals: ValueGroup[]) => MaybePromise<EvalValue>): {
  call: (vals: ValueGroup[]) => MaybePromise<EvalValue>;
  settled: (result: MaybePromise<EvalValue>) => MaybePromise<EvalValue>;
} {
  let first = true;
  let unresolved = false;
  return {
    call(vals) {
      if (!first) {
        return call(vals);
      }
      first = false;
      const deferred = onlyExportsUnknown(e.s.exports, vals);
      return mapMaybe(call(vals), (out) => {
        unresolved = !deferred && isPrintedForm(out, vals);
        return out;
      });
    },
    settled: result => mapMaybe(result, (out) => {
      if (unresolved) {
        report(node, emitValue(out), owner, e);
      }
      return out;
    })
  };
}

/**
 * A reached value's evaluation, noting the document that wrote it: the span of a
 * call in it counts from that document, not the reader's.
 *
 * ponytail: a call the value evaluates only after an await is named in the
 * reader's document; carry the owner through the continuation if a plugin value
 * needs it.
 */
export function reachingOwner<T>(context: Context, value: object, owner: object | null | undefined, run: () => T): () => T {
  return () => {
    const outer = context.reachedOwner;
    const written = context.bodyOwner(value) ?? owner;
    context.reachedOwner = written instanceof DocumentContext ? written : outer;
    try {
      return run();
    } finally {
      context.reachedOwner = outer;
    }
  };
}
