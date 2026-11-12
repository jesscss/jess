/**
 * Lean typed dispatch + fn registry for the value domain. Each fn declares the
 * semantic value node type(s) it accepts (`type: 'Color'`, `type:
 * ['Keyword', 'Quoted']`, or `type: 'any'`), and the registry validates/binds
 * positionally before calling the tiny function body. The fn set is
 * CALLER-POPULATED (`registerAll(FN_LIST)`), not hard-imported here.
 *
 * HARD MODULE BOUNDARY: value domain + built-in fns only.
 */
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { isValueGroup, isValueGroupArray, type ArgumentKeyword, type EvalModes, type EvalValue, type Value, type ValueEvaluator, type ValueGroup } from './value-eval.js';
import { calcOperand, numberOperand } from './math-operand.js';
import { groupItems } from './value-list.js';
import { coerceNamedColorKeyword } from './literal-tag.js';
import { callKeyword, makeCollection, NULL } from './value-factory.js';
import { keepAsWritten } from './value-operate.js';
import type {
  DefinedFunction,
  Fn,
  FnCtx,
  FnSpec,
  FunctionBodyArgs,
  Kind,
  LazyValue,
  ParamSpec
} from './functions/types.js';

/**
 * Thrown by a function that DECLINES the call rather than failing it: the call
 * is then written out as-is, exactly as a call to no function would be. A Less
 * 4.x legacy `@plugin` function declines by returning `null`/`undefined`
 * (`less/lib/less/tree/call.js`); functionMode does not turn a decline into an
 * error, because nothing failed.
 */
export class FunctionDeclined extends Error {
  /** `bound`: the arguments as the callable bound them, when they are what the CSS function of its name takes. */
  constructor(readonly bound?: readonly ValueGroup[], readonly respelled = false) {
    super('The function declined the call.');
    this.name = 'FunctionDeclined';
  }
}

type DirectInput = ValueGroup | LazyValue;
const VALUE_TYPES: ReadonlySet<string> = new Set([
  'Dimension',
  'Color',
  'Quoted',
  'Keyword',
  'FunctionCall',
  'Arithmetic',
  'Any',
  'Url',
  'List',
  'Block',
  'Bool',
  'Null',
  'Collection'
]);

type NormalizedParamType = readonly Kind[] | 'any';

function isValueForType(value: ValueGroup, type: NormalizedParamType): boolean {
  return type === 'any' || (!isValueGroupArray(value) && type.some(kind => kind === value.type));
}

function isKind(value: unknown): value is Kind {
  return typeof value === 'string' && VALUE_TYPES.has(value);
}

function normalizeParamType(value: unknown): readonly Kind[] | 'any' | null {
  if (value === 'any') {
    return 'any';
  }
  if (isKind(value)) {
    return [value];
  }
  if (Array.isArray(value) && value.every(isKind)) {
    return value;
  }
  return null;
}

function paramType(param: ParamSpec): NormalizedParamType {
  const normalized = normalizeParamType(param.type ?? param.kinds);
  if (normalized === null) {
    throw new TypeError('function parameter must declare a value type');
  }
  return normalized;
}

const isRest = (param: ParamSpec): boolean => param.rest === true;

/** Whether a parameter is checked as a colour, so a colour name passed to it is read as one. */
export function takesColor(param: ParamSpec | undefined): boolean {
  const type = param === undefined ? null : normalizeParamType(param.type ?? param.kinds);
  return type !== null && type !== 'any' && type.includes('Color');
}

/**
 * A parameter typed as a number (it accepts a `Dimension` and not a `List`)
 * expects a number, so a slash list passed to it is its quotient
 * ({@link numberOperand}; ledger P35, owner 2026-10-30), whether a reference
 * delivers it (`percentage(@d)` with `@d: 10px/2` is `500%`) or the call writes
 * it in place (`percentage(16/17)` is `94.11764706%`). A parameter that accepts
 * any value, or a list, receives the list (`length(16/17)` is `2`). Each
 * argument is governed by its own parameter, then by the `rest` parameter, or
 * a variadic function's last one.
 */
