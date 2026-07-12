import { defineType, Node } from './node';
import { type Context } from '../context';
import isPlainObject from 'lodash-es/isPlainObject';
import { Rules } from './rules';
import { Reference } from './reference';
import { cast } from './util/cast';

export type LookupValue = {
  /**
   * This is the reference value to resolve first
   * This is what we're looking "in". No value means
   * the current rules.
   */
  target?: Node;
  /**
   * This is what we're looking for. This will
   * be a Node with a string or number value (or a reference to a variable)
   * This might be a mixin call, a variable, or a string / number key.
   *
   * Number is the (0-based) offset in rules.
   * Negative numbers are from the end.
   * @todo - Add tests for this
   */
  find: Node;
};

/**
 * Like object property lookup, but for other values too.
 * Lookups are not "chained"; like calls, they are
 * recursive nodes.
 *   e.g.
 *     $foo.one.two =
 *     (Lookup
 *       (value Lookup(value Reference($foo), key 'one'), key 'two')
 *
 * @todo - My guess is that this should be re-written or modified
 * now that Scope has been simplified within Rules?
 */
export class Lookup extends Node<LookupValue> {
  type = 'Lookup' as const;
  shortType = 'look' as const;

  override toTrimmedString(): string {
    let { target, find } = this.value;
    let mixin = find instanceof Reference && find.options.type === 'mixin';
    const keyIsBracketed = isNode(find, '');
    if (keyIsBracketed) {
      key = `[${key}]`;
    }
    if (mixin) {
      return `${value} > ${key}`;
    } else if (keyIsBracketed) {
      return `${value}${key}`;
    }
    return `${value}.${key}`;
  }

  override async evalNode(context: Context) {
    let { value, key } = this.value;
    let initialScope = context.scope;
    value = await value.eval(context);

    if (value instanceof Rules) {
      context.scope = value.scope;

      if (typeof key === 'string') {
        key = new Reference(key);
      } else if (typeof key === 'number') {
        let nodes = value.value;
        if (key < 0) {
          key += nodes.length;
        }
        return nodes[key];
      }

      let returnVal = key instanceof Node ? (await key.eval(context)).value : key;
      context.scope = initialScope;
      return returnVal;
    } else if (isPlainObject(value)) {
      if (typeof key === 'number') {
        let nodes = Object.values(value);
        if (key < 0) {
          key += nodes.length;
        }
        return nodes[key];
      } else if (key instanceof Node) {
        let keyValue = (await key.eval(context)).value;
        if (typeof keyValue !== 'string') {
          let keyType = keyValue.type ?? typeof keyValue;
          throw new Error(`Cannot look up non-string key "${keyType}" on object`);
        }
        return (value as Record<string, any>)[keyValue];
      }
      return (value as Record<string, any>)[key];
    } else {
      /** Try to look up the key and see what happens? */
      let keyValue: number | string;
      if (value instanceof Node) {
        value = value.value;
      }
      if (key instanceof Node) {
        keyValue = (await key.eval(context)).value;
      } else {
        keyValue = key;
      }
      let keyType = typeof keyValue;
      if (keyType !== 'string' && keyType !== 'number') {
        const type = value.type ?? typeof value;
        throw new Error(`Cannot look up type "${keyType}" on value of type "${type}}"`);
      }
      return cast((value as any)[keyValue]);
    }
  }
}

export const look = defineType<LookupValue>(Lookup, 'Lookup', 'look');