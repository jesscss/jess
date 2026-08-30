import type { Node } from '../node.js';
import { Nil } from '../nil.js';
import { List } from '../list.js';

/*
 * dimension.ts/number.ts sit in the same import cycle as color.ts
 * (dimension → color → call → cast → dimension). ESM tolerates the cycle: the
 * bindings are only dereferenced at call time (getNodeType), by which point the
 * modules are fully initialized — same as the Color import above.
 */
import { Dimension } from '../dimension.js';
import { Num } from '../number.js';
import { Any } from '../any.js';
import { Color } from '../color.js';
import { JsFunction } from '../js-function.js';
import { JsObject } from '../js-object.js';
import { createPublicBool } from '../bool.js';
import { isNode } from './is-node.js';
import isPlainObject from 'lodash-es/isPlainObject.js';

const { isArray } = Array;

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
    const options = 'options' in value ? value.options : undefined;
    return new JsFunction(value, typeof options === 'object' && options !== null ? options : undefined);
  }
  if (isPlainObject(value)) {
    return new JsObject(value);
  }
  if (isArray(value)) {
    const items = new Array<Node>(value.length);
    for (let i = 0; i < value.length; i++) {
      items[i] = cast(value[i]);
    }
    return new List(items);
  }
  if (typeof value === 'number') {
    return new Num(value);
  }
  if (value instanceof Number) {
    return new Num(value.valueOf());
  }
  if (typeof value === 'string') {
    if (value.startsWith('#')) {
      return new Color(value);
    }
    let result = value.match(/^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i);
    if (result) {
      return new Dimension({ number: parseFloat(result[1]!), unit: result[2] });
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
    node.registrationPrepared = true;
  }
  return node;
}
