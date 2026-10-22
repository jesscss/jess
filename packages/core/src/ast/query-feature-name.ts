/*
 * A query feature's name as a superset's `QueryFeatureName` slot reads it: an
 * identifier, or a name holding the dialect's interpolation.
 */
import { interpolation, keyword } from './nodes.js';
import { appendInterpolationLiteral, isInterpolation, isTerminalText, queryComparisonOperators, tokenText } from './css-grammar-helpers.js';
import type { Interpolation, Keyword, ValueNode } from './nodes.js';

/**
 * A superset's `QueryFeatureName`: the identifier, as css's routed name gives
 * it, or, with the dialect's interpolation in it, the `Interpolation` of its
 * glued parts (`min-${d}` → `min-` + `$d`).
 */
export function queryFeatureNameFrom(children: readonly unknown[]): string | Interpolation {
  if (children.length === 1 && !isInterpolation(children[0])) {
    return tokenText(children[0]);
  }
  const parts: Interpolation['parts'] = [];
  for (const child of children) {
    if (!isInterpolation(child)) {
      appendInterpolationLiteral(parts, tokenText(child));
      continue;
    }
    for (const part of child.parts) {
      if ('lit' in part) {
        appendInterpolationLiteral(parts, part.lit);
      } else {
        parts.push(part);
      }
    }
  }
  return interpolation(parts);
}

/** A `QueryFeatureName` as a value: a `Keyword` for an identifier, else its `Interpolation`. */
export function queryFeatureNameValue(name: unknown): Keyword | Interpolation {
  if (typeof name === 'string') {
    return keyword(name);
  }
  if (isInterpolation(name)) {
    return name;
  }
  throw new TypeError('A query feature lost its name.');
}

/*
 * A superset's interpolated feature name (`QueryFeatureName`: `(${f}: 1px)`,
 * `(min-#{$d} > 1px)`) is a value in the name's place, followed by `:` or a
 * comparison. A value-first range has its name, a string, after the
 * comparison, so an `Interpolation` there is the bound, not the name.
 */
export function isInterpolatedName(head: ValueNode, children: readonly unknown[]): boolean {
  const next = children[1];
  return head.type === 'Interpolation'
    && isTerminalText(next)
    && (tokenText(next) === ':' || queryComparisonOperators([next]).length === 1)
    && typeof children[2] !== 'string';
}
