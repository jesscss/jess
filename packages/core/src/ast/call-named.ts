/**
 * A function called from JS with named arguments: each value goes to its
 * parameter's position, and a parameter left out binds as not passed. A colour
 * name given to a parameter checked as a colour is that colour, as in a
 * compiled call (`compileArguments` in `value-dispatch.ts`). The one
 * route besides the {@link Fn} convention, in a module of its own so that only a
 * caller holding named arguments bundles it.
 */
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import type { DefinedFunction, Fn, FnCtx, FnRecord, ParamSpec } from './functions/types.js';
import { coerceNamedColorKeyword } from './literal-tag.js';
import { isValueGroup, isValueGroupArray, type ValueGroup } from './value-eval.js';

export function callNamed<const P extends readonly ParamSpec[]>(fn: DefinedFunction<P>, record: FnRecord<P>, ctx: FnCtx): MaybePromise<ValueGroup>;
export function callNamed(fn: Fn, record: Readonly<Record<string, ValueGroup>>, ctx: FnCtx): MaybePromise<ValueGroup>;
export function callNamed(fn: Fn, record: object, ctx: FnCtx): MaybePromise<ValueGroup> {
  const args: ValueGroup[] = [];
  fn.params.forEach((param, index) => {
    const value: unknown = param.name !== undefined && Object.hasOwn(record, param.name) ? Reflect.get(record, param.name) : undefined;
    if (isValueGroup(value)) {
      args[index] = !isValueGroupArray(value) && value.type === 'Keyword' && fn.colorSlots[index] === true ? coerceNamedColorKeyword(value) : value;
    }
  });
  return fn(args, ctx);
}
