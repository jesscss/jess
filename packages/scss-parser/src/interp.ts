/**
 * SCSS `#{…}` interpolation helpers for the functional grammar builders.
 * Mirrors productions/helpers.ts (Chevrotain) without the nested parser bootstrap.
 */
import {
  Any,
  Expression,
  Interpolated,
  INTERPOLATION_PLACEHOLDER,
  Reference,
  isNode,
  N,
  Node,
  type LocationInfo
} from '@jesscss/core';

export type InterpRole = 'ident' | 'property' | 'any' | 'name';

let parseScssFnLazy: ((input: string, rule?: string) => import('./grammar.js').ScssFnParseResult) | undefined;

/** Wired from grammar.ts after `parseScssFn` is defined (breaks circular import). */
export function setParseScssFnForInterp(
  fn: (input: string, rule?: string) => import('./grammar.js').ScssFnParseResult
): void {
  parseScssFnLazy = fn;
}

export function findScssInterpolationSpans(value: string): Array<{ start: number; end: number; content: string }> {
  const matches: Array<{ start: number; end: number; content: string }> = [];
  let i = 0;
  while (i < value.length) {
    if (value[i] === '#' && value[i + 1] === '{') {
      const start = i;
      i += 2;
      let depth = 1;
      const contentStart = i;
      while (i < value.length && depth > 0) {
        const ch = value[i]!;
        if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
        }
        i++;
      }
      if (depth === 0) {
        matches.push({ start, end: i, content: value.slice(contentStart, i - 1) });
      }
    } else {
      i++;
    }
  }
  return matches;
}

function unwrapSingleReference(n: Node): Reference | undefined {
  if (
    isNode(n, N.Reference)
    && n.options?.type === 'variable'
    && !n.target
    && typeof n.key === 'string'
  ) {
    return n;
  }
  return undefined;
}

function valueFromParseResult(
  r: import('./grammar.js').ScssFnParseResult,
  fallback: string,
  loc: LocationInfo
): Node {
  const root = r.tree;
  if (isNode(root, N.Rules) && root.rules.length > 0) {
    return root.rules[0]!;
  }
  if (root instanceof Node) {
    return root;
  }
  return new Any(fallback, { role: 'any' }, loc);
}

/** Parse a `#{…}` inner expression via the functional value grammar. */
export function parseScssInterpExpr(expr: string, loc: LocationInfo): Node {
  const trimmed = expr.trim();
  if (!trimmed) {
    return new Any('', { role: 'any' }, loc);
  }
  if (!parseScssFnLazy) {
    throw new Error('parseScssFn not wired for interpolation (setParseScssFnForInterp)');
  }
  const r = parseScssFnLazy(trimmed, 'valueList');
  if (r.errors.length) {
    return new Any(trimmed, { role: 'any' }, loc);
  }
  const tree = valueFromParseResult(r, trimmed, loc);
  const ref = unwrapSingleReference(tree);
  if (ref && typeof ref.key === 'string') {
    return new Reference({ key: ref.key }, { type: 'variable', role: 'ident' }, loc);
  }
  if (isNode(tree, N.Reference)) {
    return new Expression(tree, undefined, loc);
  }
  return tree;
}

/** Turn a parsed expression into an interpolation replacement (name/ident slots). */
export function toInterpReplacement(expr: Node, loc: LocationInfo): Node {
  const ref = unwrapSingleReference(expr);
  if (ref && typeof ref.key === 'string') {
    return new Reference({ key: ref.key }, { type: 'variable', role: 'ident' }, loc);
  }
  if (isNode(expr, N.Reference)) {
    return new Expression(expr, undefined, loc);
  }
  return expr;
}

/** Build an `Interpolated` node from a string containing `#{…}` runs. */
export function buildScssInterpolatedFromString(
  value: string,
  loc: LocationInfo,
  role: InterpRole
): Any | Interpolated {
  const matches = findScssInterpolationSpans(value);
  if (matches.length === 0) {
    return new Any(value, { role }, loc);
  }
  const replacements: Node[] = [];
  let source = value;
  let offset = 0;
  for (const match of matches) {
    const adjustedStart = match.start - offset;
    const adjustedEnd = match.end - offset;
    source = source.slice(0, adjustedStart) + INTERPOLATION_PLACEHOLDER + source.slice(adjustedEnd);
    offset += (match.end - match.start) - INTERPOLATION_PLACEHOLDER.length;
    replacements.push(toInterpReplacement(parseScssInterpExpr(match.content, loc), loc));
  }
  return new Interpolated({ source, replacements }, { role }, loc);
}
