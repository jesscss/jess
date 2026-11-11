import { makeBool, defineFunction, isValueGroupArray, namedColor } from '@jesscss/core/value';
import type { Fn, ValueGroup } from '@jesscss/core/value';

/**
 * A materialized value counts as a color for a type predicate when it is a
 * `Color` OR a `Keyword` that names a CSS color. NamedColor→Keyword convergence
 * keeps `red` a keyword at parse; its colour-ness is consulted here, at the
 * point of use, so `iscolor(red)` stays true and `iskeyword(red)` stays false.
 */
function isColorLike(value: ValueGroup): boolean {
  return !isValueGroupArray(value)
    && (value.type === 'Color' || (value.type === 'Keyword' && namedColor(value.text) !== undefined) || (value.type === 'FunctionCall' && value.computed && value.result === 'color'));
}

/** Less `iscolor()` — true for a colour value or a named-color keyword. */
const iscolor: Fn = /* @__PURE__ */ defineFunction('iscolor', {
  params: [{ type: 'any' }],
  body: value => makeBool(isColorLike(value))
});

/** Less `isnumber()` — true for an already-materialized dimension or a built-in's numeric form (Q10). */
const isnumber: Fn = /* @__PURE__ */ defineFunction('isnumber', {
  params: [{ type: 'any' }],
  body: value => makeBool(!isValueGroupArray(value) && (value.type === 'Dimension' || (value.type === 'FunctionCall' && value.computed && value.result === 'numeric')))
});

/** Less `isstring()` — true for a quoted value. */
const isstring: Fn = /* @__PURE__ */ defineFunction('isstring', {
  params: [{ type: 'any' }],
  body: value => makeBool(!isValueGroupArray(value) && value.type === 'Quoted')
});

/** Less `iskeyword()` — true for a bare keyword or a call written out: a named-color keyword
 * and a built-in's form answer `iscolor` or `isnumber` (Q10). */
const iskeyword: Fn = /* @__PURE__ */ defineFunction('iskeyword', {
  params: [{ type: 'any' }],
  body: value => makeBool(!isValueGroupArray(value) && (value.type === 'FunctionCall' || value.type === 'Keyword') && !isColorLike(value)
    && !(value.type === 'FunctionCall' && value.computed && value.result === 'numeric'))
});

/** Less `isurl()` — true only for a parser-owned `url(...)` value. */
const isurl: Fn = /* @__PURE__ */ defineFunction('isurl', {
  params: [{ type: 'any' }],
  body: value => makeBool(!isValueGroupArray(value) && value.type === 'Url')
});

/** Less `isunit()` — true for a dimension with a case-insensitive matching unit. */
const isunit: Fn = /* @__PURE__ */ defineFunction('isunit', {
  params: [{ type: 'any' }, { type: 'any' }],
  body: (value, unit) => makeBool(!isValueGroupArray(value)
    && value.type === 'Dimension'
    && value.unit.toLowerCase() === unitText(unit).toLowerCase())
});

/** Less `ispixel()` — `isunit(value, px)`. */
const ispixel: Fn = /* @__PURE__ */ defineFunction('ispixel', {
  params: [{ type: 'any' }],
  body: value => makeBool(isDimUnit(value, 'px'))
});

/** Less `ispercentage()` — `isunit(value, %)`. */
const ispercentage: Fn = /* @__PURE__ */ defineFunction('ispercentage', {
  params: [{ type: 'any' }],
  body: value => makeBool(isDimUnit(value, '%'))
});

/** Less `isem()` — `isunit(value, em)`. */
const isem: Fn = /* @__PURE__ */ defineFunction('isem', {
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

export { iscolor, isnumber, isstring, iskeyword, isurl, ispixel, ispercentage, isem, isunit };
