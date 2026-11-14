import { emitValue, isValueGroup, isValueGroupArray } from '@jesscss/core';
import { callNamed } from '@jesscss/core/call-named';
import type { Fn, FnCtx, Value, ValueGroup } from '@jesscss/core';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';

/** The context the evaluator hands a fn: units preserved, a Quoted stringified as its inner text. */
export const ctx: FnCtx = {
  modes: { unitMode: 'preserve' },
  stringify: value => !isValueGroupArray(value) && value.type === 'Quoted' ? value.value : emitValue(value)
};

/** The evaluator's call: the arguments, plus the context. */
export function call(fn: Fn, ...args: ValueGroup[]): MaybePromise<ValueGroup> {
  return fn(args, ctx);
}

/**
 * A call from JS with named arguments (`callNamed`), after any positional ones,
 * which bind the leading parameters by their names.
 */
export function named(fn: Fn, ...args: [...ValueGroup[], Readonly<Record<string, unknown>>]): MaybePromise<ValueGroup> {
  const record: Record<string, unknown> = { ...args.at(-1) };
  args.slice(0, -1).forEach((value, index) => {
    const name = fn.params[index]?.name;
    if (name !== undefined) {
      record[name] = value;
    }
  });
  return Reflect.apply(callNamed, undefined, [fn, record, ctx]);
}

/** A call from JS that a test spells freely: positional values, then optionally named ones ({@link named}), or input the fn must reject. */
export function invoke(fn: Fn, ...args: unknown[]): unknown {
  const last = args.at(-1);
  return typeof last === 'object' && last !== null && !Array.isArray(last) && !('type' in last)
    ? Reflect.apply(named, undefined, [fn, ...args])
    : Reflect.apply(fn, undefined, [args, ctx]);
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
