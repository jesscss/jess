import { emitValue, isValueGroup, isValueGroupArray, makeList } from '@jesscss/core';
import type { Fn, FnCtx, Value, ValueGroup } from '@jesscss/core';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';

/** The context the evaluator hands a fn: units preserved, a Quoted stringified as its inner text. */
export const ctx: FnCtx = {
  modes: { unitMode: 'preserve' },
  stringify: value => !isValueGroupArray(value) && value.type === 'Quoted' ? value.value : emitValue(value)
};

/** The evaluator's call: the arguments as one comma list, plus the context. */
export function call(fn: Fn, ...args: ValueGroup[]): MaybePromise<ValueGroup> {
  return fn(makeList(args, ','), ctx);
}

/**
 * A direct embedding call — positional values, a named record, or input the fn
 * must reject. An exported fn is typed `Fn`, the evaluator's contract, so this
 * route has no declared signature to check the arguments against.
 */
export function invoke(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== 'function') {
    throw new TypeError('Expected a callable function.');
  }
  return Reflect.apply(fn, undefined, args);
}

const isNodeOf = <K extends Value['type']>(value: Value, type: K): value is Extract<Value, { readonly type: K }> =>
  value.type === type;

/** `result` as a synchronous `type` node; a Promise, a group or another node fails the test. */
export function node<K extends Value['type']>(result: unknown, type: K): Extract<Value, { readonly type: K }> {
  if (isValueGroup(result) && !isValueGroupArray(result) && isNodeOf(result, type)) {
    return result;
  }
  const got = isThenable(result)
    ? 'a Promise'
    : isValueGroup(result) && !isValueGroupArray(result) ? result.type : JSON.stringify(result);
  throw new TypeError(`Expected a synchronous ${type}, got ${got}.`);
}

/** `result` as a synchronous value group; a Promise fails the test. */
export function sync(result: MaybePromise<ValueGroup>): ValueGroup {
  if (isThenable(result)) {
    throw new TypeError('Expected a synchronous result, got a Promise.');
  }
  return result;
}
