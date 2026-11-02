/**
 * A script module's exports as stylesheet values: its functions as `Fn`s and its
 * other exports as AST values, bound by the evaluator's module imports.
 */
import { mapMaybe } from '@jesscss/awaitable-pipe';
import type { Fn } from './functions/types.js';
import { formatNumber } from './format-number.js';
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

import type { FnOrigin } from './functions/types.js';

export type { FnOrigin };

export function bindModuleFunction(value: ModuleCallable | Fn, name: string, origin: FnOrigin): Fn {
  const fn = isModuleFn(value)
    ? defineFunction(name, {
        params: value.params,
        variadic: true,
        body: (args, context) => value(args, context)
      })
    : moduleCallable(value, name);
  return Object.assign(fn, { origin });
}

function moduleCallable(value: ModuleCallable, name: string): Fn {
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
    /* A JS number has no authored spelling: write it as every computed number is (ledger V4). */
    return dimension(value, '', Number.isFinite(value) ? formatNumber(value) : `${value}`);
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
 * The export holding a module's members whose names a JS identifier cannot
 * spell (`sass:math`'s `$max-number`): a plain object whose own string keys are
 * member names. Its entries are bound as if each were an export; the table
 * itself is not a member.
 */
export const MEMBER_TABLE = '$members';

const isMemberTable = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A module's members by the names a stylesheet reads them under. */
export function moduleMembers(module: Readonly<Record<string, unknown>>): [string, unknown][] {
  const members = Object.entries(module).filter(([name]) => name !== MEMBER_TABLE);
  const table = module[MEMBER_TABLE];
  return isMemberTable(table) ? members.concat(Object.entries(table)) : members;
}

/** The member a stylesheet names `name`: an export, else an entry of the member table. */
export function requireModuleMember(module: Readonly<Record<string, unknown>>, name: string): unknown {
  const table = module[MEMBER_TABLE];
  if (name !== MEMBER_TABLE && Object.prototype.hasOwnProperty.call(module, name)) {
    return module[name];
  }
  if (isMemberTable(table) && Object.prototype.hasOwnProperty.call(table, name)) {
    return table[name];
  }
  throw new TypeError(`Module has no export named "${name}".`);
}

/**
 * The name a namespace calls an export by: a function's own name, the one it
 * dispatches under (`map.has-key`, never the export key `hasKey`); any other
 * callable's export key.
 */
export const moduleMemberName = (key: string, value: ModuleCallable | Fn): string => (isModuleFn(value) ? value.name : key);
