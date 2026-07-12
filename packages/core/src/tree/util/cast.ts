import type { Node } from '../node.js';
import { Nil } from '../nil.js';
import { List } from '../list.js';
// Dimension and Num are NOT imported here to break circular dependency:
// dimension.ts → color.ts → call.ts → cast.ts → dimension.ts
// Instead, we use createRequire to access them synchronously at runtime
import { Any } from '../any.js';
import { Color } from '../color.js';
import { JsFunction } from '../js-function.js';
import { JsObject } from '../js-object.js';
import { createPublicBool } from '../bool.js';
import { isNode } from './is-node.js';
import isPlainObject from 'lodash-es/isPlainObject.js';
import { createRequire } from 'node:module';

const { isArray } = Array;

// Create a synchronous require function for ES modules
const require = createRequire(import.meta.url);

// Lazy getters for Dimension and Num to break circular dependency
// These use require() to access modules at runtime, not at module load time
// By the time cast() is called, dimension.ts and number.ts will be fully loaded
function getDimension() {
  // Use require() to access module at runtime - breaks circular dependency at module load time
  return require('../dimension.js').Dimension;
}

function getNum() {
  // Use require() to access module at runtime - breaks circular dependency at module load time
  return require('../number.js').Num;
}

function getNodeType(value: any): Node {
  if (isNode(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return new Nil();
  }
  if (typeof value === 'boolean') {
    return createPublicBool(value);
  }
  if (typeof value === 'function') {
    const options = Reflect.get(value, 'options');
    return new JsFunction(value, typeof options === 'object' && options !== null ? options : undefined);
  }
  if (isPlainObject(value)) {
    return new JsObject(value);
  }
  if (isArray(value)) {
    return new List(value.map(val => cast(val)));
  }
  if (typeof value === 'number') {
    const Num = getNum();
    return new Num(value);
  }
  if (value instanceof Number) {
    const Num = getNum();
    return new Num(value.valueOf());
  }
  if (typeof value === 'string') {
    if (value.startsWith('#')) {
      return new Color(value);
    } else {
      let result = value.match(/^(\d*(?:\.\d+))([a-z]*)$/i);
      if (result) {
        const Dimension = getDimension();
        return new Dimension({ number: parseFloat(result[1]!), unit: result[2] });
      }
    }
  }
  return new Any(value.toString());
}

/**
 * Casts a primitive JavaScript value to a Jess node
 * (if not already).
 *
 * @example
 * cast(area(5))
 */
export function cast(value: any): Node {
  const node = getNodeType(value);
  /**
   * If converting from a primitive, then
   * the value should be considered evaluated.
   */
  if (!isNode(value)) {
    node.evaluated = true;
    node.registrationPrepared = true;
  }
  return node;
}
