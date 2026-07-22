/**
 * Byte-faithful VALUE serializer for dimension / quoted / list leaves, plus the
 * `serializeValue` dispatch over the whole value domain. Emit is FREE FUNCTIONS
 * over pure data — no node is constructed, no `render()` walk. Color emit lives in
 * `color.ts`; the shared `round` in `round.ts`.
 *
 * HARD MODULE BOUNDARY: imports only the value-domain types + `round` + `color`.
 */
import type { Dimension, Quoted, Value, ValueObj } from './value-eval.js';
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

/**
 * Emit a value for an INTERPOLATION splice (`@{x}` into a selector / property name /
 * `~"…"` string). less.js serializes an interpolated value at EVAL time, where the
 * context carries no `numPrecision`, so an interpolated `Dimension` keeps FULL double
 * precision (`pi()` → `3.141592653589793`) instead of the 8-dp `numPrecision`
 * rounding a declaration VALUE gets (`pi()` → `3.14159265`). Only a COMPUTED
 * dimension is affected: the guard `bytes === serializeDimension(v)` fires solely for
 * the machine-serialized (rounded-canonical) form, so an un-operated source literal
 * (`1.0px`, `2PX`) — whose `bytes` is its verbatim spelling — is emitted UNCHANGED.
 * Non-finite dims and every non-dimension value fall through to canonical `bytes`.
 */
export function emitValueInterp(v: Value): string {
  if (typeof v !== 'string' && v.type === 'Dimension'
    && Number.isFinite(v.number) && v.bytes === serializeDimension(v)) {
    return `${v.number}${v.unit}`;
  }
  return typeof v === 'string' ? v : v.bytes;
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
    case 'List': return v.value.map(serializeValue).join(sepGlue(v.sep));
    case 'Block': {
      const open = v.delimiter === 'square' ? '[' : '(';
      const close = v.delimiter === 'square' ? ']' : ')';
      return `${v.escaped ? '~' : ''}${open}${serializeValue(v.inner)}${close}`;
    }
  }
}
