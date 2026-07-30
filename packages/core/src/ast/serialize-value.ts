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
import { emitValue, isValueGroupArray, sepGlue } from './value-eval.js';
import { formatNumber } from './format-number.js';
import { serializeColor } from './color.js';

/**
 * Serialize a dimension: the shortest decimal within the output tolerance
 * ({@link formatNumber}) + unit; non-finite spelled `NaN`/`infinity`/`-infinity`.
 *
 * This is the SINGLE number policy for every computed dimension, in every position —
 * there is deliberately no interpolation-splice variant that emits different digits
 * for the same value.
 */
export function serializeDimension(n: Dimension): string {
  const { number, unit } = n;
  const s = Number.isFinite(number)
    ? formatNumber(number)
    : Number.isNaN(number) ? 'NaN' : number > 0 ? 'infinity' : '-infinity';
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

/** Serialize any structural value group to canonical bytes. */
export function serializeValue(v: ValueGroup): string {
  if (isValueGroupArray(v)) {
    return v.map(serializeValue).join(' ');
  }
  switch (v.type) {
    case 'Dimension': return serializeDimension(v);
    case 'Color': return serializeColor(v);
    case 'Quoted': return serializeQuoted(v);
    case 'Keyword': return v.text;
    case 'Any': return v.bytes;
    case 'Bool': return v.value ? 'true' : 'false';
    case 'Nil': return v.bytes;
    case 'List': return v.value.map(serializeValue).join(sepGlue(v.sep));
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
