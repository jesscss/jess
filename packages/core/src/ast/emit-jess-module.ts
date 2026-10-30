import type { FunctionCall, ModuleImport } from './nodes.js';
import { isValueSlotArray } from './css-grammar-helpers.js';

/** A call through a module namespace (`list.length`): `.jess` calls it as `$list.length(…)`. */
export const MEMBER_CALL = /^[_a-zA-Z][-_a-zA-Z0-9]*\.[_a-zA-Z][-_a-zA-Z0-9]*$/u;

/**
 * `ModuleImport` as `.jess` writes it: `@-use "p" [as ns]` / `@-from "p" import …`.
 * A `sass:selector` namespace adds its `parse` call name to `selectorParse`.
 */
export function moduleImportText(node: ModuleImport, selectorParse: Set<string>): string {
  const path = node.path.src;
  if (node.mode === 'use' && node.path.value === '#sass/selector' && node.namespace !== '*') {
    selectorParse.add(`${node.namespace ?? 'selector'}.parse`);
  }
  if (node.mode === 'use') {
    return `@-use ${path}${node.namespace === null ? '' : ` as ${node.namespace}`};`;
  }
  const names = node.imports.map(s => (s.alias === null ? s.name : `${s.name} as ${s.alias}`)).join(', ');
  const what = node.namespace !== null
    ? `* as ${node.namespace}`
    : node.defaultImport !== null
      ? `${node.defaultImport}${names === '' ? '' : `, (${names})`}`
      : `(${names})`;
  return `@-from ${path} import ${what};`;
}

/**
 * The selector list a `selector.parse("…")` call's one plain string holds, which
 * `.jess` writes as the capture `selector(…)`, the same value (ledger P49); `null`
 * for any other argument, and for a string holding `&` or `%`, which the capture
 * reads as a parent selector, or does not read (a placeholder), where
 * `selector.parse()` rejects or reads it. A `null` keeps the call, which computes
 * the same value.
 */
export function selectorParseLiteral(node: FunctionCall): string | null {
  const arg = node.args.length === 1 ? node.args[0]! : undefined;
  const value = arg === undefined || arg.spread || arg.name !== undefined ? undefined : arg.value;
  if (value === undefined || isValueSlotArray(value) || value.type !== 'Quoted' || value.interp !== null) {
    return null;
  }
  const text = value.value.trim();
  return text === '' || /[&%]/u.test(text) ? null : text;
}

/**
 * A `.scss` `unquote("…")` (or `string.unquote("…")`) of one plain string is
 * `.jess`'s escaped string `~"…"`, the same string value (owner 2026-10-22:
 * *"`unquote(" + ")` should be de-sugared in .jess to `~" + "`"*); `null` for
 * any other argument, which keeps the call's lowering, and when the source
 * dialect's functions (`hasUnquote`) have no `unquote`.
 */
export function unquoteLiteral(node: FunctionCall, hasUnquote: boolean): string | null {
  const arg = hasUnquote && /^(?:string\.)?unquote$/u.test(node.name) && node.args.length === 1 ? node.args[0]! : undefined;
  const value = arg === undefined || arg.spread || arg.name !== undefined ? undefined : arg.value;
  if (value === undefined || isValueSlotArray(value) || value.type !== 'Quoted' || value.interp !== null || value.escaped || /\$[[({]/u.test(value.value)) {
    return null;
  }
  return `~${value.quote}${value.value}${value.quote}`;
}

/** A `selector.parse("…")` call as `.jess` writes it, `selector(…)` ({@link selectorParseLiteral}), or `null`. */
export function selectorParseCall(node: FunctionCall): string | null {
  const text = selectorParseLiteral(node);
  return text === null ? null : `selector(${text})`;
}
