/**
 * The Less selector-capture reductions (owner 2026-10-16, ledger P49): a
 * value-position `selector(…)` and the removed `*[…]`. The shared reading is
 * core's `selectorCaptureOf` / `removedSelectorCaptureOf`; this module adds the
 * Less errors and reports them on the recovered-error channel (P45).
 */
import type { Span } from 'parseman';
import { any, removedSelectorCaptureOf, selectorCaptureOf } from '@jesscss/core/ast';
import type { Any, SelectorCapture } from '@jesscss/core/ast';
import { LessRemovedSelectorCaptureError, LessSelectorCaptureArgumentError } from './parse-error.js';
import { reportRecovered } from './parse-state.js';

/**
 * `selector(…)` in a value (owner 2026-10-16, ledger P49): the capture, or —
 * when the argument is not a selector list — an error at the rest the list
 * could not read (the whole call when the argument holds nothing), and the
 * call kept as its value (P45).
 */
export function selectorCaptureFrom(children: readonly unknown[], span: Span, state: unknown): SelectorCapture | Any {
  const found = selectorCaptureOf(children, span);
  if ('type' in found) {
    return found;
  }
  const value = any(found.written);
  reportRecovered(new LessSelectorCaptureArgumentError(found.start, found.end, value), state);
  return value;
}

/** The removed `*[…]` capture (ledger P49): an error naming `selector(…)`, kept as written (P45). */
export function removedSelectorCaptureFrom(children: readonly unknown[], span: Span, state: unknown): Any {
  const found = removedSelectorCaptureOf(children);
  const value = any(found.written);
  reportRecovered(new LessRemovedSelectorCaptureError(span.start, span.end, found.list, value), state);
  return value;
}
