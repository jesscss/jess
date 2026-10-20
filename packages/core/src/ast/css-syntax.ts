/**
 * CSS Syntax 3 rules over source text, each written once: the owner the
 * duplicated-predicate guardrail names (`scripts/check-guardrails.mjs`,
 * assertion 7). A scanner reads these instead of writing the rule again.
 */

/** Whether `c` opens a CSS string token (CSS Syntax 3 §4.3.1). */
export function isQuote(c: string | undefined): boolean {
  return c === '"' || c === '\'';
}

/**
 * The index of the quote that closes the string opening at `start`, a `\`
 * escaping the code point after it (CSS Syntax 3 §4.3.5); `text.length` when
 * the string is not closed.
 */
export function stringEnd(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote) {
    i += text[i] === '\\' ? 2 : 1;
  }
  return Math.min(i, text.length);
}