export function numberArguments(fn: Fn, items: readonly ValueGroup[], ev: Pick<ValueEvaluator, 'operate' | 'sassOperands' | 'sassCalculations'>, modes: EvalModes): readonly ValueGroup[] {
  let out: ValueGroup[] | undefined;
  const tail = fn.variadic === true ? fn.params.at(-1) : fn.params.find(isRest);
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    if (isValueGroupArray(item)) {
      continue;
    }
    const isCalc = item.type === 'FunctionCall' && item.name === 'calc' && ev.sassCalculations !== true;
    if (!isCalc && (item.type !== 'List' || item.sep !== '/')) {
      continue;
    }
    const param = fn.params[index] ?? tail;
    const type = param === undefined ? null : normalizeParamType(param.type ?? param.kinds);
    if (type !== null && type !== 'any' && type.includes('Dimension') && (isCalc || !type.includes('List'))) {
      (out ??= [...items])[index] = isCalc ? calcOperand(item, ev) : numberOperand(item, ev, modes);
    }
  }
  return out ?? items;
}

function isParamSpec(value: unknown): value is ParamSpec {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as { readonly type?: unknown; readonly kinds?: unknown };
  return normalizeParamType(record.type ?? record.kinds) !== null;
}

function isFnSpec(value: unknown): value is FnSpec {
  return typeof value === 'object'
    && value !== null
    && 'params' in value
    && Array.isArray(value.params)
    && value.params.every(isParamSpec)
    && 'body' in value
    && typeof value.body === 'function';
}

/*
 * The empty list is also the empty map, so it satisfies a `Collection` slot as
 * that map at the bind point, as Sass reads it: `map.get((), a)` is `null` and
 * `map.merge((), (z: 9))` is `(z: 9)` (Sass's empty `()` is the empty curly
 * list, owner 2026-10-23: *"so that Sass functions still work"*).
 */
const EMPTY_COLLECTION = makeCollection([]);
const isListShaped = (value: ValueGroup): boolean =>
  isValueGroupArray(value) || value.type === 'List' || value.type === 'Block';

/** css-color-4 §4.4 `currentcolor` and the §6.2 system colours: colours whose value only the browser knows. */
const BROWSER_COLORS: ReadonlySet<string> = new Set(['currentcolor', 'accentcolor', 'accentcolortext', 'activetext', 'buttonborder', 'buttonface', 'buttontext', 'canvas', 'canvastext', 'field', 'fieldtext', 'graytext', 'highlight', 'highlighttext', 'linktext', 'mark', 'marktext', 'selecteditem', 'selecteditemtext', 'visitedtext']);

/** Whether `value` holds what only the browser knows: `var()`, `env()`, `attr()`, an unknown function. */
function holdsDeferred(value: EvalValue): boolean {
  if (typeof value === 'string') {
    return false;
  }
  if (isValueGroupArray(value)) {
    return value.some(holdsDeferred);
  }
  switch (value.type) {
    case 'FunctionCall': return value.result === null || value.name === 'var' || holdsDeferred(value.args);
    case 'Arithmetic': return holdsDeferred(value.left) || holdsDeferred(value.right);
    case 'List': return holdsDeferred(value.value);
    default: return false;
  }
}

/** Whether a keyword names a colour only the browser knows. */
export const isBrowserColor = (text: string): boolean => BROWSER_COLORS.has(text.toLowerCase());

/**
 * Whether a slot that takes a call (a built-in's CSS form) takes `value`, which
 * only the browser can read: a call of no known type or of the slot's type, or
 * a browser colour in a colour slot. A call whose type is known and wrong fails
 * the slot, as its spelling does (docs/design/CSS-NATIVE-BUILTINS.md §3.2, §3.6).
 * Math is the slot's type only over what the browser alone knows: all its leaves
 * written (`calc(1px + 1em)`) it has no number a form can hold, and fails too (V18).
 */
function isDeferred(value: Value, type: readonly Kind[]): boolean {
  switch (value.type) {
    case 'FunctionCall':
      return value.result === null || (value.result === 'color' ? type.includes('Color') : type.includes('Dimension') && holdsDeferred(value));
    case 'Arithmetic':
      return type.includes('Dimension') && holdsDeferred(value);
    case 'Keyword':
      return type.includes('Color') && isBrowserColor(value.text);
    default:
      return false;
  }
}

