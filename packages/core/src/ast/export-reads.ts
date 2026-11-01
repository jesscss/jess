import type { Context } from '../context.js';
import { ERR } from '../error/diagnostics.js';
import { callSiteLocation } from './call-site-location.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import { funcCall, keyword, type CallValue, type Declaration, type FunctionCall, type Stylesheet, type VariableDeclaration } from './nodes.js';

/**
 * Ledger A4: a root variable marked `@export` publishes a custom property, so a
 * CSS value that reads it IS `var(--name, <its value>)`
 * (docs/architecture/core/spec/R8-browser-runtime.md, slice 1).
 */

/** The `var()` call each exported binding reads as, keyed by the binding. */
export type ExportCalls = ReadonlyMap<CallValue, FunctionCall>;

/** What an export read needs from the evaluator's lane (serialize.ts `Lane`). */
export interface ExportLane {
  /** The declaration whose value is being written, `'argument'` while a mixin argument is bound, else undefined. */
  readonly checks: Declaration | 'argument' | undefined;
  readonly s: { readonly context: Context | undefined; readonly exports: ExportCalls | undefined };
}

/** The `reader` of a variable read that handles an exported binding itself. */
export const READS_EXPORT = {};

/**
 * Every root binding of a name the root exports, each with the call it reads
 * as. A root redeclaration of the name is the export too; a shadow in a nested
 * scope is a different binding and is not. Undefined when nothing is exported.
 */
export function rootExports(root: Stylesheet): ExportCalls | undefined {
  let names: Set<string> | undefined;
  for (const statement of root.rules) {
    if (statement.type === 'VariableDeclaration' && statement.write.mode === 'export') {
      (names ??= new Set()).add(statement.name);
    }
  }
  if (names === undefined) {
    return undefined;
  }
  const calls = new Map<CallValue, FunctionCall>();
  for (const statement of root.rules) {
    if (statement.type === 'VariableDeclaration' && names.has(statement.name)
      && (isValueSlotArray(statement.value) || statement.value.type !== 'MixinCall')) {
      calls.set(statement.value, funcCall('var', [keyword(`--${statement.name}`), statement.value]));
    }
  }
  return calls;
}

/**
 * A resolved variable read, checked for an export. Read where a CSS value is
 * written, an exported binding resolves to its `var()` call, which then
 * evaluates as the call an author would write: kept in `calc()`, `color-mix()`
 * and any call written as-is, an operand error in math outside a calculation.
 * Anywhere else a `var()` cannot stand in, and the read is an error.
 */
export function exportChecked<F, X>(
  hit: { value: CallValue; frame: F; evaluated: X | null } | undefined,
  name: string,
  lookup: 'live' | 'scoped',
  e: ExportLane,
  reader: object | undefined
): { value: CallValue; frame: F; evaluated: X | null } | undefined {
  if (hit === undefined || reader === READS_EXPORT) {
    return hit;
  }
  const call = e.s.exports?.get(hit.value);
  if (call === undefined) {
    return hit;
  }
  if (typeof e.checks !== 'object') {
    exportNotWritten(reader, lookup === 'live' ? `$${name}` : `@${name}`, name, e, e.checks === 'argument'
      ? 'as a mixin argument, which the runtime cannot follow yet'
      : 'outside a CSS value (a selector, an at-rule prelude, a condition, a string, a url or text spliced around it)');
  }
  return { value: call, frame: hit.frame, evaluated: null };
}

/**
 * A variable read a function Jess computes takes as input (`@less.length(@l)`),
 * resolved with {@link READS_EXPORT}. The function would compute on the `var()`
 * call, not the value, so until the runtime runs it (slice 2) an exported
 * binding is an error here.
 */
export function exportInput<H extends { value: CallValue }>(hit: H | undefined, name: string, reader: object, e: ExportLane): H | undefined {
  if (hit !== undefined && e.s.exports?.has(hit.value) === true) {
    exportNotWritten(reader, `@${name}`, name, e, 'as the input of a function Jess computes, which the runtime cannot run yet');
  }
  return hit;
}

/** An exported variable read where a `var()` cannot replace it. */
function exportNotWritten(reader: object | undefined, symbol: string, name: string, e: ExportLane, where: string): never {
  const node = reader ?? {};
  throw ERR.exportNotAValue({ node, ...callSiteLocation(node, e.s), meta: { symbol, name, where } });
}

/** `@export` publishes a stylesheet's top-level variable; one in a body (`nested`) is an error. */
export function rejectNestedExport(node: VariableDeclaration, nested: boolean, e: ExportLane): void {
  if (node.write.mode === 'export' && nested) {
    throw ERR.exportNotTopLevel({ node, ...callSiteLocation(node, e.s) });
  }
}
