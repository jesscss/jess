import { makeBool, defineFunction, isValueGroupArray } from '@jesscss/core';
import type { Fn, ValueGroup, Value } from '@jesscss/core';

/*
 * `isurl()` deliberately has no AST-v2 value-domain export. `Url` is syntax,
 * not a materialized Value tag; once evaluated its rendered `url(...)` form is
 * intentionally opaque. Recreating the legacy predicate would require sniffing
 * output bytes, which this function layer must not do.
 */

/** Less `iscolor()` — true for an already-materialized colour value. */
const iscolor: Fn = defineFunction('iscolor', {
  params: [{ type: 'any' }],
  body: value => makeBool(!isValueGroupArray(value) && value.type === 'Color')
});

/** Less `isnumber()` — true for an already-materialized dimension. */
const isnumber: Fn = defineFunction('isnumber', {
  params: [{ type: 'any' }],
  body: value => makeBool(!isValueGroupArray(value) && value.type === 'Dimension')
});

/** Less `isstring()` — true for a quoted value. */
const isstring: Fn = defineFunction('isstring', {
  params: [{ type: 'any' }],
  body: value => makeBool(!isValueGroupArray(value) && value.type === 'Quoted')
});

/** Less `iskeyword()` — true for a materialized bare keyword. */
const iskeyword: Fn = defineFunction('iskeyword', {
  params: [{ type: 'any' }],
  body: value => makeBool(!isValueGroupArray(value) && value.type === 'Keyword')
});

/** Less `isunit()` — true for a dimension with a case-insensitive matching unit. */
const isunit: Fn = defineFunction('isunit', {
  params: [{ type: 'any' }, { type: 'any' }],
  body: (value, unit) => makeBool(!isValueGroupArray(value)
    && value.type === 'Dimension'
    && value.unit.toLowerCase() === unitText(unit).toLowerCase())
});

/** Less `ispixel()` — `isunit(value, px)`. */
const ispixel: Fn = defineFunction('ispixel', {
  params: [{ type: 'any' }],
  body: value => makeBool(isDimUnit(value, 'px'))
});

/** Less `ispercentage()` — `isunit(value, %)`. */
const ispercentage: Fn = defineFunction('ispercentage', {
  params: [{ type: 'any' }],
  body: value => makeBool(isDimUnit(value, '%'))
});

/** Less `isem()` — `isunit(value, em)`. */
const isem: Fn = defineFunction('isem', {
  params: [{ type: 'any' }],
  body: value => makeBool(isDimUnit(value, 'em'))
});

function unitText(value: ValueGroup): string {
  if (isValueGroupArray(value)) {
    return '';
  }
  if (value.type === 'Keyword') {
    return value.text;
  }
  if (value.type === 'Quoted') {
    return value.value;
  }
  return value.bytes;
}

function isDimUnit(value: ValueGroup, unit: string): boolean {
  return !isValueGroupArray(value) && value.type === 'Dimension' && value.unit.toLowerCase() === unit;
}

export { iscolor, isnumber, isstring, iskeyword, ispixel, ispercentage, isem, isunit };
