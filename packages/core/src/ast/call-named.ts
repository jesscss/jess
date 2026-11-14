/**
 * A function called from JS with named arguments: each value goes to its
 * parameter's position, and a parameter left out binds as not passed. The one
 * route besides the {@link Fn} convention, in a module of its own so that only a
 * caller holding named arguments bundles it.
 */
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import type { DefinedFunction, Fn, FnCtx, FnRecord, ParamSpec } from './functions/types.js';
import { isValueGroup, type ValueGroup } from './value-eval.js';

export function callNamed<const P extends readonly ParamSpec[]>(fn: DefinedFunction<P>, record: FnRecord<P>, ctx: FnCtx): MaybePromise<ValueGroup>;
export function callNamed(fn: Fn, record: Readonly<Record<string, ValueGroup>>, ctx: FnCtx): MaybePromise<ValueGroup>;
export function callNamed(fn: Fn, record: object, ctx: FnCtx): MaybePromise<ValueGroup> {
  const args: ValueGroup[] = [];
  fn.params.forEach((param, index) => {
    const value: unknown = param.name !== undefined && Object.hasOwn(record, param.name) ? Reflect.get(record, param.name) : undefined;
    if (isValueGroup(value)) {
      args[index] = value;
    }
  });
  return fn(args, ctx);
}
