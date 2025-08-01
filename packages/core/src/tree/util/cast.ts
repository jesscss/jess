import { Node } from '../node';
import { Nil } from '../nil';
import { List } from '../list';
import { Dimension } from '../dimension';
import { Number } from '../number';
import { Anonymous } from '../general';
import { Color } from '../color';
import { JsFunction } from '../js-function';
import { JsObject } from '../js-object';
import { Bool } from '../bool';
import isPlainObject from 'lodash-es/isPlainObject';

const { isArray } = Array;

function getNodeType(value: any): Node {
  if (value instanceof Node) {
    return value;
  }
  if (value === undefined || value === null) {
    return new Nil();
  }
  if (typeof value === 'boolean') {
    return new Bool(value);
  }
  if (typeof value === 'function') {
    return new JsFunction(value);
  }
  if (isPlainObject(value)) {
    return new JsObject(value);
  }
  if (isArray(value)) {
    return new List(value.map(val => cast(val)));
  }
  if (value.constructor === Number) {
    return new Number(value as unknown as number);
  }
  if (typeof value === 'string') {
    if (value.startsWith('#')) {
      return new Color(value);
    } else {
      let result = value.match(/^(\d*(?:\.\d+))([a-z]*)$/i);
      if (result) {
        return new Dimension({ number: parseFloat(result[1]!), unit: result[2] });
      }
    }
  }
  return new Anonymous(value.toString());
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
  if (!(value instanceof Node)) {
    node.evaluated = true;
  }
  return node;
}