const NUMBER_SLOT: readonly Kind[] = ['Dimension', 'FunctionCall'];

/** Whether `value` is a number only the browser knows ({@link isDeferred}). */
export const isUnknownNumber = (value: unknown): boolean =>
  isValueGroup(value) && !isValueGroupArray(value) && isDeferred(value, NUMBER_SLOT);

const isNumberOrAbsent = (value: unknown): boolean =>
  value === undefined || isUnknownNumber(value) || (isValueGroup(value) && !isValueGroupArray(value) && value.type === 'Dimension');

/**
 * A built-in over a number only the browser knows, where CSS has a function of
 * its name, is that function (V38): the call declines, and is written out under
 * the name after any namespace (`math.sqrt(var(--x))` is `sqrt(var(--x))`). An
 * argument that is no number fails as it does beside a known one.
 */
export function declineOverUnknown(args: readonly unknown[], bound?: readonly ValueGroup[], respelled = false): void {
  if (args.some(isUnknownNumber) && args.every(isNumberOrAbsent)) {
    throw new FunctionDeclined(bound, respelled);
  }
}

const isPassed = (value: unknown): value is ValueGroup =>
  value !== undefined && isValueGroup(value) && (isValueGroupArray(value) || value.type !== 'Null');

/** A parameter of a `cssFunction`, which also takes what only the browser knows. */
function cssFunctionParam(param: ParamSpec): ParamSpec {
  const type = paramType(param);
  return type === 'any' ? param : { ...param, kinds: undefined, type: [...type, 'FunctionCall'] };
}

function validateValue(name: string, index: number, type: NormalizedParamType, value: unknown): ValueGroup {
  if (!isValueGroup(value)) {
    throw new TypeError(`${name}: each argument must be a value node`);
  }

  /*
   * NamedColor→Keyword convergence: a named-color keyword (`red`) satisfies a
   * `Color`-typed parameter by materializing to its `Color` at the bind point —
   * the point of USE — without the un-operated literal ever being reclassified.
   * `lighten(red, 10%)` binds `#ff0000`; a keyword that is not a named color
   * still fails the `Color` slot as before. A call written out as-is is read
   * as the keyword that spells it, unless the slot asks for the call.
   */
  const single = isValueGroupArray(value) ? undefined : value;
  if (single !== undefined && type !== 'any' && type.includes('FunctionCall') && isDeferred(single, type)) {
    return single;
  }
  const bound = type === 'any'
    ? value
    : single?.type === 'FunctionCall' || single?.type === 'Arithmetic'
      ? keepAsWritten(callKeyword(single))
      : single?.type === 'Keyword' && type.includes('Color')
        ? coerceNamedColorKeyword(single)
        : type.includes('Collection') && groupItems(value).length === 0 && isListShaped(value)
          ? EMPTY_COLLECTION
          : value;
  if (!isValueForType(bound, type)) {
    const expected = type === 'any' ? 'any' : type.filter(kind => kind !== 'FunctionCall').join('|');
    throw new TypeError(`${name}: arg ${index} expected ${expected}, got ${isValueGroupArray(bound) ? 'sequence' : bound.type}`);
  }
  return bound;
}

function checkedLazy(
  name: string,
  index: number,
  type: NormalizedParamType,
  thunk: unknown
): LazyValue<ValueGroup> {
  if (typeof thunk !== 'function') {
    throw new TypeError(`${name}: lazy argument ${index} must be a thunk`);
  }
  return () => {
    const value = thunk();
    if (value instanceof Promise) {
      return value.then(result => validateValue(name, index, type, result));
    }
    return validateValue(name, index, type, value);
  };
}

/**
 * Whether `input` is core's absent value: an implicit `null`, never one the
 * author wrote. A call that names a later parameter by keyword fills each
 * parameter it skipped with it (`orderKeywordArgs`), so an optional parameter
 * reads it as an argument that was not passed. Checked by shape, not identity:
 * a provided module may run on a second copy of core.
 */
