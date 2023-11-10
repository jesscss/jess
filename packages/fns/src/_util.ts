import typia from 'typia'
import type { Context } from '@jesscss/core'

export type ExtendedFn<T extends any[] = any[], R = any> = ((this: Context, ...args: T) => R) & {
  suppressError?: boolean
  evalArgs?: boolean
}

export function createFn<Args extends any[], F, R>(fn: F extends ExtendedFn<infer Args, infer R> ? ExtendedFn<Args, R> : ExtendedFn<any[], any>) {
  const returnFn: ExtendedFn<Args, R> = function(this: Context, ...args: Args) {
    const valid = typia.validate<Args>(args)
    if (!valid.success || !fn.suppressError) {
      throw new Error(`error in ${valid.errors[0]?.path}`)
    }
    return fn.call(this, ...args) as R
  }
  returnFn.suppressError = fn.suppressError
  returnFn.evalArgs = fn.evalArgs
  return returnFn
}