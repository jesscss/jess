import type { Context } from '../context.js';
import { ERR } from '../error/diagnostics.js';
import { callSiteLocation } from './call-site-location.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import type { Declaration, ValueSlot } from './nodes.js';

/** What a declaration value holds that is legacy Internet Explorer syntax. */
export interface LegacyIeSyntax {
  /** The construct as the message names it: `progid:` or `opacity=`. */
  readonly what: string;
  readonly fix: string;
}

/** A `progid:` value. */
export const PROGID_IE_SYNTAX: LegacyIeSyntax = {
  what: 'progid:',
  fix: 'Remove the declaration, or write what the filter did in standard CSS (opacity, a linear-gradient() background, or the filter property\'s functions).'
};

/**
 * The legacy IE syntax in a declaration value, read from its parsed shape (owner
 * 2026-10-16: valid, balanced syntax parses, and legacy IE syntax is then an
 * error). Two forms:
 *
 * - a `progid:` value: the keyword `progid` (any case) and the `:` delim after
 *   it, in a value run;
 * - a `name=value` call argument: a positional argument that is exactly an
 *   identifier, the `=` delim and one value (`alpha(opacity=50)`). Less reads
 *   `=` in a call argument as its comparison, so a Less argument never has
 *   this shape.
 *
 * Only runs, comma lists, paren groups and call arguments are entered; every
 * other value is a leaf here. Strings, custom properties and queries never
 * reach a declaration value run.
 */
export function legacyIeSyntaxIn(value: ValueSlot): LegacyIeSyntax | undefined {
  if (isValueSlotArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i]!;
      if (isProgid(item, value[i + 1])) {
        return PROGID_IE_SYNTAX;
      }
      const found = legacyIeSyntaxIn(item);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  switch (value.type) {
    case 'FunctionCall':
      for (const arg of value.args) {
        const found = (arg.name === undefined ? nameValueArgument(arg.value) : undefined) ?? legacyIeSyntaxIn(arg.value);
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    case 'List':
      for (const item of value.value) {
        const found = legacyIeSyntaxIn(item);
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    case 'Block':
      return legacyIeSyntaxIn(value.value);
    default:
      return undefined;
  }
}

function isProgid(item: ValueSlot, next: ValueSlot | undefined): boolean {
  return !isValueSlotArray(item) && item.type === 'Keyword' && item.src.length === 6 && item.src.toLowerCase() === 'progid'
    && next !== undefined && !isValueSlotArray(next) && next.type === 'Any' && next.src === ':';
}

function nameValueArgument(arg: ValueSlot): LegacyIeSyntax | undefined {
  if (!isValueSlotArray(arg) || arg.length !== 3) {
    return undefined;
  }
  const name = arg[0]!;
  const delim = arg[1]!;
  if (isValueSlotArray(name) || name.type !== 'Keyword' || isValueSlotArray(delim) || delim.type !== 'Any' || delim.src !== '=') {
    return undefined;
  }
  return nameValueIeSyntax(name.src);
}

/** A `name=value` call argument, by its name. */
export function nameValueIeSyntax(name: string): LegacyIeSyntax {
  return {
    what: `${name}=`,
    fix: 'Remove the argument, or write what it did in standard CSS (alpha(opacity=50) is opacity: 0.5).'
  };
}

/**
 * Legacy IE syntax in a declaration's authored value fails the compile at the
 * declaration (owner 2026-10-16: "if the diagnostic treats it as an error, then
 * no it doesn't succeed"). The evaluator calls it where it takes each
 * declaration in source order, before a later duplicate can replace it; a
 * value that is not a run, a list, a group or a call passes at its type test.
 */
export function assertNoLegacyIeSyntax(node: Declaration, s: { readonly context: Context | undefined }): void {
  const found = legacyIeSyntaxIn(node.value);
  if (found !== undefined) {
    throw ERR.legacyIeSyntax({
      node,
      ...callSiteLocation(node, s),
      meta: { what: found.what, fix: found.fix }
    });
  }
}
