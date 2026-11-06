/**
 * `grayscale()`, `invert()` and `contrast()` are CSS filter functions and
 * built-ins over a colour. Over one argument only the browser knows, the
 * declaration the call stands in decides (docs/design/CSS-NATIVE-BUILTINS.md
 * Q13): an item of a `filter` or `backdrop-filter` is the filter, an item of any
 * other declaration the colour. Anywhere else nothing says, and it stays as
 * written.
 */
import { isValueSlotArray } from './css-grammar-helpers.js';
import { isMathFunctionName } from './math-functions.js';
import { isCssColorFunction } from './nodes.js';
import type { Declaration, FunctionCall, ValueSlot } from './nodes.js';
import type { Fn } from './functions/types.js';
import { isValueGroupArray, type ValueGroup } from './value-eval.js';

const COLOR_OVERLOADS: ReadonlySet<string> = new Set(['contrast', 'grayscale', 'invert']);

const FILTER_PROPERTY = /^(?:-webkit-)?(?:backdrop-)?filter$/i;

export const isFilterProperty = (name: string): boolean => FILTER_PROPERTY.test(name);

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

/**
 * Whether a call of one argument, not through a module, may be the filter: its
 * callable is a filter form, its argument has no known type, and nothing makes
 * it a colour. A value a reference `reached` is read from anywhere, so it has no
 * position.
 */
export function mayBeFilter(
  node: FunctionCall,
  arg: ValueGroup | undefined,
  at: { readonly checks: Declaration | 'argument' | undefined; readonly reached: boolean },
  selected: Fn | undefined,
  registry: { fn(name: string): Fn | undefined }
): boolean {
  if (!COLOR_OVERLOADS.has(node.name.toLowerCase()) || arg === undefined || isValueGroupArray(arg) || arg.type !== 'FunctionCall' || arg.result === 'color' || arg.result === 'numeric') {
    return false;
  }
  const { checks } = at;
  return (selected ?? registry.fn(node.name))?.filter === true
    && (at.reached || typeof checks !== 'object' || typeof checks.name !== 'string' || isFilterProperty(checks.name) || !isItemOf(checks.value, node));
}

/**
 * Whether `.jess` keeps a lone `grayscale()`, `invert()`, `contrast()` or
 * `saturate()` bare, CSS's filter function, where `$name(…)` would read a colour:
 * over a number, anywhere, and over what only the browser knows unless
 * `colorPosition`, an item of a declaration that makes it a colour. An argument
 * that reaches a value stays with its binding: it may be a colour.
 */
export function writtenAsFilter(node: FunctionCall, lower: string, exported: ReadonlyMap<string, unknown> | undefined, colorPosition: boolean): boolean {
  const arg = node.args[0]?.value;
  if (node.args.length !== 1 || arg === undefined || isValueSlotArray(arg) || !(COLOR_OVERLOADS.has(lower) || lower === 'saturate')) {
    return false;
  }
  if (arg.type === 'Dimension') {
    return true;
  }
  if (arg.type !== 'FunctionCall' || isCssColorFunction(arg) || (exported?.has(arg.name.toLowerCase()) === true && !isMathFunctionName(arg.name))) {
    return false;
  }
  return lower === 'saturate' || isMathFunctionName(arg.name) || !colorPosition;
}
