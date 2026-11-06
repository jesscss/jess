import { mapMaybe, type MaybePromise } from '@jesscss/awaitable-pipe';
import { ERR, toDiagnostic } from '../error/diagnostics.js';
import { callSiteLocation } from './call-site-location.js';
import { onlyExportsUnknown, type ExportLane } from './export-reads.js';
import type { FunctionCall } from './nodes.js';
import { sourceStartOf } from './provenance.js';
import { emitValue, isValueGroupArray, type EvalValue, type ValueGroup } from './value-eval.js';

/**
 * Whether a call's result is a CSS form or the CSS call it declined to, rather
 * than a value. A value it only handed back from its arguments (`map.get`) is no
 * form of its own.
 */
function isPrintedForm(out: EvalValue, vals: readonly ValueGroup[]): boolean {
  const value = typeof out !== 'string' && isValueGroupArray(out) && out.length === 1 ? out[0] : out;
  if (value === undefined || typeof value === 'string' || isValueGroupArray(value) || value.type !== 'FunctionCall' || (!value.computed && value.result === null)) {
    return false;
  }
  const printed = emitValue(value);
  return !vals.some(val => emitValue(val).includes(printed));
}

/** Reports the call once however often it runs, at the place it was written. */
function report<F>(node: FunctionCall, printed: string, e: ExportLane<F>): void {
  const context = e.s.context;
  if (context === undefined) {
    return;
  }
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

  /* Evaluation goes on, so every such call is reported; the compile fails at the end (P45). */
  context.errors.push(toDiagnostic(ERR.unresolvedBuiltin({ node, ...callSiteLocation(node, e.s), meta })));
}

/**
 * Watches one evaluation of a namespaced built-in. `call` is its dispatch: only
 * the first counts, since a call reading an export runs again over the export's
 * `var()`, which is deferred on purpose. `settled` reports what it finally wrote.
 */
export function unresolvedWatch<F>(node: FunctionCall, e: ExportLane<F>, call: (vals: ValueGroup[]) => MaybePromise<EvalValue>): {
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
        report(node, emitValue(out), e);
      }
      return out;
    })
  };
}
