import isPlainObject from 'lodash/isPlainObject'
import { default as lodashMerge } from 'lodash/merge'
import { default as lodashGet } from 'lodash/get'
import type { Context } from './context'
import memoize from 'micro-memoize'

/**
 * Use lodash merge for objects, return plain value otherwise
 */
export const merge = (value: any, incomingValue: any) => {
  if (incomingValue === undefined) {
    return value
  }
  if (isPlainObject(value)) {
    if (isPlainObject(incomingValue)) {
      return lodashMerge({}, value, incomingValue)
    }
    return value
  }
  return incomingValue
}

export const get = lodashGet

/**
 * Creates a proxy for the default function exports in transpiled stylesheets
 * 
 * This is so we can get hashed classes on the export
 */
export const proxy = (func: Function, context: Context) => {
  const memo = memoize(func.bind(context))
  return new Proxy(memo, {
    get(target, p) {
      let prop = p.toString()
      if (prop === '$IS_PROXY') {
        return true
      }
      if (prop.startsWith('__')) {
        prop = prop.slice(2)
        if (prop in target) {
          return target[prop]
        }
      }
      return context.hashClass(prop.toString())
    }
  })
}