const isAbsent = (input: DirectInput): boolean =>
  typeof input !== 'function' && !isValueGroupArray(input) && input.type === 'Null' && !input.explicit;

export function bindDirect(name: string, params: readonly ParamSpec[], inputs: readonly (DirectInput | undefined)[]): unknown[] {
  const out: unknown[] = [];
  let offset = 0;
  for (let index = 0; index < params.length; index++) {
    const param = params[index]!;
    if (param.rest) {
      const supplied = inputs[offset];
      const rest = inputs.length === offset + 1 && Array.isArray(supplied)
        ? supplied
        : inputs.slice(offset);
      const type = paramType(param);
      out.push(param.lazy
        ? rest.map(value => checkedLazy(name, index, type, value))
        : rest.map(value => validateValue(name, index, type, value)));
      offset = inputs.length;
      continue;
    }
    const input = inputs[offset++];
    if (input === undefined || ((param.optional || param.default !== undefined) && isAbsent(input))) {
      if (param.default !== undefined) {
        out.push(param.default);
        continue;
      }
      if (param.optional) {
        out.push(undefined);
        continue;
      }
      throw new TypeError(`${name}: missing required argument ${param.name ?? index}`);
    }
    const type = paramType(param);
    out.push(param.lazy
      ? checkedLazy(name, index, type, input)
      : validateValue(name, index, type, input));
  }
  if (offset < inputs.length) {
    throw new TypeError(`${name}: too many arguments`);
  }
  return out;
}

/**
 * A function over the call's arguments ({@link Fn}). A positional body receives
 * each parameter's value, checked, a `lazy` one as a thunk, a `rest` one as an
 * array; a variadic body receives the arguments and the {@link FnCtx}.
 */
export function defineFunction<const P extends readonly ParamSpec[]>(
  name: string,
  spec: {
    readonly params: P;
    readonly body: (...args: FunctionBodyArgs<NoInfer<P>>) => MaybePromise<ValueGroup>;
    readonly cssFunction?: boolean;
    readonly variadic?: false;
  },
): DefinedFunction<P>;
export function defineFunction<const P extends readonly ParamSpec[]>(
  name: string,
  spec: {
    readonly params: P;
    readonly body: (...args: never[]) => MaybePromise<ValueGroup>;
    readonly cssFunction?: boolean;
    readonly variadic?: false;
  },
): DefinedFunction<P>;
export function defineFunction(name: string, spec: FnSpec & { readonly name?: string }): Fn;
export function defineFunction(
  name: string,
  spec: unknown
): unknown {
  if (!isFnSpec(spec)) {
    throw new TypeError(`${name}: function definition must contain params and a callable body`);
  }

  /* Each closure reads only constants captured here, never the caller's spec literal, whose key set varies by caller. */
  let callable: (args: readonly ValueGroup[], ctx: FnCtx) => MaybePromise<ValueGroup>;
  if (spec.variadic === true) {
    const { body } = spec;
    callable = (args, ctx) => body(args, ctx);
  } else {
    const { params, body } = spec;
    const slots = spec.cssFunction === true ? params.map(cssFunctionParam) : params;
    const cssFunction = spec.cssFunction === true;
    const restParam = params.find(isRest);

    /*
     * Each argument is governed by its own parameter, or by the `rest` parameter
     * once the declared slots run out, so `lazy` is honoured for rest items too.
     * The array is built from the SUPPLIED arguments, never from `params`, so
     * `bindDirect`'s `too many arguments` stays reachable.
     */
    const lazy = params.some(param => param.lazy === true);
    callable = (args) => {
      const bound = bindDirect(name, slots, lazy ? args.map((item, index) => (params[index] ?? restParam)?.lazy ? () => item : item) : args);
      if (cssFunction) {
        /* What the call passed, in parameter order, is what the CSS function takes: no name, no `null` (a declared optional's). */
        const passed = bound.flat().filter(isPassed);
        declineOverUnknown(passed, passed);
      }
      return Reflect.apply(body, undefined, bound);
    };
  }
  const fn = Object.assign(callable, { params: spec.params, variadic: spec.variadic, filter: spec.filter });
  Object.defineProperty(fn, 'name', { value: name, configurable: true });
  return fn;
}

