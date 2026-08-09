/**
 * Byte-faithful VALUE serializer for dimension / quoted / list leaves, plus the
 * `serializeValue` dispatch over the whole value domain. Emit is FREE FUNCTIONS
 * over pure data — no node is constructed, no `render()` walk. Color emit lives in
 * `color.ts`; the number policy in `format-number.ts`.
 *
 * HARD MODULE BOUNDARY: imports only the value-domain types + the number policy
 * (`format-number`) + `color`.
 */
import type { CollectionEntry, Dimension, Quoted, ValueGroup } from './value-eval.js';
import { emitValue, isValueGroupArray, joinGroup, sepGlue } from './value-eval.js';
import { formatNumber } from './format-number.js';
import { serializeColor } from './color.js';

/**
 * Serialize a dimension: the shortest decimal within the output tolerance
 * ({@link formatNumber}) + unit.
 *
 * This is the SINGLE number policy for every computed dimension, in every position —
 * there is deliberately no interpolation-splice variant that emits different digits
 * for the same value.
 *
 * It used to spell a non-finite number `NaN`/`infinity`/`-infinity` and emit it, so
 * `sqrt(-4)` wrote `x: NaN` into the stylesheet. None of those are CSS `<number>`s;
 * a non-finite computed number is an evaluation error, ruled once inside
 * {@link formatNumber} (ledger **V7**) rather than re-decided per emit site.
 */
export function serializeDimension(n: Dimension): string {
  /*
   * §4.7 — a computed dimension whose unit CSS cannot express says the AUTHORED
   * expression back instead of pinning a fabricated unit onto the magnitude
   * (`1px * 2px` is an area; there is no area unit, and `2px` is a lie). The
   * value itself is unchanged and still fully computed — this is the one place
   * that spelling is decided, so no consumer of a `Dimension` has to know.
   */
  if (n.preserved !== undefined) {
    return `calc(${n.preserved})`;
  }
  const { unit } = n;
  const s = formatNumber(n.number);
  return unit ? `${s}${unit}` : s;
}

/** Serialize a quoted string (escaping-aware: `~` prefix when escaped). */
export function serializeQuoted(q: Quoted): string {
  const quote = q.quote || '"';
  return `${q.escaped ? '~' : ''}${quote}${q.value}${quote}`;
}

/**
 * One `key: value` pair of a Collection.
 *
 * Members emit through {@link emitValue} — their OWN already-canonical `bytes` —
 * never through a recursive re-serialization. A container must not re-run the
 * number policy over a member it merely holds: that would rewrite an un-operated
 * `1.0px` to `1px` purely by being inside a map.
 */
function collectionEntryBytes(entry: CollectionEntry): string {
  const sigil = entry.variable === true ? '@' : '';
  const important = entry.important === true ? ' !important' : '';
  return `${sigil}${emitValue(entry.key)}: ${emitValue(entry.value)}${important}`;
}

/*
 * NOTE (§12.6c): the bracketed-value PRINT rule is deliberately NOT enforced in
 * this function. `serializeValue` is not a print site — it is the value domain's
 * general byte derivation, and function-argument materialization runs through it,
 * so a rule thrown from here rejects `length([1, 2])`, which the ruling
 * explicitly permits. The rule lives at the eval lane's Block case, which is the
 * point where a value's bytes become OUTPUT.
 */

/** Serialize any structural value group to canonical bytes. */
export function serializeValue(v: ValueGroup): string {
  if (isValueGroupArray(v)) {
    return joinGroup(v, ' ', serializeValue);
  }
  switch (v.type) {
    case 'Dimension': return serializeDimension(v);
    case 'Color': return serializeColor(v);
    case 'Quoted': return serializeQuoted(v);
    case 'Keyword': return v.text;
    case 'Any': return v.bytes;
    case 'Bool': return v.value ? 'true' : 'false';
    case 'Null': return v.bytes;
    case 'List': return joinGroup(v.value, sepGlue(v.sep), serializeValue);
    case 'Block': {
      const open = v.delimiter === 'square' ? '[' : '(';
      const close = v.delimiter === 'square' ? ']' : ')';
      return `${v.escaped ? '~' : ''}${open}${serializeValue(v.value)}${close}`;
    }
    case 'Collection': {
      const body = v.entries.map(collectionEntryBytes).join('; ');
      const block = body === '' ? '{}' : `{ ${body} }`;
      return v.base === undefined ? block : `${emitValue(v.base)} ${block}`;
    }
  }
}
