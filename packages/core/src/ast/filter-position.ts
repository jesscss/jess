/**
 * `grayscale()`, `invert()` and `contrast()` are CSS filter functions and
 * built-ins over a colour. Over one argument only the browser knows, the
 * declaration the call stands in decides which (docs/design/CSS-NATIVE-BUILTINS.md
 * Q13): an item of a `filter` or `backdrop-filter` is the filter, an item of any
 * other declaration the colour. Anywhere else nothing says, and it stays as
 * written.
 */
import { isValueSlotArray } from './css-grammar-helpers.js';
import type { Declaration, FunctionCall, ValueSlot } from './nodes.js';
import type { EvalModes } from './value-eval.js';

const COLOR_OVERLOADS: ReadonlySet<string> = new Set(['contrast', 'grayscale', 'invert']);

const FILTER_PROPERTY = /^(?:-webkit-)?(?:backdrop-)?filter$/i;

export const isFilterProperty = (name: string): boolean => FILTER_PROPERTY.test(name);

/** Whether a call's name is one of these, or `saturate`, whose built-in takes two arguments, so one is always the filter. */
export const isFilterFunction = (name: string): boolean => COLOR_OVERLOADS.has(name) || name === 'saturate';

/** Whether `node` is an item of the value, not an argument of a call in it. */
function isItemOf(value: ValueSlot, node: FunctionCall): boolean {
  if (isValueSlotArray(value)) {
    return value.some(item => isItemOf(item, node));
  }
  switch (value.type) {
    case 'List': return value.value.some(item => isItemOf(item, node));
    case 'Sequence': return value.parts.some(item => isItemOf(item, node));
    default: return value === node;
  }
}

/** Whether a call of one argument, not through a module, may be the filter: nothing makes it a colour. A value a reference `reached` is read from anywhere, so it has no position. */
export function mayBeFilter(node: FunctionCall, checks: Declaration | 'argument' | undefined, reached: boolean): boolean {
  return COLOR_OVERLOADS.has(node.name) && (reached || typeof checks !== 'object' || typeof checks.name !== 'string'
    || isFilterProperty(checks.name) || !isItemOf(checks.value, node));
}

const filterPositionCache = new WeakMap<EvalModes, EvalModes>();

/** One copy per render's modes, read by {@link defineForm}'s `filter`. */
export function filterPositionModes(modes: EvalModes): EvalModes {
  let marked = filterPositionCache.get(modes);
  if (marked === undefined) {
    marked = { ...modes, filterPosition: true };
    filterPositionCache.set(modes, marked);
  }
  return marked;
}
