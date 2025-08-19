import { type ExtendedFn } from '../util';
import { defineFunction, Node } from '@jesscss/core';
import { array, instance, assert, type Context } from 'superstruct';

const Struct = array(instance(Node));

/**
 * Return the maximum value
 */
const max = defineFunction(
  'max',
  function(this: Context, ...values: Node[]) {
    assert(values, Struct);
    values = values.sort((a, b) => {
      let compare = b.compare(a);
      if (compare === undefined) {
        throw new TypeError(`Cannot compare ${a.type} and ${b.type}`);
      }
      return compare;
    });
    return values[0];
  },
  {
    params: [{
      name: 'values',
      type: [Node, 'number']
    }, {
      name: 'values',
      type: [Node, 'number']
    }, {
      name: 'values',
      type: [Node, 'number']
    }]
  }
);