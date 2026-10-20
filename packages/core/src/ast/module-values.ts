/**
 * A script module's exports as stylesheet values: its functions as `Fn`s and its
 * other exports as AST values, bound by the evaluator's module imports.
 */
import { mapMaybe } from '@jesscss/awaitable-pipe';
import type { Fn } from './functions/types.js';
import { sniffLiteral } from './literal-tag.js';
import { collection, collectionEntry, dimension, keyword, list, NULL_NODE } from './nodes.js';
import type { ValueSlot } from './nodes.js';
import { defineFunction } from './value-dispatch.js';
import { isValueGroup } from './value-eval.js';
import type { ValueGroup } from './value-eval.js';
import { makeBool, makeDimension, NULL } from './value-factory.js';
import { groupItems } from './value-list.js';

export function isModuleFn(value: unknown): value is Fn {
  return typeof value === 'function'
    && 'params' in value
    && Array.isArray(value.params);
}

export type ModuleCallable = (...args: unknown[]) => unknown;

export function isModuleCallable(value: unknown): value is ModuleCallable {
  return typeof value === 'function';
}

function moduleFunctionResult(value: unknown, name: string): ValueGroup {
  if (isValueGroup(value)) {
    return value;
  }
  if (typeof value === 'number') {
    return makeDimension(value);
  }
  if (typeof value === 'string') {
    // A JS module function's plain string never passed through a parser; its text is its only fact.
    return sniffLiteral(value);
  }
  if (typeof value === 'boolean') {
    return makeBool(value);
  }
  if (value === null || value === undefined) {
    return NULL;
  }
  throw new TypeError(`Module function "${name}" returned an unsupported value.`);
}

export function bindModuleFunction(value: ModuleCallable | Fn, name: string): Fn {
  if (isModuleFn(value)) {
    return defineFunction(name, {
      params: value.params,
      variadic: true,
      body: (args, context) => value(args, context)
    });
  }
  return defineFunction(name, {
    params: [],
    variadic: true,
    body: args => mapMaybe(
      value(...groupItems(args)),
      result => moduleFunctionResult(result, name)
    )
  });
}

export function moduleAstValue(value: unknown, name: string, seen: Set<object> | null = null): ValueSlot {
  if (value === null) {
    return NULL_NODE;
  }
  if (typeof value === 'string') {
    return keyword(value);
  }
  if (typeof value === 'number') {
    return dimension(value);
  }
  if (typeof value === 'boolean') {
    return keyword(value ? 'true' : 'false');
  }
  if (typeof value === 'object') {
    if (seen?.has(value)) {
      throw new TypeError(`Module export "${name}" is cyclic.`);
    }
    seen ??= new Set();
    seen.add(value);
    if (Array.isArray(value)) {
      const result = list(value.map((item, index) => moduleAstValue(item, `${name}[${index}]`, seen)));
      seen.delete(value);
      return result;
    }
    const entries = Object.entries(value).map(([key, member]) =>
      collectionEntry(keyword(key), moduleAstValue(member, `${name}.${key}`, seen))
    );
    seen.delete(value);
    return collection(entries);
  }
  throw new TypeError(`Module export "${name}" is not a supported stylesheet value.`);
}

/**
 * The name a namespace calls an export by: a function's own name, the one it
 * dispatches under (`map.has-key`, never the export key `hasKey`); any other
 * callable's export key.
 */
export const moduleMemberName = (key: string, value: ModuleCallable | Fn): string => (isModuleFn(value) ? value.name : key);
