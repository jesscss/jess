/**
 * Core value-list capabilities shared by Less, Sass, Jess, and future
 * function libraries.
 *
 * This module owns the value-domain list shape and the only permitted recovery
 * seam for a flattened literal. Dialect functions may add policy (unit
 * compatibility, default separator, or index rounding), but they do not carry
 * a second list representation or helper contract.
 */
import type { Block, Dimension, List, ListSeparator, ValueObj } from './value-eval.js';
import { sniffLiteral } from './literal-tag.js';

/** A variadic callable must receive this typed value-domain list. */
export function asList(value: ValueObj): List {
  const unwrapped = unwrapList(value);
  if (!unwrapped) {
    throw new TypeError('variadic fn expected a List argument');
  }
  return unwrapped.list;
}

/** Unwrap delimiter blocks while retaining the square-bracket fact for callers. */
function unwrapList(value: ValueObj): { list: List; block?: Block } | undefined {
  if (value.type === 'List') {
    return { list: value };
  }
  if (value.type === 'Block') {
    const inner = unwrapList(value.inner);
    return inner ? { list: inner.list, block: value } : undefined;
  }
  return undefined;
}

/** Whether a value is a square-delimited list after transparent block unwrapping. */
export function isBracketedList(value: ValueObj): boolean {
  const unwrapped = unwrapList(value);
  return unwrapped?.block?.delimiter === 'square';
}

/**
 * Split `text` at a top-level separator while retaining nested calls/brackets
 * and quoted strings as one element. This is value-domain recovery for a
 * flattened literal, not parser-package recognition or source reparsing.
 */
function topLevelSplit(text: string, separator: ',' | ' '): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  const push = (end: number): void => {
    const piece = text.slice(start, end).trim();
    if (piece !== '') {
      parts.push(piece);
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quote !== '') {
      if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === '"' || character === '\'') {
      quote = character;
    } else if (character === '(' || character === '[' || character === '{') {
      depth += 1;
    } else if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
    } else if (depth === 0 && (separator === ','
      ? character === ','
      : character === ' ' || character === '\t' || character === '\n' || character === '\r')) {
      push(index);
      start = index + 1;
    }
  }
  push(text.length);
  return parts;
}

function hasTopLevelComma(text: string): boolean {
  let depth = 0;
  let quote = '';
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quote !== '') {
      if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === '"' || character === '\'') {
      quote = character;
    } else if (character === '(' || character === '[' || character === '{') {
      depth += 1;
    } else if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
    } else if (depth === 0 && character === ',') {
      return true;
    }
  }
  return false;
}

/**
 * Recover the elements of a materialized value. A real List keeps its typed
 * structure; a flattened Keyword is split only at top level and each recovered
 * leaf is tagged through the core literal classifier. Other values are scalar
 * one-element lists.
 */
export function coerceListItems(value: ValueObj | undefined): ValueObj[] {
  if (value === undefined) {
    return [];
  }
  if (value.type === 'Block') {
    return coerceListItems(value.inner);
  }
  if (value.type === 'List') {
    return [...value.value];
  }
  if (value.type !== 'Keyword') {
    return [value];
  }

  const separator = hasTopLevelComma(value.text) ? ',' : ' ';
  const pieces = topLevelSplit(value.text, separator);
  return pieces.length <= 1 ? [value] : pieces.map(piece => sniffLiteral(piece));
}

/** Read a zero-based item after the dialect has applied its own index policy. */
export function listValueAt(value: ValueObj | undefined, index: number): ValueObj {
  const items = coerceListItems(value);
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    throw new RangeError(`list index ${index} out of range for length ${items.length}`);
  }
  return items[index]!;
}

/** Type-only helper for policy-bearing list constructors. */
export type { List, ListSeparator };
