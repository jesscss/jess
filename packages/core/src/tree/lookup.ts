import { defineType, Node } from './node'
import { type Context } from '../context'
import isPlainObject from 'lodash-es/isPlainObject'
import { Rules } from './rules'
import { Reference } from './reference'
import { cast } from './util/cast'

export type LookupValue = {
  /** This is the reference value to resolve first */
  value: Node
  /**
   * Number is the (0-based) position in rules.
   * Negative numbers are from the end.
   */
  key: string | number | Node
}

/**
 * Unlike references, lookups between props and vars
 * are distinguished by a preceding '$' or not.
 *
 * This is done for interoperability with JavaScript.
 */
export type LookupOptions = {
  mixin?: boolean
}

/**
 * Like object property lookup, but for other values too.
 * Lookups are not "chained"; like calls, they are
 * recursive nodes.
 *   e.g.
 *     $foo.one.two =
 *     (Lookup
 *       (value Lookup(value Reference($foo), key 'one'), key 'two')
 */
export class Lookup extends Node<LookupValue, LookupOptions> {
  get key() {
    return this.data.get('key')
  }

  set key(v: string | number | Node) {
    this.data.set('key', v)
  }

  toTrimmedString(): string {
    let { value, key } = this
    let mixin = this.options?.mixin
    const keyIsBracketed = typeof key !== 'string'
    if (keyIsBracketed) {
      key = `[${key}]`
    }
    if (mixin) {
      return `${value} -> ${key}`
    } else if (keyIsBracketed) {
      return `${value}${key}`
    }
    return `${value}.${key}`
  }

  async eval(context: Context) {
    let { value, key } = this
    let initialScope = context.scope
    value = await value.eval(context)

    if (value instanceof Rules) {
      context.scope = value._scope

      if (typeof key === 'string') {
        key = new Reference(key)
      } else if (typeof key === 'number') {
        let nodes = value.value
        if (key < 0) {
          key += nodes.length
        }
        return nodes[key]
      }

      let returnVal = key instanceof Node ? (await key.eval(context)).value : key
      context.scope = initialScope
      return returnVal
    } else if (isPlainObject(value)) {
      if (typeof key === 'number') {
        let nodes = Object.values(value)
        if (key < 0) {
          key += nodes.length
        }
        return nodes[key]
      } else if (key instanceof Node) {
        let keyValue = (await key.eval(context)).value
        if (typeof keyValue !== 'string') {
          let keyType = keyValue.type ?? typeof keyValue
          throw new Error(`Cannot look up non-string key "${keyType}" on object`)
        }
        return (value as Record<string, any>)[keyValue]
      }
      return (value as Record<string, any>)[key]
    } else {
      /** Try to look up the key and see what happens? */
      let keyValue: number | string
      if (value instanceof Node) {
        value = value.value
      }
      if (key instanceof Node) {
        keyValue = (await key.eval(context)).value
      } else {
        keyValue = key
      }
      let keyType = typeof keyValue
      if (keyType !== 'string' && keyType !== 'number') {
        const type = value.type ?? typeof value
        throw new Error(`Cannot look up type "${keyType}" on value of type "${type}}"`)
      }
      return cast((value as any)[keyValue])
    }
  }
}

export const look = defineType<LookupValue>(Lookup, 'Lookup', 'look')