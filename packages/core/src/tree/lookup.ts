import { defineType, Node } from './node'
import { type Interpolated } from './interpolated'
import { type Context } from '../context'
import isPlainObject from 'lodash-es/isPlainObject'
import { Rules } from './rules'

export type LookupValue = {
  /** This is the reference value to resolve first */
  value: Node
  key: string | Interpolated
}

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

  set key(v: string | Interpolated) {
    this.data.set('key', v)
  }

  toTrimmedString(): string {
    let { value, key } = this
    let mixin = this.options?.mixin
    const keyIsNode = key instanceof Node
    if (keyIsNode) {
      key = `[${key}]`
    }
    if (mixin) {
      return `${value} -> ${key}`
    } else if (keyIsNode) {
      return `${value}${key}`
    }
    return `${value}.${key}`
  }

  async eval(context: Context) {
    let { value, key } = this
    let keyStr: string = key instanceof Node ? (await key.eval(context)).value : key
    value = await value.eval(context)
    if (value instanceof Rules) {
      if (this.options?.mixin) {
        return value._scope.getMixin(keyStr)
      }
      if (keyStr.charAt(0) === '$') {
        return value._scope.getVar(keyStr)
      }
      return value._scope.getProp(keyStr)
    } else if (isPlainObject(value)) {
      return (value as Record<string, any>)[keyStr]
    } else {
      const type = value.type ?? typeof value
      throw new Error(`Cannot look up "${keyStr}" on value of type "${type}}"`)
    }
  }
}

export const look = defineType<LookupValue>(Lookup, 'Lookup', 'look')