/**
 * A caller-populated table of built-in fns plus the dispatch over it. Fn `name`s
 * are lower-case; lookups fold case.
 */
export interface FnRegistry {
  /** Register a single fn (overwrites any prior entry with the same name). */
  register(fn: Fn): void;

  /** Register every fn in a list (bulk `register`). */
  registerAll(fns: readonly Fn[]): void;

  /** Whether a built-in implementation exists for `name`. */
  has(name: string): boolean;

  /** The registered implementation for `name`, or `undefined`. Read for the
   *  callee's DECLARED parameter names when a call carries keyword arguments —
   *  binding by name needs the definition, not just the ability to dispatch. */
  get(name: string): Fn | undefined;

  /** Call the function registered as `name` ({@link Fn}). */
  dispatch(name: string, args: readonly ValueGroup[], ctx: FnCtx): MaybePromise<ValueGroup>;
}

/** Create an empty {@link FnRegistry}; the caller populates it via `registerAll`. */
export function createFnRegistry(): FnRegistry {
  const table = new Map<string, Fn>();

  // Keys are stored lower-cased so lookups (also lower-cased) can't silently miss.
  return {
    register(fn) {
      table.set(fn.name.toLowerCase(), fn);
    },
    registerAll(fns) {
      for (const fn of fns) {
        table.set(fn.name.toLowerCase(), fn);
      }
    },
    has(name) {
      return table.has(name.toLowerCase());
    },
    get(name) {
      return table.get(name.toLowerCase());
    },
    dispatch(name, args, ctx) {
      const fn = table.get(name.toLowerCase());
      if (!fn) {
        throw new Error(`no fn: ${name}`);
      }
      return fn(args, ctx);
    }
  };
}

/**
 * Place KEYWORD arguments at the positions their names DECLARE.
 *
 * A keyword argument (`fade(@c, @amount: 50%)`, `color.adjust($c, $lightness: -10%)`)
 * states a BINDING, not a position, and the only place that mapping exists is the
 * callee's own parameter list — so the order comes from the resolved function
 * ({@link ValueEvaluator.paramNames}), never from the call site.
 *
 * Called only for a call that names an argument: the caller's one
 * `name !== undefined` scan keeps an ordinary positional call off this path.
 *
 * It also returns `vals` unchanged when the callee declares no parameter by that
 * name (or is unknown): the call then reaches dispatch with exactly its authored
 * argument vector and fails — or preserves — as an ordinary argument-shape
 * mismatch. Guessing a position for a name the definition never declared is the
 * silent wrong lowering this exists to prevent.
 */
export function orderKeywordArgs(
  args: readonly ArgumentKeyword[],
  vals: ValueGroup[],
  params: readonly (string | undefined)[] | undefined
): ValueGroup[] {
  if (params === undefined) {
    return vals;
  }

  const slots = new Array<ValueGroup | undefined>(params.length);
  const positional: ValueGroup[] = [];
  for (let i = 0; i < args.length; i++) {
    const argName = args[i]!.name;
    if (argName === undefined) {
      positional.push(vals[i]!);
      continue;
    }
    const at = params.indexOf(argName);
    if (at === -1) {
      return vals;
    }
    slots[at] = vals[i]!;
  }

  /* Positional arguments keep their authored order and fill the slots the
   * keywords did not claim — Less and Sass both allow the two forms to mix. A
   * parameter skipped before the last bound one gets the core-minted absent
   * value, {@link NULL}, which an optional parameter binds as not passed, so
   * every keyword stays at its own parameter's position:
   * `color.adjust($c, $lightness: 10%)` never reads `10%` as `$red`, and
   * `string.slice("abcd", $end-at: 2)` does not bind `2` to `$start-at`. */
  let next = 0;
  for (let at = 0; at < slots.length && next < positional.length; at++) {
    slots[at] ??= positional[next++];
  }
  while (slots.length > 0 && slots[slots.length - 1] === undefined) {
    slots.pop();
  }
  return Array.from(slots, slot => slot ?? NULL).concat(positional.slice(next));
}
