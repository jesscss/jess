import { Any, Bool, Color, defineFunction, Dimension, Node, Quoted, Url } from '@jesscss/core';

const iscolor = defineFunction(
  'iscolor',
  function(value: Node) {
    return new Bool(value instanceof Color);
  },
  {
    params: [{ name: 'value', type: Node }]
  }
);

const isnumber = defineFunction(
  'isnumber',
  function(value: Node) {
    return new Bool(value instanceof Dimension);
  },
  {
    params: [{ name: 'value', type: Node }]
  }
);

const isstring = defineFunction(
  'isstring',
  function(value: Node) {
    return new Bool(value instanceof Quoted);
  },
  {
    params: [{ name: 'value', type: Node }]
  }
);

const iskeyword = defineFunction(
  'iskeyword',
  function(value: Node) {
    return new Bool(value instanceof Any && (value.options?.role === 'keyword' || value.options?.role === 'ident'));
  },
  {
    params: [{ name: 'value', type: Node }]
  }
);

const isurl = defineFunction(
  'isurl',
  function(value: Node) {
    return new Bool(value instanceof Url);
  },
  {
    params: [{ name: 'value', type: Node }]
  }
);

const isunit = defineFunction(
  'isunit',
  function(value: Node, unit: Node) {
    if (!(value instanceof Dimension)) {
      return new Bool(false);
    }
    const expected = String(unit.valueOf?.() ?? '').toLowerCase();
    const current = (value.value.unit ?? '').toLowerCase();
    return new Bool(current === expected);
  },
  {
    params: [{ name: 'value', type: Node }, { name: 'unit', type: Node }]
  }
);

const ispixel = defineFunction(
  'ispixel',
  function(value: Node) {
    return new Bool(value instanceof Dimension && (value.value.unit ?? '').toLowerCase() === 'px');
  },
  {
    params: [{ name: 'value', type: Node }]
  }
);

const ispercentage = defineFunction(
  'ispercentage',
  function(value: Node) {
    return new Bool(value instanceof Dimension && (value.value.unit ?? '').toLowerCase() === '%');
  },
  {
    params: [{ name: 'value', type: Node }]
  }
);

const isem = defineFunction(
  'isem',
  function(value: Node) {
    return new Bool(value instanceof Dimension && (value.value.unit ?? '').toLowerCase() === 'em');
  },
  {
    params: [{ name: 'value', type: Node }]
  }
);

export { iscolor, isnumber, isstring, iskeyword, isurl, ispixel, ispercentage, isem, isunit };
