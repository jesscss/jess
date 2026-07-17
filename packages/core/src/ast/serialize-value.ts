/**
 * Byte-faithful VALUE serializer for dimension / quoted / list leaves, plus the
 * `serializeValue` dispatch over the whole value domain. Emit is FREE FUNCTIONS
 * over pure data — no node is constructed, no `render()` walk. Color emit lives in
 * `color.ts`; the shared `round` in `round.ts`.
 *
 * HARD MODULE BOUNDARY: imports only the value-domain types + `round` + `color`.
 */
import type { Dimension, Quoted, ValueObj } from './value-eval.js';
import { sepGlue } from './value-eval.js';
import { round } from './round.js';
import { serializeColor } from './color.js';

/** Serialize a dimension: number rounded to 8 dp + unit; non-finite spelled `NaN`/`infinity`/`-infinity`. */
export function serializeDimension(n: Dimension): string {
  const { number, unit } = n;
  const s = Number.isFinite(number)
    ? `${round(number, 8)}`
    : Number.isNaN(number) ? 'NaN' : number > 0 ? 'infinity' : '-infinity';
  return unit ? `${s}${unit}` : s;
}

/** Serialize a quoted string (escaping-aware: `~` prefix when escaped). */
export function serializeQuoted(q: Quoted): string {
  const quote = q.quote || '"';
  return `${q.escaped ? '~' : ''}${quote}${q.value}${quote}`;
}

/** Serialize any `ValueObj` to its canonical bytes. */
export function serializeValue(v: ValueObj): string {
  switch (v.type) {
    case 'Dimension': return serializeDimension(v);
    case 'Color': return serializeColor(v);
    case 'Quoted': return serializeQuoted(v);
    case 'Keyword': return v.text;
    case 'Bool': return v.value ? 'true' : 'false';
    case 'Nil': return v.bytes;
    case 'List': return v.items.map(serializeValue).join(sepGlue(v.sep));
  }
}
