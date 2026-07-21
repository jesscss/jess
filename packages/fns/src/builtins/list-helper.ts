/**
 * Shared kernel for the LIST / VARIADIC fns (`length`/`extract`/`min`/`max`).
 *
 * The value layer flattens a list literal to bare `Word` bytes before a fn arg
 * materializes (`@l: a b c` → a single keyword `"a b c"`; a space group
 * `min(1px 2px)` → a keyword per modern-arg), so a list fn never receives a
 * structured `List`. `coerceListItems` RECOVERS that structure at consumption
 * time: it splits a keyword's bytes at the top level (respecting parens/brackets/
 * quotes), materializing each element back to a typed `ValueObj`. Un-operated
 * lists still EMIT verbatim — this split only runs INSIDE a list fn's body, never
 * on the emit path, so byte-identity is unaffected.
 *
 * HARD MODULE BOUNDARY: value domain only (no `../tree`).
 */
import type { Dimension, EvalModes, List, ValueObj } from '@jesscss/core/value';
import { makeKeyword, sniffLiteral } from '@jesscss/core/value';
import { unify as unifyRaw } from '@jesscss/core/value';

/**
 * Narrow the single arg a VARIADIC fn receives to its `List`. The dispatcher
 * always hands a variadic body the arg `List` built in `evalCall`; this guard
 * makes that invariant type-safe (no cast) and documents it.
 */
export function asList(v: ValueObj): List {
  if (v.type !== 'List') throw new TypeError('variadic fn expected a List argument');
  return v;
}

/**
 * Split `text` at the TOP level on `sepChar` (`,` or a whitespace run), skipping
 * anything nested in `()[]{}` or inside a quoted string. Returns the trimmed,
 * non-empty pieces (or a single-element array when no top-level separator).
 */
function topLevelSplit(text: string, sepChar: ',' | ' '): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  const push = (end: number): void => {
    const piece = text.slice(start, end).trim();
    if (piece !== '') parts.push(piece);
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote !== '') {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0) {
      if (sepChar === ',' ? c === ',' : c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        push(i);
        start = i + 1;
      }
    }
  }
  push(text.length);
  return parts;
}

/** Whether `text` has a top-level `,` (a comma list binds looser than a space list). */
function hasTopLevelComma(text: string): boolean {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote !== '') {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === ',') return true;
  }
  return false;
}

/**
 * The list ELEMENTS of a materialized value, recovering structure Less would see:
 * a real `List` yields its items; a keyword whose bytes are a top-level list
 * (comma looser than space) splits + re-materializes each element; anything else
 * is a one-element list. Byte-faithful to legacy `coerceListItems`.
 */
export function coerceListItems(v: ValueObj | undefined): ValueObj[] {
  if (v === undefined) return [];
  if (v.type === 'List') return [...v.items];
  if (v.type === 'Keyword') {
    const text = v.text;
    const pieces = topLevelSplit(text, hasTopLevelComma(text) ? ',' : ' ');
    if (pieces.length <= 1) return [v];
    return pieces.map((p) => sniffLiteral(p));
  }
  return [v];
}

/* --------------------------------------------------- min / max unit kernel */

const unify = (d: Dimension): { number: number; unit: string } => unifyRaw(d.number, d.unit);

/**
 * Byte-faithful port of Less 4.x `minMax` (`functions/number.js`). Reduces a
 * variadic dimension list to the min/max, grouping compatible units by canonical
 * value. When more than one unit group survives, Less successfully returns an
 * anonymous CSS `min(...)`/`max(...)` value containing those reduced survivors;
 * this is semantic function output, not a call-failure fallback. Non-numeric input,
 * zero args, and strict-mode cross-unit input still throw for the shared evaluator
 * boundary to preserve or report.
 */
export function minMax(isMin: boolean, list: List, modes: EvalModes): ValueObj {
  const name = isMin ? 'min' : 'max';
  const args: ValueObj[] = list.items.flatMap((i) => coerceListItems(i));
  if (args.length === 0) throw new TypeError(`${name}() requires at least one numeric argument`);

  const order: Dimension[] = [];
  const values: Record<string, number> = {};
  let unitStatic: string | undefined;
  let unitClone: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const current = args[i]!;
    if (current.type !== 'Dimension') throw new TypeError(`${name}() requires numeric arguments`);

    const currentUnified =
      current.unit === '' && unitClone !== undefined ? unifyRaw(current.number, unitClone) : unify(current);
    const unit = currentUnified.unit === '' && unitStatic !== undefined ? unitStatic : currentUnified.unit;
    unitStatic =
      (unit !== '' && unitStatic === undefined) || (unit !== '' && order.length > 0 && unify(order[0]!).unit === '')
        ? unit
        : unitStatic;
    unitClone = unit !== '' && unitClone === undefined ? current.unit : unitClone;
    const j = values[''] !== undefined && unit !== '' && unit === unitStatic ? values[''] : values[unit];
    if (j === undefined) {
      if (unitStatic !== undefined && unit !== unitStatic && modes.unitMode === 'strict') {
        throw new TypeError(`${name}() arguments have incompatible units`);
      }
      values[unit] = order.length;
      order.push(current);
      continue;
    }
    const referenceUnified =
      order[j]!.unit === '' && unitClone !== undefined ? unifyRaw(order[j]!.number, unitClone) : unify(order[j]!);
    if ((isMin && currentUnified.number < referenceUnified.number) || (!isMin && currentUnified.number > referenceUnified.number)) {
      order[j] = current;
    }
  }

  if (order.length === 1) return order[0]!;
  // This is Less's successful anonymous result after per-unit reduction. It is
  // deliberately a value-domain Keyword, never an AST FunctionCall fabricated as
  // an evaluator fallback; the evaluator only handles genuine thrown failures.
  return makeKeyword(`${name}(${order.map(value => value.bytes).join(', ')})`);
}
