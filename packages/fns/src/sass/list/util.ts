import { Bool, List, Node, Block, Quoted, coerceListItems } from '@jesscss/core';
import { getListSeparator, isBracketedList } from '@jesscss/core';

export type SassListSep = ',' | ';' | '/' | undefined;

export function toListOptionSep(separator: ',' | ';' | '/' | ' '): SassListSep {
  return separator === ' ' ? undefined : separator;
}

export function getSassListInfo(node: Node): {
  items: readonly Node[];
  sep: SassListSep;
  bracketed: boolean;
} {
  return {
    items: coerceListItems(node),
    sep: toListOptionSep(getListSeparator(node)),
    bracketed: isBracketedList(node)
  };
}

export function resolveSassSeparator(
  separator: Quoted | undefined,
  fallback: SassListSep
): SassListSep {
  if (!separator) {
    return fallback;
  }

  switch (separator.valueOf()) {
    case 'comma':
      return ',';
    case 'slash':
      return '/';
    case 'space':
      return undefined;
    case 'auto':
      return fallback;
    default:
      throw new Error('$separator: Must be "space", "comma", "slash", or "auto".');
  }
}

export function resolveSassBracketed(
  bracketed: Bool | Quoted | undefined,
  fallback: boolean
): boolean {
  if (!bracketed) {
    return fallback;
  }

  if (bracketed instanceof Bool) {
    return bracketed.value;
  }

  const value = bracketed.valueOf();
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
  items: readonly Node[],
  sep: SassListSep,
  bracketed: boolean
): List | Block;
export function createSassListResult(
  items: readonly Node[],
  sep: SassListSep,
  bracketed: false
): List;
export function createSassListResult(
  items: readonly Node[],
  sep: SassListSep,
  bracketed: true
): Block;
export function createSassListResult(
  items: readonly Node[],
  sep: SassListSep,
  bracketed = false
): List | Block {
  const list = new List([...items], sep === undefined ? undefined : { sep });
  return bracketed ? new Block(list, { type: 'square' }) : list;
}
