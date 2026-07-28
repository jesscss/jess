/**
 * Core value-list capabilities shared by Less, Sass, Jess, and future
 * function libraries.
 *
 * This module owns the value-domain structural sequence shape. Dialect functions
 * may add policy (unit compatibility or index rounding), but they do not carry
 * a second list representation or recover structure from flattened bytes.
 */
import { isValueGroupArray, type Block, type List, type ListSeparator, type ValueGroup } from './value-eval.js';

/** Unwrap only delimiter blocks; sequence structure never comes from bytes. */
function unwrapBlock(value: ValueGroup): { value: ValueGroup; block?: Block } {
  if (!isValueGroupArray(value) && value.type === 'Block') {
    const inner = unwrapBlock(value.inner);
    return { value: inner.value, block: value };
  }
  return { value };
}

/** Whether a value is a square-delimited list after transparent block unwrapping. */
export function isBracketedList(value: ValueGroup): boolean {
  return unwrapBlock(value).block?.delimiter === 'square';
}

/**
 * The direct children of a structural value group. A scalar is its own
 * singleton; a raw array is a default spaced sequence; an explicit List carries
 * its comma/slash members. This never inspects rendered bytes.
 */
export function groupItems(value: ValueGroup | undefined): readonly ValueGroup[] {
  if (value === undefined) {
    return [];
  }
  const unwrapped = unwrapBlock(value).value;
  if (isValueGroupArray(unwrapped)) {
    return unwrapped;
  }
  if (unwrapped.type === 'List') {
    return unwrapped.value;
  }
  if (unwrapped.type === 'Collection') {
    /*
     * A map IS a list of its pairs (Sass): `length((a: 1, b: 2))` is 2 and
     * `nth(…, 1)` is `a 1`. Each pair is the raw two-item group, which is the
     * default-spaced sequence shape — no pair wrapper node is introduced, and the
     * list functions need no map-specific branch.
     */
    return unwrapped.entries.map(entry => [entry.key, entry.value]);
  }
  return [unwrapped];
}

/** The semantic separator for a value group; raw arrays/scalars default to space. */
export function groupSeparator(value: ValueGroup | undefined): ListSeparator | ' ' {
  if (value === undefined) {
    return ' ';
  }
  const unwrapped = unwrapBlock(value).value;
  if (isValueGroupArray(unwrapped)) {
    return ' ';
  }

  /*
   * A map's pair sequence is comma-separated (Sass `list.separator((a: 1))` is
   * `comma`), including the single-entry map.
   */
  return unwrapped.type === 'Collection' ? ',' : unwrapped.type === 'List' ? unwrapped.sep : ' ';
}

/** Read a zero-based item after the dialect has applied its own index policy. */
export function listValueAt(value: ValueGroup | undefined, index: number): ValueGroup {
  const items = groupItems(value);
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    throw new RangeError(`list index ${index} out of range for length ${items.length}`);
  }
  return items[index]!;
}

/** Type-only helper for policy-bearing list constructors. */
export type { List, ListSeparator, ValueGroup };
