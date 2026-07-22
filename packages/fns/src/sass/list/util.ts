import type { List, ValueObj } from '@jesscss/core/value';
import {
  coerceListItems,
  isBracketedList,
  makeBlock,
  makeList
} from '@jesscss/core/value';

/** Sass's public separator names mapped onto the core value facts. */
export type SassListSep = ',' | ' ' | '/' | 'undecided';

function listValue(value: ValueObj): List | undefined {
  if (value.type === 'List') {
    return value;
  }
  if (value.type === 'Block' && value.inner.type === 'List') {
    return value.inner;
  }
  return undefined;
}

export function getSassListInfo(value: ValueObj): {
  values: readonly ValueObj[];
  sep: SassListSep;
  bracketed: boolean;
} {
  const list = listValue(value);
  return {
    values: coerceListItems(value),
    sep: list?.sep ?? ' ',
    bracketed: isBracketedList(value)
  };
}

export function resolveSassSeparator(
  separator: ValueObj | undefined,
  fallback: SassListSep
): SassListSep {
  if (separator === undefined) {
    return fallback;
  }
  if (separator.type !== 'Quoted' && separator.type !== 'Keyword') {
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
  bracketed: ValueObj | undefined,
  fallback: boolean
): boolean {
  if (bracketed === undefined) {
    return fallback;
  }
  if (bracketed.type === 'Bool') {
    return bracketed.value;
  }
  if (bracketed.type !== 'Quoted' && bracketed.type !== 'Keyword') {
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
  values: readonly ValueObj[],
  sep: SassListSep,
  bracketed: boolean
): ValueObj {
  const list = makeList(values, sep);
  return bracketed ? makeBlock(list, 'square') : list;
}

/**
 * Convert Sass's one-based list index (including its negative-from-end form)
 * to the strict zero-based index accepted by the core value helpers.
 */
export function resolveSassListIndex(index: number, length: number): number {
  const normalized = Math.floor(index);
  if (!Number.isFinite(normalized)) {
    throw new TypeError('list index must be finite');
  }
  const zeroBased = normalized < 0 ? length + normalized : normalized - 1;
  if (zeroBased < 0 || zeroBased >= length) {
    throw new RangeError(`List index ${normalized} is out of bounds`);
  }
  return zeroBased;
}
