import type { Context } from '@jesscss/core'
import type { CheckResult } from 'arktype/dist/types/traverse/traverse'

export type ExtendedFn<T extends any[] = any[], R = any> = ((this: Context, ...args: T) => R) & {
  /**
   * Allow for optional calling, which means an optional
   * reference to a function will output a stringified
   * function representation if there's an evaluation error.
   *
   * This is done for Less, which sets this for functions
   * that have a CSS equivalent.
   */
  allowOptional?: boolean
  evalArgs?: boolean
}

// export function createFn<Args extends any[], F, R>(fn: F extends ExtendedFn<infer Args, infer R> ? ExtendedFn<Args, R> : ExtendedFn<any[], any>) {
//   const returnFn: ExtendedFn<Args, R> = function(this: Context, ...args: Args) {
//     const valid = typia.validate<Args>(args)
//     if (!valid.success || !fn.suppressError) {
//       throw new Error(`error in ${valid.errors[0]?.path}`)
//     }
//     return fn.call(this, ...args) as R
//   }
//   returnFn.suppressError = fn.suppressError
//   returnFn.evalArgs = fn.evalArgs
//   return returnFn
// }

export function validate(
  ...args: CheckResult[]
) {
  const success = args.some(arg => !arg.problems)
  const errors: Error[] = []
  if (!success) {
    for (let i = 0; i < args.length; i++) {
      let validatorResult = args[i]!
      if (!validatorResult.problems) {
        continue
      }

      let error = validatorResult.problems[0]!
      errors.push(new Error(error.reason))
    }
    return errors
  }
  return true
}