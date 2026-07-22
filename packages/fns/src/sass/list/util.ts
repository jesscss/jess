import type { ValueGroup } from '@jesscss/core/value';
import {
  groupItems,
  groupSeparator,
  isBracketedList,
  isValueGroupArray,
  makeBlock,
  makeList
} from '@jesscss/core/value';

/** Sass's public separator names mapped onto the core value facts. */
export type SassListSep = ',' | ' ' | '/';

export function getSassListInfo(value: ValueGroup): {
  values: readonly ValueGroup[];
  sep: SassListSep;
  bracketed: boolean;
} {
  return {
    values: groupItems(value),
    sep: groupSeparator(value),
    bracketed: isBracketedList(value)
  };
}

export function resolveSassSeparator(
  separator: ValueGroup | undefined,
  fallback: SassListSep
): SassListSep {
  if (separator === undefined) {
    return fallback;
  }
  if (isValueGroupArray(separator) || (separator.type !== 'Quoted' && separator.type !== 'Keyword')) {
    throw new TypeError('$separator must be a quoted separator name');
  }
  const value = separator.type === 'Quoted' ? separator.value : separator.text;
  switch (value) {
    case 'comma': return ',';
    case 'slash': return '/';
    case 'space': return ' ';
    case 'auto': return fallback;
    default: throw new Error('$separator: Must be "space", "comma", "slash", or "auto".');
  }
}

export function resolveSassBracketed(
  bracketed: ValueGroup | undefined,
  fallback: boolean
): boolean {
  if (bracketed === undefined) {
    return fallback;
  }
  if (!isValueGroupArray(bracketed) && bracketed.type === 'Bool') {
    return bracketed.value;
  }
  if (isValueGroupArray(bracketed) || (bracketed.type !== 'Quoted' && bracketed.type !== 'Keyword')) {
    throw new TypeError('$bracketed must be true, false, or auto');
  }
  const value = bracketed.type === 'Quoted' ? bracketed.value : bracketed.text;
  if (value === 'auto') {
    return fallback;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error('$bracketed: Must be true, false, or "auto".');
}

export function createSassListResult(
  values: readonly ValueGroup[],
  sep: SassListSep,
  bracketed: boolean
): ValueGroup {
  const group = sep === ' '
    ? values.length === 1 ? values[0]! : values
    : makeList(values, sep);
  return bracketed ? makeBlock(group, 'square') : group;
}

/**
 * Convert Sass's one-based list index (including its negative-from-end form)
 * to the strict zero-based index accepted by the core value helpers.
 */
export function resolveSassListIndex(index: number, length: number): number {
  if (!Number.isInteger(index)) {
    throw new TypeError('list index must be an integer');
  }
  const zeroBased = index < 0 ? length + index : index - 1;
  if (zeroBased < 0 || zeroBased >= length) {
    throw new RangeError(`List index ${index} is out of bounds`);
  }
  return zeroBased;
}
