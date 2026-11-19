/**
 * A rule whose prelude no selector reads (ledger P45). In a block, a statement
 * that is not a declaration and is followed by `{…}` is a rule (css-syntax-3
 * §5.5.5 "consume a block's contents", §5.5.6; css-nesting-1 §3.1), so it parses, and the
 * error sits on its prelude. Every dialect's grammar reads the prelude's rest
 * with the CSS base's `RulePreludeRest` (an override where a dialect adds
 * interpolation) and builds the rule's selector here.
 */
import { InvalidRulePreludeError } from '../error/diagnostics.js';
import { selist, simpleSelector } from './nodes.js';
import type { SelectorList } from './nodes.js';

/** What a rule's prelude holds past any selector: its span, and the parse state its error reports through. */
export class RulePreludeRest {
  readonly start: number;
  readonly end: number;
  readonly state: unknown;

  constructor(start: number, end: number, state: unknown) {
    this.start = start;
    this.end = end;
    this.state = state;
  }
}

/** The error kept on the run's `state.diagnostics`, the sink the CSS, SCSS and `.jess` parses give their reducers; a raw-grammar run keeps none. */
function keepOnStateDiagnostics(error: InvalidRulePreludeError, state: unknown): void {
  const sink: unknown = typeof state === 'object' && state !== null && 'diagnostics' in state ? state.diagnostics : null;
  if (Array.isArray(sink)) {
    sink.push(error);
  }
}

/**
 * The prelude from `start` to the end of its rest, as written, in one simple
 * selector, and the error at it, reported through `report`. A raw-grammar run,
 * with no source in its state, keeps an empty selector.
 */
export function unreadableRulePrelude(
  { end, state }: RulePreludeRest,
  start: number,
  report: (error: InvalidRulePreludeError, state: unknown) => void = keepOnStateDiagnostics
): SelectorList {
  const written = typeof state === 'object' && state !== null && 'source' in state && typeof state.source === 'string'
    ? state.source.slice(start, end)
    : '';
  const text = written.trim();
  const offset = start + written.length - written.trimStart().length;
  const selector = simpleSelector(text);
  report(new InvalidRulePreludeError(offset, offset + text.length, selector), state);
  return selist(selector);
}
