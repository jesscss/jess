/*
 * `.jess`'s curly list and map reducers and the CSS-call parse state they read
 * (ledger P51, P31), apart from the grammar helpers so those stay one
 * reviewable size.
 */
import type { Span } from 'parseman';
import { block, collection, isToken, isValueSlotArray, list, withSourceSpan } from '@jesscss/core/ast';
import type { Block, Collection } from '@jesscss/core/ast';
import { isCollectionItem, isJessValueSlotValue, reportRecovered } from './grammar-helpers.js';
import { JessBareBraceMapError } from './parse-error.js';

/**
 * Whether the parse is reading a CSS call's arguments (a call written without
 * `$`, `var()`'s fallback included), where a `{ … }` argument is CSS's own
 * (css-values-5 §3.1.1) and keeps its braces when the call is written out.
 */
export function isCssCall(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'cssCall' in state && state.cssCall === true;
}

/** The parse state inside a CSS call's arguments. */
export function enterCssCall(state: unknown): object {
  if (typeof state !== 'object' || state === null) {
    return { cssCall: true };
  }
  return isCssCall(state) ? state : { ...state, cssCall: true };
}

/** The parse state of a `.jess` call's or a mixin call's arguments: the state it had outside, unchanged when it was not set. */
export function leaveCssCall(state: unknown): unknown {
  return isCssCall(state) && typeof state === 'object' && state !== null ? { ...state, cssCall: false } : state;
}

/**
 * `{ … }`: the curly list, a list passed as one value (owner 2026-10-09 and
 * 2026-10-23; ledger P46), the node Less `~( … )` and a Sass paren list build.
 * Its braces are pass syntax, so it is written as what it holds, except as an
 * argument of a CSS call, where they are CSS's own (css-values-5 §3.1.1) and are
 * written. `{}` is the empty list, and a trailing comma makes a comma list
 * (`{1,}`).
 */
export function curlyListFrom(children: readonly unknown[], span: Span, state: unknown): Block {
  const value = children.find(isJessValueSlotValue) ?? [];
  const comma = children.some(child => isToken(child) && child.value === ',');
  const items = comma && (isValueSlotArray(value) || value.type !== 'List' || value.sep !== ',') ? list([value], ',') : value;
  return withSourceSpan(block(items, 'curly', !isCssCall(state)), span);
}

/** A `Collection`'s entries; one opened with a bare `{` is an error at the block (`JessBareBraceMapError`). */
export function collectionFrom(children: readonly unknown[], span: Span, state: unknown): Collection {
  const map = collection(children.filter(isCollectionItem));
  if (isToken(children[0]) && children[0].value === '{') {
    reportRecovered(new JessBareBraceMapError(span.start, span.end, map), state);
  }
  return map;
}
