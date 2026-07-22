import { makeBool, defineFunction } from '@jesscss/core/value';
import type { Dimension, Fn, ValueObj } from '@jesscss/core/value';

/**
 * Type-introspection predicates — the `is*` family (Less 4.x `functions/types.js`).
 * Each answers a `Bool` about the RUNTIME kind of its already-materialized argument
 * (the value substrate has sniffed a named-colour keyword → `Color`, a dimension
 * literal → `Dimension`, etc. by the time a body runs), mirroring legacy `isa`
 * (`n instanceof Type`).
 *
 * `isurl`/`isruleset` are intentionally absent: `URL` and `DetachedRuleset` are not
 * value-domain `ValueObj`s (they live in the statement domain), so there is nothing
 * to test here — add them when/if those kinds enter the value substrate.
 */

/** `iscolor(value)` — true when `value` is a colour (hex, named, or `rgb()`/`hsl()` result). */
export const iscolor: Fn = defineFunction('iscolor', {
  params: [{ kinds: 'any' }],
  body: v => makeBool(v.type === 'Color')
});

/** `isnumber(value)` — true when `value` is a dimension (unit-bearing or unitless number). */
export const isnumber: Fn = defineFunction('isnumber', {
  params: [{ kinds: 'any' }],
  body: v => makeBool(v.type === 'Dimension')
});

/** `isstring(value)` — true when `value` is a quoted string. */
export const isstring: Fn = defineFunction('isstring', {
  params: [{ kinds: 'any' }],
  body: v => makeBool(v.type === 'Quoted')
});

/** `iskeyword(value)` — true when `value` is a bare identifier (non-colour keyword). */
export const iskeyword: Fn = defineFunction('iskeyword', {
  params: [{ kinds: 'any' }],
  body: v => makeBool(v.type === 'Keyword')
});

/**
 * `isunit(value, unit)` — true when `value` is a dimension whose unit case-insensitively
 * equals `unit` (a keyword like `px`/`PX`, or a string like `''` for a unitless number).
 * A non-dimension, or a unit mismatch, is `false`. Legacy `n.unit.is(unit)`.
 */
export const isunit: Fn = defineFunction('isunit', {
  params: [{ kinds: 'any' }, { kinds: 'any' }],
  body: (value, unit) => makeBool(unitMatches(value, unit))
});

/** `ispixel(value)` — `isunit(value, px)`. */
export const ispixel: Fn = defineFunction('ispixel', {
  params: [{ kinds: 'any' }],
  body: v => makeBool(isDimUnit(v, 'px'))
});

/** `ispercentage(value)` — `isunit(value, %)`. */
export const ispercentage: Fn = defineFunction('ispercentage', {
  params: [{ kinds: 'any' }],
  body: v => makeBool(isDimUnit(v, '%'))
});

/** `isem(value)` — `isunit(value, em)`. */
export const isem: Fn = defineFunction('isem', {
  params: [{ kinds: 'any' }],
  body: v => makeBool(isDimUnit(v, 'em'))
});

/** The string form of an `isunit` unit argument: a keyword's text, a quoted's inner value. */
function unitText(u: ValueObj): string {
  if (u.type === 'Keyword') {
    return u.text;
  }
  if (u.type === 'Quoted') {
    return u.value;
  }
  return u.bytes;
}

function isDimUnit(v: ValueObj, unit: string): boolean {
  return v.type === 'Dimension' && (v as Dimension).unit.toLowerCase() === unit;
}

function unitMatches(value: ValueObj, unit: ValueObj): boolean {
  if (value.type !== 'Dimension') {
    return false;
  }
  return (value as Dimension).unit.toLowerCase() === unitText(unit).toLowerCase();
}
