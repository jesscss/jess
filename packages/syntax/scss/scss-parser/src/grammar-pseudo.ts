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

/**
 * An An+B with a hole reads as the one without: whitespace in it is not part of
 * its value (css-syntax-3 §6), and An+B is written unspaced (`-n + #{$n}` is
 * `-n+2`). Text that is not An+B, an `of S` tail, is left as written.
 */
function unspacedNth(arg: Interpolation): Interpolation {
  const isAnb = (text: string): boolean => [...text].every(char => '-+0123456789nN \t\n\r\f'.includes(char));
  const unspaced = (text: string): string => [...text].filter(char => !' \t\n\r\f'.includes(char)).join('');
  return interpolation(arg.parts.map(part => 'lit' in part && isAnb(part.lit) ? { lit: unspaced(part.lit) } : part));
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
