import { appendInterpolationLiteral, interpolatedSimpleSelector, interpolation, isInterpolation, isNthArgument, pseudoSelector, simpleSelector } from '@jesscss/core/ast';
import type { Interpolation, SimpleSelector, SimpleToken } from '@jesscss/core/ast';
import { joinSourceText, scssSourceText } from './grammar-helpers.js';

/**
 * An `:nth-*()` pseudo from its glued opener (`:nth-child(`) and reduced
 * argument: structured when the argument is an `An+B`, the opaque raw text it
 * always was otherwise.
 */
export function nthPseudoFrom(opener: string, arg: unknown): SimpleToken {
  if (isNthArgument(arg)) {
    return pseudoSelector(opener.slice(0, -1), arg.of, null, null, arg.nth);
  }
  return functionalPseudoFrom(opener, typeof arg === 'string' ? arg.trim() : isInterpolation(arg) ? unspacedNth(arg) : arg);
}

const AN_PLUS_B_TEXT: ReadonlySet<string> = new Set('-+0123456789nN \t\n\r\f');
const AN_PLUS_B_SPACE: ReadonlySet<string> = new Set(' \t\n\r\f');

/**
 * An An+B with a hole reads as the one without: whitespace in it is not part of
 * its value (css-syntax-3 §6), and An+B is written unspaced (`-n + #{$n}` is
 * `-n+2`). Whitespace alone between two holes separates them (`#{$a} #{$b}` may
 * be `2n of`, or a descendant combinator), and any other text is left as written.
 */
function unspacedNth(arg: Interpolation): Interpolation {
  const last = arg.parts.length - 1;
  return interpolation(arg.parts.map((part, index) => {
    if (!('lit' in part) || [...part.lit].some(char => !AN_PLUS_B_TEXT.has(char)) || (part.lit.trim() === '' && index > 0 && index < last)) {
      return part;
    }
    return { lit: [...part.lit].filter(char => !AN_PLUS_B_SPACE.has(char)).join('') };
  }));
}

/** A pseudo argument's source text, or its interpolation when a `#{…}` stands in it. */
export function pseudoArgumentFrom(children: readonly unknown[]): string | Interpolation {
  if (!children.some(isInterpolation)) {
    return joinSourceText(children);
  }
  const parts: Interpolation['parts'] = [];
  for (const child of children) {
    if (isInterpolation(child)) {
      parts.push(...child.parts);
    } else {
      appendInterpolationLiteral(parts, scssSourceText(child));
    }
  }
  return interpolation(parts);
}

/** `:name(` and its argument as one simple selector, interpolated when the argument is. */
export function functionalPseudoFrom(opener: string, arg: unknown): SimpleSelector {
  if (typeof arg === 'string') {
    return simpleSelector(`${opener}${arg})`);
  }
  if (!isInterpolation(arg)) {
    throw new TypeError('SCSS pseudo lost its argument.');
  }
  const parts: Interpolation['parts'] = [{ lit: opener }];
  for (const part of arg.parts) {
    if ('lit' in part) {
      appendInterpolationLiteral(parts, part.lit);
    } else {
      parts.push(part);
    }
  }
  appendInterpolationLiteral(parts, ')');
  return interpolatedSimpleSelector(interpolation(parts));
}
