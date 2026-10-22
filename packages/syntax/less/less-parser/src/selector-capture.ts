/**
 * The Less selector-capture reduction (owner 2026-10-16, ledger P49): a
 * value-position `selector(…)`. The shared reading is core's
 * `selectorCaptureOf`; this module adds the Less error and reports it on the
 * recovered-error channel (P45).
 */
import type { Span } from 'parseman';
import { adoptForgivenSelectorItems, any, authoredSource, selectorCaptureOf, simpleSelector } from '@jesscss/core/ast';
import type { Any, SelectorCapture, SelectorCaptureProblem, SimpleToken } from '@jesscss/core/ast';
import { isLessSelectorList, requireToken, staticSelectorPseudoFrom } from './grammar-helpers.js';
import { LessSelectorCaptureArgumentError } from './parse-error.js';
import { reportRecovered, selectorCaptureOfState } from './parse-state.js';

/**
 * `selector(…)` in a value (owner 2026-10-16, ledger P49): the capture, or —
 * when the argument is not a selector list — an error at the rest the list
 * could not read (the whole call when the argument holds nothing), and the
 * call kept as its value (P45). A selector pseudo in the argument that could
 * not read its own argument recorded it on the capture's state; it comes
 * first in the source, so it is the one reported.
 */
export function selectorCaptureFrom(children: readonly unknown[], span: Span, state: unknown): SelectorCapture | Any {
  const found = selectorCaptureOf(children, span);
  const nested = problemBefore(selectorCaptureOfState(state)?.problem, found);
  if ('type' in found) {
    return nested === undefined ? adoptForgivenSelectorItems(children, found, state) : recovered(found.src, nested, state);
  }
  return recovered(found.written ?? authoredSource(span, state, 'A selector capture'), nested ?? found, state);
}

/*
 * A problem a pseudo recorded, if it lies before the reading's own rest. The
 * record is not rolled back with an attempt the parser abandons
 * (`selector(:nth-child(2n of .a:is(1px) 5px))` records `1px`, then the
 * `:nth-child(` is read as the rest), but such a problem lies past where the
 * list stopped, so inside the rest; one in the accepted list lies before it.
 */
function problemBefore(
  recorded: SelectorCaptureProblem | undefined,
  found: SelectorCapture | SelectorCaptureProblem
): SelectorCaptureProblem | undefined {
  return recorded !== undefined && ('type' in found || recorded.start < found.start) ? recorded : undefined;
}

/** The call kept as written, its error reported at `at` (P45). */
function recovered(written: string, at: SelectorCaptureProblem, state: unknown): Any {
  const value = any(written);
  reportRecovered(new LessSelectorCaptureArgumentError(at.start, at.end, value), state);
  return value;
}

/**
 * A selector pseudo (`:is(`, `:not(`, …) inside a capture: its argument is
 * read as the capture's is, so where it is not a selector list the pseudo
 * keeps it as written and records it for the capture to report (P45).
 */
export function capturedPseudoFrom(children: readonly unknown[], span: Span, state: unknown): SimpleToken {
  const found = selectorCaptureOf(children, span);
  if ('type' in found) {
    return staticSelectorPseudoFrom(requireToken(children[0]).value.slice(0, -1), children.find(isLessSelectorList));
  }
  const capture = selectorCaptureOfState(state);
  if (capture !== undefined && problemBefore(capture.problem, found) === undefined) {
    capture.problem = found;
  }
  return simpleSelector(found.written ?? authoredSource(span, state, 'A selector pseudo'));
}
