/*
 * `.jess`'s spellings of a map and a curly list, apart from the printer so the
 * printer stays one reviewable size. The printer lends its value spelling.
 */
import type { Block, Collection, CollectionItem, ValueSlot } from './nodes.js';

/** What a map and a curly list are spelled from: a value at an indent, and a named gap. */
export interface ListSpeller {
  readonly value: (slot: ValueSlot, indent: string) => string;
  readonly gap: (nodeType: string, reason: string) => string;
}

const isSlotArray = (slot: ValueSlot): slot is readonly ValueSlot[] => Array.isArray(slot);

/** `Collection`: `#{ key: value; …; ...spread; }` (ledger P31; `{ … }` is the curly list). */
export function jessCollection(node: Collection, indent: string, p: ListSpeller): string {
  if (node.entries.length === 0) {
    return '#{}';
  }
  const inner = `${indent}  `;
  const item = (entry: CollectionItem): string => {
    if (entry.type === 'CollectionSpread') {
      return `...${p.value(entry.value, inner)}`;
    }
    if (entry.merge !== null || entry.valueOnNewLine === true) {
      return p.gap('CollectionEntry', 'merge marker or value-on-new-line layout on a collection entry');
    }
    const key = isSlotArray(entry.key)
      ? `[${p.value(entry.key, inner)}]`
      : entry.key.type === 'Keyword'
        ? entry.key.src
        : entry.key.type === 'Quoted'
          ? p.value(entry.key, inner)
          : `[${p.value(entry.key, inner)}]`;
    return `${key}: ${p.value(entry.value, inner)}${entry.important ? ' !important' : ''}`;
  };
  return `#{\n${node.entries.map(e => `${inner}${item(e)};\n`).join('')}${indent}}`;
}

/**
 * `CurlyList`: `{ … }`, a list passed as one value (ledger P51) — Less `~( … )`
 * and a `;` group (P46), a Sass paren list and Sass's empty `()` (`{}`), and
 * css's `{a, b}` argument. `.jess` reads its braces as CSS's own in a CSS call's
 * arguments and as pass syntax everywhere else. In a CSS call written out as-is
 * a Less or Sass list writes its items (`foo(~(1, 2), 3)` is `foo(1, 2, 3)`),
 * so it converts to its items written in the call (orchestrator's reading of
 * P51, 2026-10-23). A one-item comma list keeps its comma (Sass `(1,)`).
 */
export function jessCurlyList(node: Block, place: 'prelude' | 'css-call' | 'value', p: ListSpeller): string {
  if (place === 'prelude') {
    return p.gap('Block', 'a curly list in an at-rule prelude');
  }
  const value = node.value;
  if (node.escaped === true && place === 'css-call') {
    return isSlotArray(value) && value.length === 0
      ? p.gap('Block', 'an empty list in a CSS call: it has no CSS spelling')
      : p.value(value, '');
  }
  if (node.escaped !== true && place !== 'css-call') {
    return p.gap('Block', 'a css `{}` argument outside a CSS call: `.jess` reads `{ … }` there as a list passed as one value');
  }
  if (isSlotArray(value)) {
    return value.length === 0 ? '{}' : `{${p.value(value, '')}}`;
  }
  return value.type === 'List' && value.sep === ',' && value.value.length === 1
    ? `{${p.value(value.value[0]!, '')},}`
    : `{${p.value(value, '')}}`;
}
