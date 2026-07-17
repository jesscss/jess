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
import type { Dimension, List, ValueObj } from '../value-eval.js';
import { sniffLiteral } from '../literal-tag.js';
import { makeKeyword } from '../value-factory.js';
import { unify as unifyRaw } from '../value-units.js';

/**
 * Narrow the single arg a VARIADIC fn receives to its `List`. The dispatcher
 * always hands a variadic body the arg `List` built in `evalCall`; this guard
 * makes that invariant type-safe (no cast) and documents it.
 */
export function asList(v: ValueObj): List {
  if (v.kind !== 'list') throw new TypeError('variadic fn expected a List argument');
  return v;
}

/** Join separator for a reconstructed call's verbatim arg bytes (per separator). */
export function sepGlue(sep: List['sep']): string {
  return sep === ',' ? ', ' : sep === '/' ? ' / ' : ' ';
}

/** Reconstruct a call left UNEVALUATED (byte-identical to the unknown-fn path). */
export function verbatimCall(name: string, list: List): ValueObj {
  return makeKeyword(`${name}(${list.items.map((i) => i.bytes).join(sepGlue(list.sep))})`);
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
  if (v.kind === 'list') return [...v.items];
  if (v.kind === 'keyword') {
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
 * value. ANY incompatible-unit pairing (or a non-dimension arg, or zero args)
 * leaves the whole call UNEVALUATED — emitted verbatim — exactly as Less's
 * `try/catch` around `minMax` does. NOTE this intentionally has NO `loose`-mode
 * leniency: the `@jesscss/fns` port added one, so the built-in correctly DIVERGES from
 * that (buggy) adapter for multi-incompatible-unit inputs.
 */
export function minMax(isMin: boolean, list: List): ValueObj {
  const name = isMin ? 'min' : 'max';
  const args: ValueObj[] = list.items.flatMap((i) => coerceListItems(i));
  if (args.length === 0) return verbatimCall(name, list);

  const order: Dimension[] = [];
  const values: Record<string, number> = {};
  let unitStatic: string | undefined;
  let unitClone: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const current = args[i]!;
    if (current.kind !== 'dimension') return verbatimCall(name, list);

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
      if (unitStatic !== undefined && unit !== unitStatic) return verbatimCall(name, list);
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
  return makeKeyword(`${name}(${order.map((d) => d.bytes).join(', ')})`);
}
