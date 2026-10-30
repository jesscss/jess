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

/**
 * The quote to write a string `value` in when either will do: `quote`, unless
 * `value` holds it unescaped and holds no unescaped other one (a `\` escapes
 * the code point after it, CSS Syntax 3 §4.3.5).
 */
export function stringQuoteFor(value: string, quote: string): string {
  const other = quote === '"' ? '\'' : '"';
  let holdsQuote = false;
  for (let i = 0; i < value.length; i += value[i] === '\\' ? 2 : 1) {
    if (value[i] === other) {
      return quote;
    }
    holdsQuote ||= value[i] === quote;
  }
  return holdsQuote ? other : quote;
}

/** A string `value` with each `quote` no `\` escapes escaped, so it can be written between `quote`s. */
export function escapeStringQuote(value: string, quote: string): string {
  let out = '';
  let start = 0;
  for (let i = 0; i < value.length; i += value[i] === '\\' ? 2 : 1) {
    if (value[i] === quote) {
      out += `${value.slice(start, i)}\\`;
      start = i;
    }
  }
  return out === '' ? value : out + value.slice(start);
}

/** Whether `c` continues a name glued to a `&`: a name code point (CSS Syntax 3 §4.2) or the backslash of an escape. */
export function isNameCode(c: number): boolean {
  return c === 0x2D /* - */ || c === 0x5F /* _ */ || c === 0x5C /* \ */ || c >= 0x80 || (c >= 0x30 && c <= 0x39) || ((c | 32) >= 0x61 && (c | 32) <= 0x7A);
}
