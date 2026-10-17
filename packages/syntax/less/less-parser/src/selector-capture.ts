/**
 * The Less selector-capture reduction (owner 2026-10-16, ledger P49): a
 * value-position `selector(…)`. The shared reading is core's
 * `selectorCaptureOf`; this module adds the Less error and reports it on the
 * recovered-error channel (P45).
 */
import type { Span } from 'parseman';
import { any, selectorCaptureOf } from '@jesscss/core/ast';
import type { Any, SelectorCapture } from '@jesscss/core/ast';
import { LessSelectorCaptureArgumentError } from './parse-error.js';
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
