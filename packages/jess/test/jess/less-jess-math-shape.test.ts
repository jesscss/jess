/**
 * Less math and its `.jess` spelling lower to ONE shape (DESIGN-DECISIONS P35).
 *
 * P35's invariant is `.less → .css` byte-identical to `.less → .jess → .css`
 * (`docs/design/JESS-EQUIVALENCE-HARNESS.md`). This is its SHAPE proxy: each row
 * is a Less value and its hand-written `.jess` equivalent, and the two parsed
 * values must be equal modulo variable-reference spelling (`@a` scoped vs `$a`
 * live — the same variable, two binding stores).
 *
 * RATCHET, not gate. A row with a `gap` records a measured divergence; the row
 * fails if the divergence closes, so the note is flipped in the same commit.
 * `.jess` syntax is gated on the AST covering Less (the dialect lags on
 * purpose), so a `.jess`-side gap is expected and parked, never fixed here.
 */
import { describe, expect, it } from 'vitest';
import { parse as parseLess } from '@jesscss/less-parser';
import { parse as parseJess } from '@jesscss/jess-parser';

interface Row {
  less: string;
  jess: string;

  /** A measured divergence, and what is left equal once it is set aside. */
  gap?: {
    reason: string;
    normalize: (value: unknown) => unknown;
  };
}

/*
 * `.jess` reduces a standalone `$( … )` to a one-part `Interpolation` around the
 * `Expression` (`jess-parser/src/grammar.ts`, the `Expression` rule). Less lowers
 * to the bare `Expression`. Matching the wrapper was measured and rejected: an
 * `Interpolation` stringifies its ref, so a Less computation would lose its type
 * (`unit((@onePixel * 4em / 2cm))` throws) and skip the `unitMode` ladder — nine
 * more failing tests in the jess suite, none of them in P35's expected moves.
 */
const INTERPOLATED_EXPRESSION = 'a standalone `.jess` `$( … )` is a one-part Interpolation around the Expression';
function unwrapInterpolatedExpression(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(unwrapInterpolatedExpression);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if ('type' in value && value.type === 'Interpolation' && 'parts' in value && Array.isArray(value.parts)
    && value.parts.length === 1) {
    const [part] = value.parts as unknown[];
    if (typeof part === 'object' && part !== null && 'ref' in part) {
      return unwrapInterpolatedExpression(part.ref);
    }
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrapInterpolatedExpression(item)]));
}

const ROWS: Row[] = [
  { less: '@w: @a * 2;', jess: '$w: $($a * 2);', gap: { reason: INTERPOLATED_EXPRESSION, normalize: unwrapInterpolatedExpression } },
  { less: '@w: @a * 2 / @b;', jess: '$w: $($a * 2) / $b;', gap: { reason: INTERPOLATED_EXPRESSION, normalize: unwrapInterpolatedExpression } },
  { less: '@w: (@a * 2 / @b);', jess: '$w: $($a * 2 / $b);', gap: { reason: INTERPOLATED_EXPRESSION, normalize: unwrapInterpolatedExpression } },
  { less: 'a { font: 12px/1.5 Arial; }', jess: 'a { font: 12px/1.5 Arial; }' },
  { less: '@a: 1px; a { width: calc(100% - @a); }', jess: '$a: 1px; a { width: calc(100% - $a); }' },
  { less: '@w: 4 / 2;', jess: '$w: 4 / 2;' }
];

/** The value of the last statement — a variable declaration, or a ruleset's first declaration. */
function lastValue(rules: readonly unknown[]): unknown {
  const last = rules.at(-1);
  if (typeof last !== 'object' || last === null || !('type' in last)) {
    throw new TypeError('expected a statement');
  }
  if (last.type === 'Ruleset' && 'rules' in last && Array.isArray(last.rules)) {
    return lastValue([last.rules[0]]);
  }
  if ('value' in last) {
    return last.value;
  }
  throw new TypeError(`expected a value-bearing statement, got ${String(last.type)}`);
}

/** Drop spans, and spell every variable reference as `{ kind, name }`. */
function canonical(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, item: unknown) => {
    if (key.startsWith('_')) {
      return undefined;
    }
    if (typeof item === 'object' && item !== null && 'type' in item && item.type === 'Lookup' && 'kind' in item && 'name' in item) {
      return { type: 'Lookup', kind: item.kind, name: item.name };
    }
    return item;
  }));
}

describe('Less math and its .jess spelling lower to one shape (P35 shape proxy)', () => {
  for (const row of ROWS) {
    it(`${row.less}  ≡  ${row.jess}`, () => {
      const less = canonical(lastValue(parseLess(row.less).rules));
      const jess = canonical(lastValue(parseJess(row.jess).rules));
      if (row.gap === undefined) {
        expect(less).toEqual(jess);
        return;
      }
      expect(less, `gap closed — flip this row: ${row.gap.reason}`).not.toEqual(jess);
      expect(row.gap.normalize(less)).toEqual(row.gap.normalize(jess));
    });
  }
});
