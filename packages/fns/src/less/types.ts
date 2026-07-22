import { Any, Bool, Color, defineFunction, Dimension, Node, Quoted, Url } from '@jesscss/core';

/** Less `iscolor()` — true when the value is a `Color`. */
const iscolor = defineFunction(
  'iscolor',
  function(value: Node) {
    return new Bool(value instanceof Color);
  },
  {
    params: [{ name: 'value', type: Node }]
  }
);

/** Less `isnumber()` — true when the value is a numeric `Dimension`. */
const isnumber = defineFunction(
  'isnumber',
  function(value: Node) {
    return new Bool(value instanceof Dimension);
  },
  {
    params: [{ name: 'value', type: Node }]
  }
);

/** Less `isstring()` — true when the value is a `Quoted` string. */
const isstring = defineFunction(
  'isstring',
  function(value: Node) {
    return new Bool(value instanceof Quoted);
  },
  {
    params: [{ name: 'value', type: Node }]
  }
);

/** Less `iskeyword()` — true when the value is an unquoted keyword/identifier. */
const iskeyword = defineFunction(
  'iskeyword',
  function(value: Node) {
    return new Bool(value instanceof Any && (value.role === 'keyword' || value.role === 'ident'));
  },
  {
    params: [{ name: 'value', type: Node }]
  }
);

/** Less `isurl()` — true when the value is a `url(…)` value. */
const isurl = defineFunction(
  'isurl',
  function(value: Node) {
    return new Bool(value instanceof Url);
  },
  {
    params: [{ name: 'value', type: Node }]
  }
);

/** Less `isunit()` — true when `value` is a `Dimension` whose unit equals `unit` (case-insensitive). */
const isunit = defineFunction(
  'isunit',
  function(value: Node, unit: Node) {
    if (!(value instanceof Dimension)) {
      return new Bool(false);
    }
    const expected = String(unit.valueOf?.() ?? '').toLowerCase();
    const current = (value.unit ?? '').toLowerCase();
    return new Bool(current === expected);
  },
  {
    params: [{ name: 'value', type: Node }, { name: 'unit', type: Node }]
  }
);

/** Less `ispixel()` — true when the value is a `Dimension` in `px`. */
const ispixel = defineFunction(
  'ispixel',
  function(value: Node) {
    return new Bool(value instanceof Dimension && (value.unit ?? '').toLowerCase() === 'px');
  },
  {
    params: [{ name: 'value', type: Node }]
  }
);

/** Less `ispercentage()` — true when the value is a `Dimension` in `%`. */
const ispercentage = defineFunction(
  'ispercentage',
  function(value: Node) {
    return new Bool(value instanceof Dimension && (value.unit ?? '').toLowerCase() === '%');
  },
  {
    params: [{ name: 'value', type: Node }]
  }
);

/** Less `isem()` — true when the value is a `Dimension` in `em`. */
const isem = defineFunction(
  'isem',
  function(value: Node) {
    return new Bool(value instanceof Dimension && (value.unit ?? '').toLowerCase() === 'em');
  },
  {
    params: [{ name: 'value', type: Node }]
  }
);

export { iscolor, isnumber, isstring, iskeyword, isurl, ispixel, ispercentage, isem, isunit };
