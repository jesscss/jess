/**
 * The `ValueEvaluator` seam implementation — boundary-clean, synchronous on the
 * ordinary path and awaitable only when an injected fn capability needs it,
 * built entirely on the value domain (operate + kind-dispatch + free
 * serializer): no legacy `../tree` node, no reparse, no `render()` walk, no async
 * record/replay.
 *
 * Named calls dispatch through a caller-populated {@link FnRegistry}; every other
 * named call is treated as an unknown function emitted verbatim.
 *
 * HARD MODULE BOUNDARY: imports only the engine value modules, and the
 * provenance side table only to read the authored layout of a call it writes
 * out as-is.
 */
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { EmptyListValueError, emitValue, isEmptyList, isValueGroupArray, itemBoundary, joinGroup, readText, writtenArgument, type ArgumentKeyword, type EvalModes, type FnScope, type ValueEvaluator, type ValueGroup, type Value, type WrittenArguments } from './value-eval.js';
import { valueLayoutOf } from './provenance.js';
import type { Fn, FnIo, SelectorParse } from './functions/types.js';
import { sepGlue } from './value-eval.js';
import { groupItems, groupSeparator } from './value-list.js';
import { keepAsWritten, keptMathOf, mathText, operate } from './value-operate.js';
import { isMathFunctionName } from './math-functions.js';
import { compare as compareValues, compareMatch as compareMatchValues, typeCheck as typeCheckValues } from './value-guards.js';
import type { FnRegistry } from './value-dispatch.js';
import { dispatchFn, FunctionDeclined, numberArguments } from './value-dispatch.js';
import { makeCallKeyword } from './value-factory.js';
import { emitCompressed } from './compress.js';

/** Join an unknown-fn's arg bytes verbatim (per separator). Under compress the
 *  comma list-divider tightens (`,`) and each arg folds by its type, as in any
 *  other value position; space and `/` separators are significant and kept
 *  (v5 keeps `/` spaced). A keyword argument keeps its keyword
 *  ({@link writtenArgument}), and pretty output keeps the comments and line
 *  breaks the parser recorded between and inside the `authored` arguments
 *  (ledger F11). */
function verbatimArgs(args: ValueGroup, modes?: EvalModes, authored?: readonly ArgumentKeyword[], math = false): string {
  const separator = groupSeparator(args);
  const compress = modes?.compress === true;
  const glue = separator === ' ' ? ' ' : sepGlue(separator, compress);
  const plain = compress ? emitCompressed : emitValue;
  const emit = math ? (v: ValueGroup): string => isValueGroupArray(v) ? plain(v) : keptMathOf(v) ?? mathText(v, plain(v)) : plain;
  const items = groupItems(args);
  if (authored === undefined) {
    return items.map(emit).join(glue);
  }
  const separators = compress ? undefined : valueLayoutOf(authored);
  let out = '';
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    const argument = authored[index];
    const members = argument === undefined || !Array.isArray(argument.value) ? undefined : valueLayoutOf(argument.value);
    const bytes = members !== undefined && isValueGroupArray(item)
      ? joinGroup(item, ' ', emit, members, compress)
      : emit(item);
    const spelled = argument === undefined ? bytes : writtenArgument(argument, bytes, compress);
    out += index === 0 ? spelled : itemBoundary(separators?.[index - 1], glue, compress) + spelled;
  }
  return out;
}

/**
 * Preserve an optional CSS call, as written, after name resolution or invocation
 * failed. A math function's argument is math, so kept math in it is written as
 * its arithmetic, never a nested `calc()` (`max(1px + 1em, 1px)`; {@link keptMathOf}),
 * and text in the groups written around it (`min((1px + 2px), 3px)`; {@link mathText}).
 */
/** How a call is written out: its arguments as written, and whether an empty list among them fails (`.scss`, `.jess`). */
interface WrittenCall {
  readonly written?: WrittenArguments;
  readonly authored?: readonly ArgumentKeyword[];
  readonly rejectEmpty: boolean;
}

function fallbackCall(name: string, args: ValueGroup, modes: EvalModes | undefined, call: WrittenCall): Value {
  if (call.rejectEmpty && groupItems(args).some(isEmptyList)) {
    throw new EmptyListValueError(`An empty list is an argument of \`${name}()\`, a call written out as-is; an empty list has no CSS spelling.`);
  }
  const written = call.written?.args ?? args;
  return keepAsWritten(makeCallKeyword(`${name}(${verbatimArgs(written, modes, call.written?.keywords ?? call.authored, isMathFunctionName(name))})`, { name, args: written }));
}

/**
 * A registered callable has already been selected. Its failure is therefore an
 * invocation result, not a name-resolution miss: preserve it only in the
 * caller-selected lenient mode, otherwise propagate the original failure.
 */
function recoverCallFailure(
  error: unknown,
  name: string,
  args: ValueGroup,
  modes: EvalModes,
  call: WrittenCall
): Value {
  if (modes.functionMode === 'error' && !(error instanceof FunctionDeclined)) {
    throw error;
  }
  return fallbackCall(name, args, modes, call);
}

