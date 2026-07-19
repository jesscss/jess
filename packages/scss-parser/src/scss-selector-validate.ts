/**
 * `selector.parse("…")` validation for the functional grammar builders. Gating a
 * `selector.*` call into a `SelectorCapture` needs the *runtime* string argument
 * checked against the real selector grammar — a legitimate re-parse of a string
 * literal (distinct from `#{…}` interpolation, which the grammar structures
 * inline). The `parseScssFn` entry is wired in lazily to break the import cycle
 * (grammar → builders → here → parser → grammar).
 */
import type { ScssFnParseResult } from './functional-parser.js';

let parseScssFnLazy: ((input: string, rule?: string) => ScssFnParseResult) | undefined;

/** Wired from functional-parser.ts once `parseScssFn` is defined. */
export function setParseScssFnForSelectorValidate(
  fn: (input: string, rule?: string) => ScssFnParseResult
): void {
  parseScssFnLazy = fn;
}

/**
 * Validate a `selector.parse("…")` argument through the functional selector
 * grammar. Returns `true` when the text is a well-formed selector list. Used to
 * gate lifting a `selector.*` call into a `SelectorCapture`; the capture keeps the
 * lean string payload (`SelectorCapture` supports a bare-string `SelectorLike`).
 */
export function isValidScssSelectorList(selectorText: string): boolean {
  const trimmed = selectorText.trim();
  if (!trimmed) {
    return false;
  }
  if (!parseScssFnLazy) {
    throw new Error('parseScssFn not wired for selector validation (setParseScssFnForSelectorValidate)');
  }
  const r = parseScssFnLazy(trimmed, 'SelectorList');
  return r.errors.length === 0;
}
