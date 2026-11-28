import type { ListSeparator, ValueGroup } from '@jesscss/core/value';
import { checkAny, define, emitValue, isValueGroupArray, makeKeyword, sepGlue } from '@jesscss/core/value';
import { addQuotes } from '../string/util.js';
import { exactArgs } from './args.js';

type Separator = ListSeparator | ' ';

interface ListView {
  readonly items: readonly ValueGroup[];
  readonly sep: Separator;
  readonly bracketed: boolean;
}

/**
 * A value as a Sass list: its items, separator and brackets, or `null` for a
 * value that is not a list. A paren or curly group is the list it holds (Sass
 * parens dissolve). A bracket group is one list whose items are those of the
 * unbracketed list it holds, so a group inside it (`[[1, 2]]`, `[(1 2)]`) stays
 * one item.
 */
function listView(value: ValueGroup): ListView | null {
  if (isValueGroupArray(value)) {
    return { items: value, sep: ' ', bracketed: false };
  }
  switch (value.type) {
    case 'List': return { items: value.value, sep: value.sep, bracketed: false };
    case 'Block': {
      if (value.delimiter !== 'square') {
        return listView(value.value);
      }
      const inner = value.value;
      if (isValueGroupArray(inner) || inner.type === 'List') {
        return { ...listView(inner)!, bracketed: true };
      }
      return { items: [inner], sep: ' ', bracketed: true };
    }
    default: return null;
  }
}

/**
 * Dart Sass `_elementNeedsParens`: an unbracketed list of two or more items is
 * parenthesized inside a list whose separator binds at least as loosely.
 */
function needsParens(outer: Separator, element: ValueGroup): boolean {
  const list = listView(element);
  if (list === null || list.bracketed || list.items.length < 2) {
    return false;
  }
  switch (outer) {
    case ',': return list.sep === ',';
    case '/': return list.sep === ',' || list.sep === '/';
    default: return true;
  }
}

/** Dart Sass `_writeMapElement`: a map key or value that is an unbracketed comma list is parenthesized. */
function mapElement(value: ValueGroup): string {
  const list = listView(value);
  const text = inspectValue(value);
  return list !== null && !list.bracketed && list.sep === ',' && list.items.length > 0 ? `(${text})` : text;
}

function inspectList({ items, sep, bracketed }: ListView): string {
  if (items.length === 0) {
    return bracketed ? '[]' : '()';
  }
  const body = items.map(item => (needsParens(sep, item) ? `(${inspectValue(item)})` : inspectValue(item))).join(sep === ' ' ? ' ' : sepGlue(sep));
  const singleton = items.length === 1 && (sep === ',' || sep === '/') ? sep : '';
  if (bracketed) {
    return `[${body}${singleton}]`;
  }
  return singleton === '' ? body : `(${body}${singleton})`;
}

/**
 * The Sass inspect form of a value (Dart Sass `serializeValue(…, inspect: true)`):
 * the CSS form, except that a quoted string is written with Dart Sass's choice
 * of quote, `null` is `null`, an empty list is `()`, a map is `(key: value, …)`,
 * and a nested list is parenthesized where its separator would otherwise read
 * as the outer one's.
 *
 * A quoted string's body is held as written, escapes included, so one that
 * holds a backslash keeps the quote it was written with; requoting it would
 * have to decode its escapes first.
 */
export function inspectValue(value: ValueGroup): string {
  const list = listView(value);
  if (list !== null) {
    return inspectList(list);
  }
  if (isValueGroupArray(value)) {
    return emitValue(value);
  }
  switch (value.type) {
    case 'Null': return 'null';
    case 'Quoted': return emitValue(value.escaped || value.value.includes('\\') ? value : addQuotes(value.value));
    case 'Block': return inspectValue(value.value);
    case 'Collection':
      return value.entries.length === 0
        ? '()'
        : `(${value.entries.map(entry => `${mapElement(entry.key)}: ${mapElement(entry.value)}`).join(', ')})`;
    default: return emitValue(value);
  }
}

/**
 * A value as a Dart Sass error message names it (`Value.toString()`): its
 * inspect form, with an unbracketed list in parentheses so its bounds show
 * (`(1px 2px)`), except an empty list and a one-item comma list (`(1,)`).
 */
export function describeValue(value: ValueGroup): string {
  const list = listView(value);
  const text = inspectValue(value);
  if (list === null || list.bracketed || list.items.length === 0 || (list.items.length === 1 && list.sep === ',')) {
    return text;
  }
  return `(${text})`;
}

/**
 * Sass `meta.inspect($value)` / the global `inspect()`: the value's inspect
 * form ({@link inspectValue}) as an unquoted string.
 */
const inspect = define('inspect', {
  params: [{ name: 'value', type: 'any', check: checkAny }] as const,
  variadic: true,
  body: (items) => {
    exactArgs(items, ['value']);
    return makeKeyword(inspectValue(items[0]!));
  }
});

export { inspect };
export default inspect;