/** Attach recovery to an async result; the caller keeps the synchronous path allocation-free. */
function recoverAsyncCall(
  result: MaybePromise<ValueGroup>,
  name: string,
  args: ValueGroup,
  modes: EvalModes,
  call: WrittenCall
): MaybePromise<ValueGroup> {
  if (!isThenable(result)) {
    return result;
  }
  return result.catch(error => recoverCallFailure(error, name, args, modes, call));
}

/**
 * The value→string hook supplied to Tier-B fns: a Quoted's INNER text (unquoted;
 * escaped `~"…"` already
 * arrives as an `Any` whose bytes ARE the inner text), text without the paren
 * groups written around it (a callable reads the text: `escape((e("a b")))` is
 * `a%20b`; ledger J16), any other value its canonical emitted bytes.
 * Boundary-clean (operates on the value domain only).
 */
const stringify = (v: ValueGroup): string =>
  !isValueGroupArray(v) && v.type === 'Quoted' ? v.value : readText(v);

/**
 * Build the typed `ValueEvaluator`. No pre-pass: values are computed
 * on demand during the single serialize walk. The fn set is CALLER-INJECTED via
 * `registry` (populate it from a DIALECT INDEX — `makeLessRegistry()` /
 * `makeSassRegistry()` in `@jesscss/fns`), so registration stays outside core.
 * Core imports no fn bodies here.
 */
export function buildEvaluator(
  registry: FnRegistry,
  options: { readonly sassCalculations?: boolean; readonly sassOperands?: boolean; readonly parseSelector?: SelectorParse } = {}
): ValueEvaluator {
  const { parseSelector } = options;
  const rejectEmpty = options.sassOperands === true;
  const call = (
    name: string,
    args: ValueGroup,
    modes: EvalModes,
    scope?: FnScope | null,
    io?: FnIo,
    scopedFn?: Fn,
    ambient = true,
    written?: WrittenArguments,
    authored?: readonly ArgumentKeyword[]
  ): MaybePromise<ValueGroup> => {
    /*
     * [plugin/P1] Scoped `@plugin`/`@use` fns shadow built-ins and are consulted
     * FIRST. The serializer normally passes an already-resolved `scopedFn`, so
     * the hot call path never repeats a lexical lookup. `scope` remains only for
     * direct consumers of the legacy lazy lookup seam.
     */
    const scoped = scopedFn ?? scope?.lookup(name);

    /*
     * FunctionMode `preserve` (Less v5 default): a bare/global fn reference that
     * resolves to a built-in but can't produce a value for these args — a modern
     * color syntax (`hsl(198deg 28% 50%)`), a relative/`var()` color arg, or a
     * non-color first arg to `contrast`/`lighten` (the CSS filter) — renders
     * as-is, like an unknown CSS function, rather than throwing (ledger C17).
     * The same holds for a scoped `@plugin`/`@use` fn. (Only fn-dispatch errors are
     * caught here; variable-resolution / mixin-recursion errors are thrown
     * outside `dispatch` and still propagate.) A slash list passed to a
     * parameter typed as a number is its quotient ({@link numberArguments}).
     */
    const fn = scoped ?? (ambient ? registry.get(name) : undefined);
    if (fn) {
      try {
        const result = dispatchFn(fn, numberArguments(fn, args, evaluator, modes), { modes, stringify, io, parseSelector });
        return isThenable(result) ? recoverAsyncCall(result, name, args, modes, { written, authored, rejectEmpty }) : result;
      } catch (err) {
        return recoverCallFailure(err, name, args, modes, { written, authored, rejectEmpty });
      }
    }

    // Unknown function: emit verbatim.
    return fallbackCall(name, args, modes, { written, authored, rejectEmpty });
  };

  /* The callee's declared parameter names — the binding surface a keyword
   * argument resolves against. Scoped fns shadow built-ins here exactly as they
   * do in `call`, so a call binds against the definition it will actually reach. */
  const paramNames = (name: string, scopedFn?: Fn, ambient = true): readonly (string | undefined)[] | undefined => {
    const fn = scopedFn ?? (ambient ? registry.get(name) : undefined);
    return fn === undefined ? undefined : fn.params.map(p => p.name);
  };

  /*
   * `unitMode` reaches comparison, not just arithmetic: `strictUnits` used to make
   * `1px + 3em` a hard error while `2px > 1em` stayed a silent `false`.
   */
  const compare = (op: string, left: ValueGroup, right: ValueGroup, modes: EvalModes): boolean =>
    compareValues(op, left, right, modes.unitMode);

  const compareMatch = (op: string, left: ValueGroup, right: ValueGroup, modes: EvalModes): boolean =>
    compareMatchValues(op, left, right, modes.unitMode);

  const typeCheck = (name: string, args: ValueGroup, _modes: EvalModes): boolean => {
    const values: Value[] = [];
    for (const value of groupItems(args)) {
      if (isValueGroupArray(value)) {
        return false;
      }
      values.push(value);
    }
    return typeCheckValues(name, values);
  };

  const evaluator: ValueEvaluator = {
    /* `.scss` computes `*` and `/` units as Dart Sass does (ledger V32). */
    operate: options.sassCalculations === true ? (op, left, right, modes) => operate(op, left, right, modes, true) : operate,
    call,
    paramNames,
    has: name => registry.has(name),
    compare,
    compareMatch,
    typeCheck,
    sassCalculations: options.sassCalculations === true,
    sassOperands: options.sassOperands === true
  };
  return evaluator;
}
